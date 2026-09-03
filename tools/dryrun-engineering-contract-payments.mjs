import assert from 'node:assert/strict';

import {
  createEngineeringContractPaymentService,
  derivePaymentSchedule,
  PAYMENT_ROLES,
} from '../modules/construction/contract-payments.js';

const now = '2026-09-03T09:00:00.000Z';
const hash = 'a'.repeat(64);
const contractContext = {
  contract: {
    id: 'contract-demolition-001',
    projectId: 'project-am-001',
    projectCode: 'AM',
    contractNumber: 'AM-DEM-001',
    amount: 100000,
    currency: 'TWD',
  },
  version: {
    id: 'version-demolition-001',
    versionNo: 1,
    status: 'issued',
    bundleSha256: hash,
    snapshot: {
      documentPackage: {
        paymentMilestones: [{
          id: 'payment-001',
          label: '第一期拆除進場款',
          percentage: 30,
          trigger: '現場進場並檢附請款文件',
          evidenceRequired: '發票與現場照片',
        }],
      },
    },
  },
  signingSession: { status: 'confirmed' },
};

const claims = new Map();
const idempotency = new Map();
const events = [];
const store = {
  async getContractPaymentContext(_tenant, { contractId }) {
    assert.equal(contractId, contractContext.contract.id);
    return contractContext;
  },
  async findPaymentIdempotency(_tenant, { action, idempotencyKey }) {
    return idempotency.get(action + ':' + idempotencyKey) || null;
  },
  async createPaymentClaim(_tenant, { claim, idempotencyKey }) {
    assert.equal(claim.status, 'submitted');
    claims.set(claim.id, { ...claim });
    return { claim: claims.get(claim.id), idempotencyKey };
  },
  async getPaymentClaim(_tenant, { claimId }) {
    return claims.get(claimId) || null;
  },
  async recordPaymentReview(_tenant, { claimId, expectedStatus, claim }) {
    assert.equal(claims.get(claimId).status, expectedStatus);
    claims.set(claimId, { ...claim });
    return { claim: claims.get(claimId) };
  },
  async recordPaymentApproval(_tenant, { claimId, expectedStatus, claim }) {
    assert.equal(claims.get(claimId).status, expectedStatus);
    claims.set(claimId, { ...claim });
    return { claim: claims.get(claimId) };
  },
  async appendPaymentEvent(_tenant, { event }) {
    assert.equal(event.eventVersion, 'engineering-contract-payment-control.v1');
    assert.equal(event.actorKind, 'internal_user');
    assert.doesNotMatch(JSON.stringify(event), /bankAccount|transfer|rawToken/i);
    events.push(event);
    idempotency.set(event.eventType + ':' + event.idempotencyKey, {
      claim: claims.get(event.claimId),
      event,
    });
  },
};

const scope = { projectIds: ['project-am-001'] };
const submitter = {
  tenant: { key: 'engineering' },
  actor: 'submitter@example.test',
  scope,
  permissions: [PAYMENT_ROLES.submit],
};
const reviewer = {
  tenant: { key: 'engineering' },
  actor: 'reviewer@example.test',
  scope,
  permissions: [PAYMENT_ROLES.review],
};
const approver = {
  tenant: { key: 'engineering' },
  actor: 'approver@example.test',
  scope,
  permissions: [PAYMENT_ROLES.approve],
};

const schedule = derivePaymentSchedule(contractContext, submitter);
assert.equal(schedule.milestones.length, 1);
assert.equal(schedule.milestones[0].amount, 30000);
assert.equal(schedule.versionFingerprint, hash);

const service = createEngineeringContractPaymentService({
  store,
  clock: () => new Date(now),
});

const submitInput = {
  claimId: 'claim-demolition-001',
  contractId: contractContext.contract.id,
  milestoneId: 'payment-001',
  amount: 30000,
  sourceSummary: '拆除進場完成，依第 1 期條件提出請款。',
  evidence: [{ id: 'evidence-invoice-001', kind: 'invoice', sha256: 'b'.repeat(64) }],
  idempotencyKey: 'payment-submit-claim-demolition-001',
};
const submitted = await service.submitClaim(submitter, submitInput);
assert.equal(submitted.claim.status, 'submitted');
assert.equal(submitted.paymentExecution.initiated, false);
assert.equal(submitted.claim.evidenceCount, 1);
assert.equal(JSON.stringify(submitted), JSON.stringify(submitted).replace(/submittedBy|sha256/g, ''));
assert.equal(events.length, 1);

const replay = await service.submitClaim(submitter, submitInput);
assert.equal(replay.replayed, true);
assert.equal(events.length, 1, '重複提交不得新增事件');

await assert.rejects(
  () => service.reviewClaim(submitter, {
    claimId: submitInput.claimId,
    decision: 'start_review',
    summary: '嘗試自行覆核',
    idempotencyKey: 'payment-review-denied-self-001',
  }),
  (error) => error.code === 'PAYMENT_ROLE_REQUIRED',
);

const reviewed = await service.reviewClaim(reviewer, {
  claimId: submitInput.claimId,
  decision: 'start_review',
  summary: '已比對第一期條件及發票佐證。',
  idempotencyKey: 'payment-review-start-demolition-001',
});
assert.equal(reviewed.claim.status, 'under_review');
assert.equal(events.at(-1).eventType, 'claim_review_started');

await assert.rejects(
  () => service.approveClaim(reviewer, {
    claimId: submitInput.claimId,
    summary: '覆核人嘗試核准',
    idempotencyKey: 'payment-approval-denied-self-001',
  }),
  (error) => error.code === 'PAYMENT_ROLE_REQUIRED',
);

const approved = await service.approveClaim(approver, {
  claimId: submitInput.claimId,
  summary: '核對覆核結論後核准本期請款。',
  idempotencyKey: 'payment-approval-demolition-001',
});
assert.equal(approved.claim.status, 'approved');
assert.match(approved.claim.nextAction, /未發起付款/);
assert.equal(approved.paymentExecution.initiated, false);
assert.equal(events.at(-1).eventType, 'claim_approved');
assert.equal(events.length, 3);

assert.throws(
  () => derivePaymentSchedule({ ...contractContext, signingSession: { status: 'signed' } }, submitter),
  (error) => error.code === 'PAYMENT_SIGNING_NOT_CONFIRMED',
);
await assert.rejects(
  () => service.submitClaim(submitter, {
    ...submitInput,
    claimId: 'claim-over-limit-001',
    amount: 30000.02,
    idempotencyKey: 'payment-submit-over-limit-001',
  }),
  (error) => error.code === 'PAYMENT_CLAIM_EXCEEDS_MILESTONE',
);

console.log('engineering contract payment control dry-run: passed');

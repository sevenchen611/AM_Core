import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  __test,
  createContractAcceptanceService,
  deriveAcceptanceItems,
  reduceAcceptanceWorkflow,
} from '../modules/construction/contract-acceptance.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const evidenceHash = sha256('acceptance-photo-001');
const contract = {
  id: 'contract-acceptance-1',
  projectId: 'project-engineering-1',
  projectCode: 'ENG',
};
const version = {
  id: 'version-acceptance-1',
  contractId: contract.id,
  status: 'frozen',
  frozenAt: '2026-09-03T01:00:00.000Z',
  snapshot: {
    documentPackage: {
      acceptanceCriteria: [
        {
          id: 'demolition-cleanup',
          criterion: '拆除面清潔',
          reference: '施工圖 D-01',
          verificationMethod: '現場逐項查驗',
          passCondition: '無殘留物',
          evidenceRequired: '驗收照片',
          verifier: '甲方工務',
        },
        {
          id: 'waste-removal',
          criterion: '廢棄物清運',
          passCondition: '清運聯單完整',
          evidenceRequired: ['清運聯單', '現場照片'],
        },
      ],
    },
  },
};

const plan = deriveAcceptanceItems(version);
assert.equal(plan.items.length, 2);
assert.equal(plan.items[0].evidenceRequirements[0], '驗收照片');
assert.throws(
  () => deriveAcceptanceItems({ ...version, status: 'draft', frozenAt: '' }),
  (caught) => caught.code === 'ACCEPTANCE_VERSION_NOT_FROZEN',
);

const events = [];
let ids = 0;
const repository = {
  async getAcceptanceContext(_tenant, identifiers) {
    if (identifiers.contractId !== contract.id || identifiers.versionId !== version.id) return null;
    return { contract, version, events };
  },
  async appendAcceptanceEvent(_tenant, event) {
    const previous = events.at(-1);
    assert.equal(event.expectedSequenceNo, events.length + 1);
    assert.equal(event.expectedPreviousEventHash, previous?.eventHash || '');
    events.push(event);
    return event;
  },
};

const service = createContractAcceptanceService({
  repository,
  clock: () => new Date('2026-09-03T02:00:00.000Z'),
  idFactory: () => 'acceptance-event-' + (++ids),
});
const baseContext = {
  tenant: { key: 'tenant-engineering' },
  actor: 'engineer@example.com',
  actorRoles: ['engineering_acceptance_submitter'],
  scope: { projectIds: [contract.projectId] },
};
const submission = await service.submit(baseContext, {
  contractId: contract.id,
  versionId: version.id,
  itemId: 'demolition-cleanup',
  evidence: [{ reference: 'drive-private-photo-1', sha256: evidenceHash, label: '現場照片', kind: 'photo' }],
  note: '拆除完成，送請現場驗收。',
});
assert.equal(submission.workflow.items[0].status, 'submitted');
assert.equal(events.length, 1);
assert.equal(events[0].type, 'acceptance_submitted');
assert.equal(__test.digest(__test.canonical({
  id: events[0].id, type: events[0].type, contractId: events[0].contractId, versionId: events[0].versionId,
  itemId: events[0].itemId, sequenceNo: events[0].sequenceNo, previousEventHash: events[0].previousEventHash,
  occurredAt: events[0].occurredAt, actor: events[0].actor, payload: events[0].payload,
})), events[0].eventHash);

await assert.rejects(
  service.review(baseContext, {
    contractId: contract.id, versionId: version.id, itemId: 'demolition-cleanup', decision: 'accepted',
  }),
  (caught) => caught.code === 'ACCEPTANCE_ROLE_DENIED',
);
const reviewerContext = { ...baseContext, actor: 'reviewer@example.com', actorRoles: ['engineering_acceptance_reviewer'] };
const reviewed = await service.review(reviewerContext, {
  contractId: contract.id, versionId: version.id, itemId: 'demolition-cleanup', decision: 'accepted',
});
assert.equal(reviewed.workflow.items[0].status, 'accepted');
assert.equal(events.length, 2);
assert.equal(events[1].previousEventHash, events[0].eventHash);

const approverContext = { ...baseContext, actor: 'approver@example.com', actorRoles: ['engineering_acceptance_approver'] };
const reopened = await service.reopen(approverContext, {
  contractId: contract.id, versionId: version.id, itemId: 'demolition-cleanup', note: '現場複查發現邊角殘留。',
});
assert.equal(reopened.workflow.items[0].status, 'rework_required');
assert.equal(events.length, 3);
assert.equal(events[2].previousEventHash, events[1].eventHash);

await assert.rejects(
  service.submit(baseContext, {
    contractId: contract.id, versionId: version.id, itemId: 'waste-removal',
    evidence: [], note: '沒有證據不可送審',
  }),
  (caught) => caught.code === 'ACCEPTANCE_EVIDENCE_REQUIRED',
);
await assert.rejects(
  service.get({ ...baseContext, scope: 'none' }, { contractId: contract.id, versionId: version.id }),
  (caught) => caught.code === 'PROJECT_SCOPE_DENIED',
);
await assert.rejects(
  service.submit(baseContext, {
    contractId: contract.id, versionId: version.id, itemId: 'waste-removal',
    actor: 'client-override', evidence: [{ reference: 'private', sha256: evidenceHash }],
  }),
  (caught) => caught.code === 'ACCEPTANCE_AUTHORITY_OVERRIDE_FORBIDDEN',
);

assert.throws(
  () => reduceAcceptanceWorkflow({ contract, version, events: [{ ...events[0], eventHash: '0'.repeat(64) }] }),
  (caught) => caught.code === 'ACCEPTANCE_EVENT_HASH_INVALID',
);

console.log('Engineering contract acceptance dry-run passed: frozen-version derivation, linked evidence, roles, append-only hash chain, review/reopen, scope, and authority gates verified.');

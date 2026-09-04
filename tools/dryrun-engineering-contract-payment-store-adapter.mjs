import assert from 'node:assert/strict';

import { createContractStore } from '../core/contract-store.js';

const tenant = { key: 'engineering', envPrefix: 'ENG' };
const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const claimId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const evidenceId = 'evidence-protected-reference-001';
const versionHash = 'a'.repeat(64);
const evidenceHash = 'b'.repeat(64);
const eventHash = 'c'.repeat(64);

const queries = [];
const state = {
  item: null,
  claim: null,
  evidence: [],
  events: [],
};

function claimRow() {
  if (!state.claim) return null;
  return {
    ...state.claim,
    project_id: 'project-am-001',
    project_code: 'AM',
    contract_number: 'AM-DEM-001',
    version_no: 1,
    milestone_label: '第一期拆除進場款',
  };
}

const client = {
  async query(sql, params = []) {
    const text = String(sql);
    queries.push({ text, params });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config)/.test(text.trim())) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('FROM engineering_contracts.contracts c')
      && text.includes('LEFT JOIN LATERAL')
      && text.includes('v.id = c.current_version_id')) {
      return {
        rowCount: 1,
        rows: [{
          id: contractId, project_notion_page_id: 'project-am-001', project_code: 'AM',
          contract_number: 'AM-DEM-001', amount: '100000.00', currency: 'TWD',
          version_id: versionId, version_no: 1, version_status: 'issued',
          contract_snapshot: { documentPackage: { paymentMilestones: [] } },
          bundle_sha256: versionHash, signing_status: 'confirmed',
          signing_confirmed_at: '2026-09-04T01:00:00.000Z', signing_completed_at: null,
        }],
      };
    }
    if (text.includes('INSERT INTO engineering_contracts.contract_payment_items')) {
      if (!state.item) {
        state.item = { id: itemId, source_version_sha256: params[3] };
        return { rowCount: 1, rows: [state.item] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes('FROM engineering_contracts.contract_payment_items i')) {
      return { rowCount: state.item ? 1 : 0, rows: state.item ? [state.item] : [] };
    }
    if (text.includes('INSERT INTO engineering_contracts.contract_payment_claims')) {
      if (state.claim) return { rowCount: 0, rows: [] };
      state.claim = {
        id: params[0], payment_item_id: params[1], contract_id: params[2], version_id: params[3],
        source_milestone_id: params[4], source_version_sha256: params[5], amount: params[6],
        currency: params[7], status: 'submitted', submitted_by: params[8], submitted_at: params[9],
        source_summary: params[10], review_due_at: params[11], reviewed_by: null, reviewed_at: null,
        review_summary: '', approved_by: null, approved_at: null, approval_summary: '',
      };
      return { rowCount: 1, rows: [{ id: claimId }] };
    }
    if (text.includes('SELECT p.*,') && text.includes('contract_payment_claims p')) {
      const row = claimRow();
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (text.includes('FROM engineering_contracts.contract_payment_evidence')) {
      return {
        rowCount: state.evidence.length,
        rows: state.evidence.map((item) => ({ id: item.id, evidence_kind: item.evidence_kind })),
      };
    }
    if (text.includes('INSERT INTO engineering_contracts.contract_payment_evidence')) {
      state.evidence.push({
        id: '55555555-5555-4555-8555-555555555555',
        evidence_kind: params[1], protected_reference: params[2], sha256: params[3],
      });
      return { rowCount: 1, rows: [] };
    }
    if (text.includes('UPDATE engineering_contracts.contract_payment_items')) {
      return { rowCount: 1, rows: [] };
    }
    if (text.includes('UPDATE engineering_contracts.contract_payment_claims p')) {
      if (!state.claim || state.claim.status !== params.at(-1)) return { rowCount: 0, rows: [] };
      if (text.includes("SET status = 'approved'")) {
        state.claim.status = 'approved';
        state.claim.approved_by = params[2];
        state.claim.approved_at = params[3];
        state.claim.approval_summary = params[4];
      } else {
        state.claim.status = params[2];
        state.claim.reviewed_by = params[3];
        state.claim.reviewed_at = params[4];
        state.claim.review_summary = params[5];
      }
      return { rowCount: 1, rows: [{ payment_item_id: itemId }] };
    }
    if (text.includes('FROM engineering_contracts.contract_payment_events e')) {
      const event = state.events.find((item) => item.event_type === params[2]
        && item.idempotency_key === params[3]);
      return { rowCount: event ? 1 : 0, rows: event ? [{
        eventType: event.event_type, eventVersion: event.event_version, contractId: contractId,
        claimId: event.claim_id, occurredAt: event.occurred_at, actorKind: event.actor_kind,
        actor: event.actor_ref, authority: event.authority, idempotencyKey: event.idempotency_key,
        evidenceFingerprint: event.evidence_fingerprint, details: event.details,
      }] : [] };
    }
    if (text.includes('FROM engineering_contracts.contract_payment_events')
      && text.includes('idempotency_key = $2')) {
      const event = state.events.find((item) => item.idempotency_key === params[1]);
      return { rowCount: event ? 1 : 0, rows: event ? [event] : [] };
    }
    if (text.includes('COALESCE(MAX(sequence_no),0) + 1')) {
      return { rowCount: 1, rows: [{ next_sequence: state.events.length + 1 }] };
    }
    if (text.includes('INSERT INTO engineering_contracts.contract_payment_events')) {
      const event = {
        claim_id: params[0], sequence_no: params[1], event_type: params[2], event_version: params[3],
        idempotency_key: params[4], occurred_at: params[5], actor_kind: params[6], actor_ref: params[7],
        authority: JSON.parse(params[8]), evidence_fingerprint: params[9], details: JSON.parse(params[10]),
      };
      state.events.push(event);
      return { rowCount: 1, rows: [event] };
    }
    throw new Error('Unexpected payment adapter SQL: ' + text);
  },
  release() {},
};

const store = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://payment-adapter.test', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => client }),
});

const context = await store.getContractPaymentContext(tenant, { contractId });
assert.equal(context.contract.id, contractId);
assert.equal(context.version.bundleSha256, versionHash);
assert.equal(context.signingSession.status, 'confirmed');

const created = await store.createPaymentClaim(tenant, {
  actor: 'submitter@example.test',
  claim: {
    id: claimId, contractId, versionId, milestoneId: 'milestone-demolition-001',
    milestoneLabel: '第一期拆除進場款', versionFingerprint: versionHash, amount: 30000,
    currency: 'TWD', submittedAt: '2026-09-04T02:00:00.000Z',
    sourceSummary: '現場進場完成後提出請款。', reviewDueAt: '2026-09-06T02:00:00.000Z',
    evidence: [{ id: evidenceId, kind: 'invoice', sha256: evidenceHash }],
  },
});
assert.equal(created.value.claim.evidenceCount, 1);
assert.equal(created.value.claim.contractId, contractId);

const reviewed = await store.recordPaymentReview(tenant, {
  claimId, expectedStatus: 'submitted', actor: 'reviewer@example.test',
  claim: {
    status: 'under_review', reviewedAt: '2026-09-04T03:00:00.000Z',
    reviewSummary: '已核對請款條件與發票佐證。',
  },
});
assert.equal(reviewed.value.claim.status, 'under_review');

const approved = await store.recordPaymentApproval(tenant, {
  claimId, expectedStatus: 'under_review', actor: 'approver@example.test',
  claim: {
    approvedAt: '2026-09-04T04:00:00.000Z',
    approvalSummary: '已核對獨立覆核結論。',
  },
});
assert.equal(approved.value.claim.status, 'approved');

const event = {
  eventType: 'claim_approved', eventVersion: 'engineering-contract-payment-control.v1',
  contractId, claimId, occurredAt: '2026-09-04T04:00:00.000Z',
  actorKind: 'internal_user', actor: 'approver@example.test',
  authority: { role: 'engineering_contract_payment_approve', projectScopeConfirmed: true },
  idempotencyKey: 'payment-approval-adapter-001', evidenceFingerprint: eventHash,
  details: { amount: 30000, currency: 'TWD' },
};
const appended = await store.appendPaymentEvent(tenant, { event, idempotencyKey: event.idempotencyKey });
assert.equal(appended.value.event.eventType, 'claim_approved');
assert.equal(state.events.length, 1);

const replay = await store.findPaymentIdempotency(tenant, {
  action: 'claim_approved', idempotencyKey: event.idempotencyKey, contractId,
});
assert.equal(replay.claim.id, claimId);
assert.equal(replay.event.eventType, 'claim_approved');
await assert.rejects(() => store.getPaymentClaim(tenant, { claimId: 'not-a-uuid' }),
  (error) => error.code === 'PAYMENT_STORE_IDENTIFIER_INVALID');
assert.ok(queries.some((entry) => entry.text.includes("set_config('app.tenant_key'")),
  'every adapter operation must set the tenant transaction context');
assert.ok(queries.some((entry) => entry.text.includes('SET TRANSACTION READ ONLY')),
  'payment authority and idempotency reads must be read-only');
assert.ok(queries.some((entry) => entry.text.includes('FOR UPDATE OF p')),
  'payment event append must lock the claim before allocating its event sequence');

console.log('engineering contract payment PostgreSQL adapter dry-run: passed');

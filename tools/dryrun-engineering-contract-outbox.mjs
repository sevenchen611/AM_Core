import assert from 'node:assert/strict';
import { createContractOutboxWorker } from '../modules/construction/contract-outbox.js';

const HASH = 'b'.repeat(64);
const tenant = { key: 'engineering' };
const context = { tenant, actor: 'server-worker', scope: ['project-1'] };
const jobs = new Map();
const calls = [];

function addJob(id, kind, payload) {
  const job = {
    id, contract_id: 'contract-1', event_kind: kind, idempotency_key: `outbox-idempotency-${id}`,
    payload, status: 'pending', attempts: 0,
  };
  jobs.set(job.idempotency_key, job);
  return job;
}

const store = {
  async getOutboxByKey(_tenant, key) { return jobs.get(key) || null; },
  async claimOutbox(_tenant, input) {
    const candidates = [...jobs.values()].filter((job) => (
      (!input.idempotencyKey || job.idempotency_key === input.idempotencyKey)
      && (!input.eventKinds || input.eventKinds.includes(job.event_kind))
      && ['pending', 'failed'].includes(job.status)
    )).slice(0, input.limit);
    for (const job of candidates) { job.status = 'processing'; job.attempts += 1; job.locked_by = input.workerId; }
    return candidates;
  },
  async completeOutbox(_tenant, input) {
    const job = [...jobs.values()].find((item) => item.id === input.id && item.locked_by === input.workerId);
    if (!job) return null;
    job.status = 'succeeded'; job.externalSessionId = input.externalSessionId || '';
    return job;
  },
  async linkOutboxSession(_tenant, input) {
    const job = [...jobs.values()].find((item) => item.id === input.id && item.locked_by === input.workerId);
    if (!job) return null;
    job.external_session_id = input.externalSessionId;
    return job;
  },
  async failOutbox(_tenant, input) {
    const job = [...jobs.values()].find((item) => item.id === input.id && item.locked_by === input.workerId);
    if (!job) return null;
    job.status = job.attempts >= input.maxAttempts ? 'dead_letter' : 'failed'; job.last_error = input.error;
    return job;
  },
  async getContract() {
    return {
      id: 'contract-1', project_notion_page_id: 'project-1', project_code: 'P01',
      notion_contract_page_id: 'notion-contract-1', group_binding_notion_page_id: 'binding-1',
      budget_item_notion_page_id: 'budget-1', counterparty_name: '王師傅', amount: 120000,
      workflow_state: 'issued', current_version_id: 'version-1', row_version: 4,
    };
  },
  async getVersion() {
    return {
      id: 'version-1', contract_id: 'contract-1', version_no: 2, status: 'issued',
      bundle_sha256: 'a'.repeat(64), issued_pdf_drive_file_id: 'driveFile_1234567890',
      issued_pdf_sha256: HASH, issued_at: '2026-08-28T09:00:00.000Z',
    };
  },
  async listContracts() {
    return [
      { id: 'contract-1', budget_item_notion_page_id: 'budget-1', workflow_state: 'signed', amount: 120000, counterparty_name: '王師傅' },
      { id: 'contract-2', budget_item_notion_page_id: 'budget-1', workflow_state: 'draft', amount: 999999, counterparty_name: '不應列入' },
    ];
  },
  async getSigningBundle() { return null; },
};

let lineFailures = 1;
const signingInputs = [];
const signingFactory = () => ({
  async getSession(sessionId) { return { id: sessionId, status: 'issued' }; },
  async issueSigningRequest(input) {
    signingInputs.push(input);
    return { sessionId: 'cs_durable', token: 'reconstructed-token', expiresAt: '2026-09-04T00:00:00.000Z' };
  },
  async sendInvitation() {
    if (lineFailures-- > 0) throw Object.assign(new Error('LINE temporarily failed'), { code: 'LINE_SEND_FAILED' });
    return { ok: true, sentAt: '2026-08-28T10:00:00.000Z' };
  },
});
const authorityResolver = async (_deps, input) => {
  calls.push(['authority', input]);
  return { groupBindingId: 'binding-1', lineGroupId: 'C-real', signerLineUserId: input.signerLineUserId, signerName: '王師傅' };
};
const notionRequest = async (path, input) => {
  calls.push(['notion', path, input?.method, input?.body]);
  if (input?.method === 'GET' && path.includes('budget-1')) {
    return { parent: { data_source_id: 'budgets-ds' }, properties: { '預算金額': { number: 200000 } } };
  }
  if (input?.method === 'GET') return { parent: { data_source_id: 'contracts-ds' }, properties: {} };
  return { ok: true };
};
const worker = createContractOutboxWorker({
  contractStore: store,
  dataSources: { contracts: 'contracts-ds', budgets: 'budgets-ds' },
  notionRequest,
}, { signingFactory, authorityResolver, workerId: 'test-worker', maxAttempts: 3 });

const line = addJob('line-1', 'line_signing_invitation', {
  contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer',
  partyASignerLineUserId: 'U-party-a',
  documentRef: 'https://drive.google.com/file/d/driveFile_1234567890/view', documentHash: HASH,
  requestedBy: 'server-admin',
});
await assert.rejects(worker.processByKey(context, line.idempotency_key), /LINE temporarily failed/);
assert.equal(line.status, 'failed');
const retry = await worker.processByKey(context, line.idempotency_key);
assert.equal(retry.job.status, 'succeeded');
assert.equal(retry.result.sessionId, 'cs_durable');
assert.equal(signingInputs.length, 2);
assert.equal(signingInputs[0].idempotencyKey, line.idempotency_key);
assert.equal(signingInputs[1].idempotencyKey, line.idempotency_key);
assert.equal(signingInputs[1].lineGroupId, 'C-real');
assert.equal(signingInputs[1].partyASignerLineUserId, 'U-party-a');
assert.equal(signingInputs[1].documentHash, HASH);
assert.equal(calls.filter((item) => item[0] === 'authority').length, 4, 'both signers are revalidated on every outbox attempt');

const projection = addJob('projection-1', 'notion_contract_projection', {
  contractId: 'contract-1', versionId: 'version-1', status: 'issued',
});
const projected = await worker.processByKey(context, projection.idempotency_key);
assert.equal(projected.job.status, 'succeeded');
const patches = calls.filter((item) => item[0] === 'notion' && item[2] === 'PATCH');
assert.equal(patches.length, 2, 'contract and budget projections must both be patched');
const budgetPatch = patches.find((item) => item[1].includes('budget-1'));
assert.equal(budgetPatch[3].properties['已發包金額'].number, 120000);

const denied = addJob('denied-1', 'notion_contract_projection', {
  contractId: 'contract-1', versionId: 'version-1', status: 'issued',
});
await assert.rejects(
  worker.processByKey({ ...context, scope: ['other-project'] }, denied.idempotency_key),
  (error) => error.code === 'PROJECT_SCOPE_DENIED' && Number(error.statusCode || error.status) === 404,
);
assert.equal(denied.status, 'failed');

console.log('engineering contract outbox dry-run passed');

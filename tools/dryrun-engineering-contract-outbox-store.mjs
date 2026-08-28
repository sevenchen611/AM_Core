import assert from 'node:assert/strict';
import { createContractStore } from '../core/contract-store.js';

const queries = [];
const row = {
  id: 'outbox-1', contract_id: '11111111-1111-4111-8111-111111111111',
  event_kind: 'notion_contract_projection', idempotency_key: 'contract-projection-test-0001',
  payload: { contractId: '11111111-1111-4111-8111-111111111111' }, status: 'pending', attempts: 0,
};
const client = {
  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    queries.push([normalized, params]);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)/.test(normalized)) return { rowCount: 0, rows: [] };
    if (normalized.startsWith("SELECT set_config('app.tenant_key'")) return { rowCount: 1, rows: [{}] };
    if (normalized.startsWith('SELECT id FROM engineering_contracts.contracts')) return { rowCount: 1, rows: [{ id: row.contract_id }] };
    if (normalized.startsWith('INSERT INTO engineering_contracts.integration_outbox')) return { rowCount: 1, rows: [row] };
    if (normalized.startsWith('SELECT o.*, s.external_session_id')) return { rowCount: 1, rows: [{ ...row, external_session_id: null }] };
    if (normalized.startsWith('WITH ready AS')) return { rowCount: 1, rows: [{ ...row, status: 'processing', attempts: 1, locked_by: 'worker-1' }] };
    if (normalized.startsWith('UPDATE engineering_contracts.integration_outbox o SET signing_session_id')) return { rowCount: 1, rows: [{ ...row, signing_session_id: 'session-db-1' }] };
    if (normalized.includes("SET status = 'succeeded'")) return { rowCount: 1, rows: [{ ...row, status: 'succeeded' }] };
    if (normalized.includes("SET status = CASE WHEN o.attempts")) return { rowCount: 1, rows: [{ ...row, status: 'failed', attempts: 1 }] };
    throw new Error(`unexpected outbox SQL: ${normalized}`);
  },
  release() {},
};
const store = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://runtime.example/contracts' },
  poolFactory: () => ({ connect: async () => client }),
});
const tenant = { key: 'engineering', envPrefix: 'ENG' };

const inserted = await store.enqueueOutbox(tenant, {
  contractId: row.contract_id,
  eventKind: row.event_kind,
  idempotencyKey: row.idempotency_key,
  payload: row.payload,
});
assert.equal(inserted.value.id, row.id);
const insert = queries.find(([sql]) => sql.startsWith('INSERT INTO engineering_contracts.integration_outbox'));
assert.equal(insert[1][4], JSON.stringify(row.payload));
assert.match(insert[1][5], /^[a-f0-9]{64}$/);

assert.equal((await store.getOutboxByKey(tenant, row.idempotency_key)).id, row.id);
const claimed = await store.claimOutbox(tenant, { workerId: 'worker-1', idempotencyKey: row.idempotency_key, limit: 1 });
assert.equal(claimed.value[0].status, 'processing');
assert.equal((await store.linkOutboxSession(tenant, { id: row.id, workerId: 'worker-1', externalSessionId: 'cs_test' })).value.signing_session_id, 'session-db-1');
assert.equal((await store.completeOutbox(tenant, { id: row.id, workerId: 'worker-1', externalSessionId: 'cs_test' })).value.status, 'succeeded');
assert.equal((await store.failOutbox(tenant, { id: row.id, workerId: 'worker-1', maxAttempts: 8, delaySeconds: 30, error: 'temporary' })).value.status, 'failed');
assert.ok(queries.filter(([sql]) => sql.startsWith("SELECT set_config('app.tenant_key'")).every(([, params]) => params[0] === 'engineering'));

console.log('engineering contract persistent outbox store dry-run passed');

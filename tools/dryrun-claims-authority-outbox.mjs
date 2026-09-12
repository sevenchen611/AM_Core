import assert from 'node:assert/strict';
import { createClaimsAuthorityOutboxWorker } from '../core/claims-authority-outbox.js';

const completed = [];
const failed = [];
const store = {
  leaseOutbox: async () => [
    { tenant_id: 'tenant-a', event_key: 'ok', event_type: 'activation_succeeded', group_lookup: 'a'.repeat(64), payload: {} },
    { tenant_id: 'tenant-a', event_key: 'retry', event_type: 'line_message', group_lookup: 'a'.repeat(64), payload: {} },
  ],
  completeOutbox: async (item) => { completed.push(item); return { status: 'sent' }; },
  failOutbox: async (item) => { failed.push(item); return { status: 'retry' }; },
};
const worker = createClaimsAuthorityOutboxWorker({
  store,
  workerId: 'synthetic-worker',
  dispatcher: { dispatch: async ({ eventKey }) => { if (eventKey === 'retry') throw new Error('synthetic failure'); } },
});
const result = await worker.runOnce();
assert.equal(result.leased, 2);
assert.equal(completed.length, 1);
assert.equal(failed.length, 1);
assert.equal(result.results[0].status, 'sent');
assert.equal(result.results[1].status, 'retry');
console.log('claims authority outbox dry-run passed');

import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createPostgresGroupEntryStore } from '../modules/claims/v3/group-entry.js';

const db = new PGlite({ extensions: { pgcrypto } });
let queryCount = 0;
const pool = {
  async query(text, params = []) {
    queryCount += 1;
    if (!params.length && text.includes(';')) {
      await db.exec(text);
      return { rows: [] };
    }
    return db.query(text, params);
  },
  async connect() {
    return {
      query: (text, params = []) => pool.query(text, params),
      release() {},
    };
  },
};

const store = createPostgresGroupEntryStore('postgres://unused', { pool });
await store.init();
queryCount = 0;

const entryRecord = {
  eventKey: 'group-entry:entry-hotpath',
  jobKind: 'entry',
  tenantKey: 'hozo',
  sourceId: 'source-hozo-company-group',
  formKey: 'general_expense',
  groupReference: 'line-ref:v1:11111111-1111-4111-8111-111111111111',
  applicantReference: 'line-ref:v1:22222222-2222-4222-8222-222222222222',
  desiredState: 'active',
  keyword: '請款',
  occurredAt: '2026-09-01T00:00:00.000Z',
  membershipRequestId: 'membership-entry-hotpath',
  entryRequestId: 'entry-entry-hotpath',
  deliveryEventKey: 'entry-invite-hotpath',
};
let routingCalls = 0;
const first = await store.enqueueIngress('evt-entry-hotpath', 'hash-entry-hotpath', () => {
  routingCalls += 1;
  return { intercepted: 1, records: [entryRecord] };
});
assert.deepEqual(first, { inserted: true, intercepted: 1, queuedCount: 1 });
assert.equal(queryCount, 5);
const queuedEntry = (await db.query('SELECT * FROM finance_claim_group_entry_queue_v3 WHERE event_key=$1', [entryRecord.eventKey])).rows[0];
assert.equal(Number(queuedEntry.membership_sequence), 0);
assert.equal((await db.query('SELECT count(*)::int AS count FROM finance_claim_group_membership_sequences_v3')).rows[0].count, 0);

queryCount = 0;
const replay = await store.enqueueIngress('evt-entry-hotpath', 'hash-entry-hotpath', () => {
  routingCalls += 1;
  return { intercepted: 1, records: [entryRecord] };
});
assert.deepEqual(replay, { inserted: false, intercepted: 1, queuedCount: 1 });
assert.equal(queryCount, 3);
assert.equal(routingCalls, 1);
await assert.rejects(
  store.enqueueIngress('evt-entry-hotpath', 'different-hash', () => ({ intercepted: 1, records: [entryRecord] })),
  /idempotency_mismatch/,
);

queryCount = 0;
const claimed = await store.claimBatch(1, 45);
assert.equal(queryCount, 1);
assert.equal(claimed.length, 1);
assert.equal(claimed[0].event_key, entryRecord.eventKey);
assert.equal(Number(claimed[0].attempts), 1);
assert.match(String(claimed[0].lease_token), /^[0-9a-f-]{36}$/i);
assert.equal((await db.query("SELECT status FROM finance_claim_group_entry_attempts_v3 WHERE event_key=$1", [entryRecord.eventKey])).rows[0].status, 'processing');

queryCount = 0;
const finished = await store.finish(claimed[0], 'delivered', {
  entryUrl: 'https://rental.example.test/finance-claims?sourceHint=test.test',
  entryExpiresAt: '2026-09-01T00:10:00.000Z',
  ackReference: 'line-ack:v1:55555555-5555-4555-8555-555555555555',
});
assert.equal(queryCount, 1);
assert.equal(finished.status, 'delivered');
assert.equal((await db.query("SELECT status FROM finance_claim_group_entry_attempts_v3 WHERE event_key=$1", [entryRecord.eventKey])).rows[0].status, 'succeeded');

console.log('Finance Claims v3 PostgreSQL hot-path dry-run passed.');

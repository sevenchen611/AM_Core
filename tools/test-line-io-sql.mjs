// Execute the real adapter/schema with a disposable in-memory PostgreSQL engine:
// node tools/test-line-io-sql.mjs <absolute path to @electric-sql/pglite/dist/index.js>
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createLineIoStore } from '../core/line-io/store.js';

if (!process.argv[2]) throw new Error('Provide an installed @electric-sql/pglite/dist/index.js path; see VERIFY.md');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const query = async (...args) => {
  const result = await db.query(...args);
  return { ...result, rowCount: result.affectedRows || result.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
try {
  await db.exec(await readFile(new URL('../versions/AM-IMP-2026.0929.01/schemas/line-io.sql', import.meta.url), 'utf8'));
  const store = createLineIoStore(pool);
  const record = (tenantKey, id, groupId = 'synthetic-group') => ({ tenantKey, groupId,
    event: { type: 'message', webhookEventId: id, message: { id, type: 'text', text: 'synthetic source' } } });
  await store.append([record('a', '1'), record('b', '2'), record('a', '3')]);
  await store.append([record('a', '1')]);
  const page = await store.list({ tenantKey: 'a', groupIds: ['synthetic-group'], after: '0', limit: 1 });
  assert.equal(page.hasMore, true);
  assert.equal(page.events[0].event.webhookEventId, '1');
  const page2 = await store.list({ tenantKey: 'a', groupIds: ['synthetic-group'], after: page.nextCursor, limit: 10 });
  assert.deepEqual(page2.events.map((e) => e.event.webhookEventId), ['3']);
  assert.equal((await store.list({ tenantKey: 'a', groupIds: ['other-group'], after: '0', limit: 10 })).events.length, 0);
  await assert.rejects(store.append([record('a', 'rollback'), { tenantKey: 'a', groupId: 'synthetic-group', event: {} }]));
  assert.equal((await query("SELECT 1 FROM line_io.line_io_events WHERE event_id = 'rollback'")).rowCount, 0);

  const unsend = (id) => ({ tenantKey: 'a', groupId: 'synthetic-group', event: {
    type: 'unsend', webhookEventId: `unsend-${id}`, unsend: { messageId: id },
  } });
  await store.append([unsend('1'), unsend('late')]);
  await store.append([record('a', 'late')]);
  const redacted = (await store.list({ tenantKey: 'a', groupIds: ['synthetic-group'], after: '0', limit: 100 })).events;
  assert.equal(redacted.find((e) => e.event.webhookEventId === '1').event.message.unsent, true);
  assert.equal(redacted.find((e) => e.event.webhookEventId === 'late').event.message.text, undefined);
  assert.equal((await store.list({ tenantKey: 'b', groupIds: ['synthetic-group'], after: '0', limit: 10 })).events[0].event.message.text, 'synthetic source');

  await store.append([{tenantKey:'a',groupId:'synthetic-group',event:{type:'message',webhookEventId:'owned',source:{userId:'allowed'},message:{id:'owned',text:'allowed'}}}]);
  const filtered = await store.list({tenantKey:'a',groupIds:['synthetic-group'],inputUserIds:['allowed'],after:'0',limit:100});
  assert.deepEqual(filtered.events.filter(e=>e.event.type==='message').map(e=>e.event.webhookEventId), ['owned']);
  assert.equal(filtered.events.filter(e=>e.event.type==='unsend').length, 2);
  const identity = { tenantKey: 'a', clientId: 'test', key: 'report-1', hash: 'hash-1' };
  const first = await store.reserve(identity);
  await assert.rejects(store.reserve(identity), { code: 'send_in_progress' });
  await assert.rejects(store.reserve({ ...identity, hash: 'changed' }), { code: 'idempotency_conflict' });
  await store.finish({ ...identity, attempt: first.attempt, result: null });
  // New adapter instance simulates a process restart against persisted storage.
  const second = await createLineIoStore(pool).reserve(identity);
  assert.equal(second.retryKey, first.retryKey);
  await store.finish({ ...identity, attempt: first.attempt, result: { stale: true } });
  await assert.rejects(store.reserve(identity), { code: 'send_in_progress' });
  await store.finish({ ...identity, attempt: second.attempt, result: { status: 'accepted' } });
  assert.deepEqual((await store.reserve(identity)).result, { status: 'accepted' });
  assert.notEqual((await store.reserve({ ...identity, tenantKey: 'b' })).retryKey, first.retryKey);
  const expired = { ...identity, key: 'expired' };
  await store.reserve(expired);
  await query("UPDATE line_io.line_io_sends SET created_at = now() - interval '25 hours', lease_until = NULL WHERE idempotency_key = 'expired'");
  await assert.rejects(store.reserve(expired), { code: 'retry_window_expired' });
  await store.append([{tenantKey:'a',groupId:'synthetic-group',reply:'encrypted-token',
    event:{type:'postback',webhookEventId:'reply-one',source:{userId:'allowed'},postback:{data:'uof.list.0'}}}]);
  const replyIdentity={tenantKey:'a',eventId:'reply-one',groupId:'synthetic-group',userId:'allowed',bodyHash:'reply-hash'};
  await assert.rejects(store.claimReply({...replyIdentity,userId:'wrong'}),{code:'reply_event_unavailable'});
  assert.equal((await store.claimReply(replyIdentity)).sealedToken,'encrypted-token');
  await assert.rejects(store.claimReply(replyIdentity),{code:'reply_outcome_unknown'});
  await store.finishReply({...replyIdentity,status:'accepted',result:{status:'accepted',method:'reply'}});
  assert.equal((await createLineIoStore(pool).claimReply(replyIdentity)).result.method,'reply');
  await assert.rejects(store.claimReply({...replyIdentity,bodyHash:'changed'}),{code:'reply_payload_changed'});
  await store.append([{tenantKey:'a',groupId:'synthetic-group',reply:'new-token',
    event:{type:'postback',webhookEventId:'reply-old',source:{userId:'allowed'},postback:{data:'uof.list.1'}}}]);
  await query("UPDATE line_io.line_io_events SET received_at=now()-interval '41 seconds' WHERE event_id='reply-old'");
  await assert.rejects(store.claimReply({...replyIdentity,eventId:'reply-old'}),{code:'reply_token_expired'});
  const visible=JSON.stringify((await store.list({tenantKey:'a',groupIds:['synthetic-group'],after:'0',limit:100})).events);
  assert.equal(visible.includes('encrypted-token'),false);
  assert.equal(visible.includes('sealedToken'),false);
  assert.equal((await query("SELECT payload #>> '{reply,sealedToken}' AS token FROM line_io.line_io_events WHERE event_id='reply-one'")).rows[0].token,null);
  console.log('PASS: PostgreSQL schema, tenant isolation, cursor safety, push retry and single-use reply receipts');
} finally { await db.close(); }

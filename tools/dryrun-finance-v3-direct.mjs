import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFinanceClaimsV3GroupEntryConsumer, createGroupEntryClient } from '../modules/claims/v3/group-entry.js';
import { createFinanceClaimsV3Receiver } from '../modules/claims/v3/receiver.js';
import { __test as claimsTest } from '../modules/claims/index.js';

const NOW = Date.parse('2026-09-01T00:00:00.000Z');
let clock = NOW;
const GROUP = `C${'a'.repeat(32)}`;
const USER = `U${'b'.repeat(32)}`;
const GROUP_REF = 'line-ref:v1:11111111-1111-4111-8111-111111111111';
const USER_REF = 'line-ref:v1:22222222-2222-4222-8222-222222222222';

function localEnv() {
  return {
    HOZO_FINANCE_CLAIMS_V3_ENABLED: 'true',
    HOZO_FINANCE_CLAIMS_V3_BRIDGE_ENABLED: 'true',
    HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED: 'true',
    HOZO_FINANCE_CLAIMS_V3_ALLOWED_TENANTS: 'hozo',
    HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL: 'https://rental.example.test',
    HOZO_FINANCE_CLAIMS_V3_BRIDGE_MACHINE_TOKEN: 'bridge-machine-token-0000000000000000',
    HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_EVENT_SECRET: 'group-entry-event-secret-at-least-32-chars',
    HOZO_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON: JSON.stringify({ bindings: [
      { identityReference: GROUP_REF, tenantKey: 'hozo', type: 'group_binding', target: GROUP },
      { identityReference: USER_REF, tenantKey: 'hozo', type: 'line_user', target: USER },
    ] }),
    HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_SCOPES_JSON: JSON.stringify({ scopes: [
      { tenantKey: 'hozo', groupReference: GROUP_REF, sourceId: 'source-hozo-company-group', formKey: 'general_expense' },
    ] }),
    LINE_CHANNEL_ACCESS_TOKEN: 'line-access-token-for-test',
  };
}

function message(id = 'evt-1') {
  return {
    type: 'message', webhookEventId: id, timestamp: NOW,
    source: { type: 'group', groupId: GROUP, userId: USER },
    message: { id: `msg-${id}`, type: 'text', text: '請款' },
  };
}

class MemoryStore {
  constructor() { this.rows = new Map(); this.ingress = new Map(); this.attempts = []; }
  async init() {}
  async enqueue(record) {
    const existing = this.rows.get(record.eventKey);
    if (existing) return { ...existing, inserted: false };
    const row = {
      event_key: record.eventKey, job_kind: record.jobKind, tenant_key: record.tenantKey,
      source_id: record.sourceId, form_key: record.formKey, group_reference: record.groupReference,
      applicant_reference: record.applicantReference, desired_state: record.desiredState,
      keyword: record.keyword, occurred_at: record.occurredAt, membership_sequence: 1,
      membership_request_id: record.membershipRequestId, entry_request_id: record.entryRequestId,
      delivery_event_key: record.deliveryEventKey, status: record.jobKind === 'entry' ? 'pending_entry' : 'pending_membership', attempts: 0,
      available_at: clock, lease_token: null, entry_url: '', entry_expires_at: null,
      ack_reference: '', last_error: '',
    };
    this.rows.set(record.eventKey, row);
    return { ...row, inserted: true };
  }
  async enqueueIngress(eventId, requestHash, buildRouting) {
    const existing = this.ingress.get(eventId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error('finance_group_entry_idempotency_mismatch');
      return { inserted: false, intercepted: existing.intercepted, queuedCount: existing.queuedCount };
    }
    const routed = buildRouting();
    const snapshots = [];
    for (const record of routed.records) snapshots.push(await this.enqueue(record));
    this.ingress.set(eventId, { requestHash, intercepted: routed.intercepted, queuedCount: snapshots.length });
    return { inserted: true, intercepted: routed.intercepted, queuedCount: snapshots.length };
  }
  async claimBatch(limit) {
    const claimed = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit || row.lease_token || row.available_at > clock) continue;
      if (!['pending_membership', 'membership_uncertain', 'pending_entry', 'entry_uncertain', 'pending_delivery', 'delivery_uncertain'].includes(row.status)) continue;
      row.attempts += 1;
      row.lease_token = `lease-${row.attempts}`;
      this.attempts.push(row.status);
      claimed.push({ ...row });
    }
    return claimed;
  }
  async finish(claimed, status, options = {}) {
    const row = this.rows.get(claimed.event_key);
    assert.equal(row.lease_token, claimed.lease_token);
    row.status = status;
    row.lease_token = null;
    row.available_at = options.retry ? clock + 30_000 : clock;
    row.last_error = options.error || '';
    if (options.entryUrl) row.entry_url = options.entryUrl;
    if (options.entryExpiresAt) row.entry_expires_at = options.entryExpiresAt;
    if (options.ackReference) row.ack_reference = options.ackReference;
    return { ...row };
  }
  async stats() { return { enabled: true, initialized: true }; }
}

const mapped = claimsTest.localFinanceV3Env({
  HZ2_FINANCE_CLAIMS_V3_DATABASE_URL: 'postgres://local-ledger',
  HZ2_FINANCE_CLAIMS_V3_ENABLED: 'true',
  HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED: 'true',
  LINE_CHANNEL_ACCESS_TOKEN: 'keep-global-oa-token',
});
assert.equal(mapped.DATABASE_URL, 'postgres://local-ledger');
assert.equal(mapped.HOZO_FINANCE_CLAIMS_V3_ENABLED, 'true');
assert.equal(mapped.HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED, 'true');
assert.equal(mapped.LINE_CHANNEL_ACCESS_TOKEN, 'keep-global-oa-token');

const originalEvent = message('evt-redelivery');
originalEvent.deliveryContext = { isRedelivery: false };
originalEvent.replyToken = 'reply-token-original';
const redeliveredEvent = message('evt-redelivery');
redeliveredEvent.deliveryContext = { isRedelivery: true };
redeliveredEvent.replyToken = 'reply-token-changed';
assert.equal(
  claimsTest.financeV3IngressRequestHash(originalEvent),
  claimsTest.financeV3IngressRequestHash(redeliveredEvent),
);
assert.notEqual(
  claimsTest.financeV3IngressRequestHash(originalEvent),
  claimsTest.financeV3IngressRequestHash({ ...redeliveredEvent, message: { ...redeliveredEvent.message, text: '費用申請' } }),
);

const store = new MemoryStore();
let membershipCalls = 0;
const client = {
  ready: true,
  async syncMembership(row) {
    membershipCalls += 1;
    return membershipCalls === 1 ? { kind: 'uncertain', code: 'temporary' } : { kind: row.desired_state };
  },
  async createWebEntry() {
    return { kind: 'created', url: 'https://rental.example.test/finance-claims?sourceHint=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', expiresAt: '2026-09-01T00:04:00.000Z' };
  },
  async deliver() { return { kind: 'delivered', ackReference: 'line-ack:v1:55555555-5555-4555-8555-555555555555' }; },
  async reconcile() { throw new Error('not expected'); },
};
const consumer = createFinanceClaimsV3GroupEntryConsumer({ env: localEnv(), store, client, now: () => clock, autoDrain: false });
await consumer.init();
const partitioned = consumer.partitionWebhook({ events: [message()] });
assert.equal(partitioned.intercepted, 1);
assert.equal(partitioned.records.length, 1);
assert.equal(JSON.stringify(partitioned.records).includes(GROUP), false);
assert.equal(JSON.stringify(partitioned.records).includes(USER), false);
const unknownUser = message('evt-unknown-user');
unknownUser.source.userId = `U${'c'.repeat(32)}`;
const unknownUserPartition = consumer.partitionWebhook({ events: [unknownUser] });
assert.equal(unknownUserPartition.intercepted, 1);
assert.equal(unknownUserPartition.records.length, 0);
const unknownGroup = message('evt-unknown-group');
unknownGroup.source.groupId = `C${'d'.repeat(32)}`;
assert.equal(consumer.partitionWebhook({ events: [unknownGroup] }).intercepted, 0);
const spacedKeyword = message('evt-spaced-keyword');
spacedKeyword.message.text = ' 請款 ';
assert.equal(consumer.partitionWebhook({ events: [spacedKeyword] }).records.length, 1);
const first = await consumer.ingestExternalEvent({ eventId: 'evt-1', requestHash: 'hash-1', event: message() });
const replay = await consumer.ingestExternalEvent({ eventId: 'evt-1', requestHash: 'hash-1', event: message() });
assert.deepEqual(first, { intercepted: 1, queuedCount: 1, replayedCount: 0 });
assert.deepEqual(replay, { intercepted: 1, queuedCount: 1, replayedCount: 1 });
await assert.rejects(
  consumer.ingestExternalEvent({ eventId: 'evt-1', requestHash: 'changed', event: message() }),
  /idempotency_mismatch/,
);
assert.equal(store.rows.size, 1);
assert.equal(store.ingress.size, 1);
await consumer.drainOnce();
assert.equal([...store.rows.values()][0].status, 'delivered');
assert.equal(membershipCalls, 0);
assert.deepEqual(store.attempts, ['pending_entry']);

const source = await readFile(new URL('../modules/claims/index.js', import.meta.url), 'utf8');
const groupEntrySource = await readFile(new URL('../modules/claims/v3/group-entry.js', import.meta.url), 'utf8');
const receiverSource = await readFile(new URL('../modules/claims/v3/receiver.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const envelopeSource = groupEntrySource.slice(groupEntrySource.indexOf('function entryEnvelope'), groupEntrySource.indexOf('function safeAck'));
assert.match(envelopeSource, /templateKey: 'claim_web_entry'/);
assert.doesNotMatch(envelopeSource, /claim_web_entry_test|testMode/);
assert.match(receiverSource, /const MAX_SOURCE_HINT_AGE_SECONDS = 10 \* 60;/);
assert.match(receiverSource, /expires <= nowMs \+ MAX_SOURCE_HINT_AGE_SECONDS \* 1000/);
assert.doesNotMatch(receiverSource, /expires <= nowMs \+ 5 \* 60 \* 1000/);
assert.equal(source.includes('group-events/v3'), false);
assert.equal(source.includes('enqueueProcessingJob'), false);
const preAckSource = source.slice(source.indexOf('async function preAckLineEvent'), source.indexOf('async function handleLocalFinanceV3Receiver'));
assert.doesNotMatch(preAckSource, /bindingForEvent|bindingForGroupEvent|activeClaimsAccess/);
const webhookFinancePath = serverSource.slice(serverSource.indexOf("if (req.method === 'POST' && pathname === '/webhook/line')"), serverSource.indexOf("sendText(res, 200, 'OK')"));
assert.doesNotMatch(webhookFinancePath, /router\.resolveGroupBinding/);
const v3Route = source.indexOf("prefix: '/control/finance/claim-events/v3'");
const legacyRoute = source.indexOf("prefix: '/control/finance/claim-events'");
assert.ok(v3Route >= 0 && legacyRoute >= 0 && v3Route < legacyRoute);

const tenMinuteReceiver = {
  receiverEnabled: () => true,
  bridgeEnabled: () => true,
  async bridgeMembership() { throw new Error('not expected'); },
  async bridgeWebEntry(body) {
    return { status: 200, body: {
      contractVersion: 'finance-claims-v3.am-bridge-v1', requestId: body.requestId,
      url: 'https://rental.example.test/finance-claims?sourceHint=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      expiresAt: '2026-09-01T00:10:00.000Z', replayed: false,
    } };
  },
  async deliverEnvelope() { throw new Error('not expected'); },
  async reconcileEvent() { throw new Error('not expected'); },
};
const tenMinuteClient = createGroupEntryClient({ env: localEnv(), receiver: tenMinuteReceiver, now: () => NOW });
assert.deepEqual(await tenMinuteClient.createWebEntry({
  entry_request_id: 'entry-ten-minute', tenant_key: 'hozo', source_id: 'source-hozo-company-group',
  form_key: 'general_expense', applicant_reference: USER_REF,
}), {
  kind: 'created', url: 'https://rental.example.test/finance-claims?sourceHint=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  expiresAt: '2026-09-01T00:10:00.000Z',
});

let deliveredMessage = null;
const deliveryStore = {
  async init() {},
  async beginDispatch(input) {
    return { kind: 'claimed', row: {
      tenant_key: input.tenantKey,
      event_key: input.eventKey,
      retry_key: input.retryKey,
      lease_token: input.leaseToken,
      message_text: input.messageText,
    } };
  },
  async markDelivered(row) {
    return { ...row, provider_reference: `line-ack:v1:${row.retry_key}`, status: 'delivered' };
  },
};
const deliveryEnv = localEnv();
const deliveryReceiver = createFinanceClaimsV3Receiver({
  env: deliveryEnv,
  store: deliveryStore,
  now: () => NOW,
  async fetchImpl(url, options) {
    assert.equal(String(url), 'https://api.line.me/v2/bot/message/push');
    deliveredMessage = JSON.parse(options.body);
    return {
      status: 200,
      redirected: false,
      url: 'https://api.line.me/v2/bot/message/push',
      body: null,
      headers: { get(name) { return name.toLowerCase() === 'x-line-request-id' ? 'line-request-10m-entry' : null; } },
    };
  },
});
const tenMinuteEntryUrl = 'https://rental.example.test/finance-claims?sourceHint=aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const tenMinuteDelivery = await deliveryReceiver.deliverEnvelope({
  contractVersion: 'finance-claims-v3.group-entry-v1',
  eventKey: 'entry-invite-ten-minute-delivery',
  eventType: 'claim_web_entry',
  recipient: { type: 'group_binding', identityReference: GROUP_REF },
  templateKey: 'claim_web_entry',
  payload: {
    contractVersion: 'finance-claims-v3.group-entry-v1',
    eventKey: 'entry-invite-ten-minute-delivery',
    eventType: 'claim_web_entry',
    entryUrl: tenMinuteEntryUrl,
    expiresAt: '2026-09-01T00:10:00.000Z',
  },
}, { tenantKey: 'hozo' });
assert.equal(tenMinuteDelivery.status, 200);
assert.equal(deliveredMessage.to, GROUP);
assert.match(deliveredMessage.messages[0].text, /HOZO 費用申請/);
assert.match(deliveredMessage.messages[0].text, /rental\.example\.test\/finance-claims/);

const immediateStore = new MemoryStore();
const immediateStages = [];
const immediateConsumer = createFinanceClaimsV3GroupEntryConsumer({
  env: localEnv(),
  store: immediateStore,
  client: {
    ready: true,
    async syncMembership() { throw new Error('not expected'); },
    async createWebEntry() {
      return { kind: 'created', url: tenMinuteEntryUrl, expiresAt: '2026-09-01T00:10:00.000Z' };
    },
    async deliver() { return { kind: 'delivered', ackReference: 'line-ack:v1:66666666-6666-4666-8666-666666666666' }; },
    async reconcile() { throw new Error('not expected'); },
  },
  now: () => clock,
  autoDrain: false,
  wakeOnEnqueue: true,
  onStage(stage) { immediateStages.push(stage); },
});
await immediateConsumer.init();
await immediateConsumer.ingestExternalEvent({ eventId: 'evt-immediate', requestHash: 'hash-immediate', event: message('evt-immediate') });
for (let attempt = 0; attempt < 10 && [...immediateStore.rows.values()][0]?.status !== 'delivered'; attempt += 1) {
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal([...immediateStore.rows.values()][0].status, 'delivered');
assert.deepEqual(immediateStages, ['ingress_committed', 'worker_claimed', 'rental_entry_completed', 'line_delivery_completed', 'job_completed']);

console.log('Finance Claims v3 direct AM Platform dry-run passed.');

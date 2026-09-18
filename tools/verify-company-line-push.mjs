import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import companyLinePush, { __test } from '../modules/company-line-push/index.js';

const HOZO_GROUP_ID = 'C1234567890abcdef1234567890abcdef';
const HOZO_FINANCE_GROUP_ID = 'Cabcdef1234567890abcdef1234567890';
const MAGGIE_USER_ID = 'U1234567890abcdef1234567890abcdef';
const packagedContract = JSON.parse(await readFile(new URL(
  '../versions/AM-IMP-2026.0909.01/config/finance-group-mention-contract.json', import.meta.url,
), 'utf8'));
assert.deepEqual(packagedContract.requiredBodyFields, ['text', 'mentionName', 'sourceNotificationId', 'retryKey']);
assert.match(packagedContract.sourceNotificationId, /^bank-draft-notification:v1:/);
assert.match(packagedContract.groupIdSource, /LINE 群組 ID/);

function groupBinding(name, groupId, members = {}) {
  return {
    properties: {
      Name: { type: 'title', title: [{ plain_text: name }] },
      'LINE 群組 ID': { type: 'rich_text', rich_text: [{ plain_text: groupId }] },
      '成員對照': { type: 'rich_text', rich_text: [{ plain_text: JSON.stringify(members) }] },
    },
  };
}

function sourceNotificationIdFor(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const uuid = `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
  return `bank-draft-notification:v1:${uuid}`;
}

function financeBody(text, extras = {}) {
  const mentionName = extras.mentionName || '陸昱晴';
  const imageUrls = extras.imageUrls || extras.image_urls || [];
  const sourceNotificationId = extras.sourceNotificationId || sourceNotificationIdFor(text);
  return {
    text,
    mentionName,
    sourceNotificationId,
    ...extras,
    retryKey: Object.hasOwn(extras, 'retryKey') ? extras.retryKey : __test.financeRetryKeyFor({
      sourceNotificationId: String(sourceNotificationId).trim().toLowerCase(),
      text: String(text).trim(), mentionName: String(mentionName).normalize('NFKC').trim(), imageUrls,
      mentionIdentityReference: extras.mentionIdentityReference,
    }),
  };
}

function request(body, headers = {}, url = 'https://am.example.test/control/hozo/rental/company-group/push') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = headers;
  req.url = url;
  return req;
}

function response() {
  return {
    status: 0,
    payload: null,
    headers: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload) { this.payload = payload ? JSON.parse(payload) : null; },
  };
}

async function call(route, { body, headers = {}, url, tenantKey = 'hozo-am-2-0' } = {}) {
  const res = response();
  await route.handler(request(body, headers, url), res, {
    url: new URL(url || `https://am.example.test${route.prefix}`),
    tenant: {
      key: tenantKey,
      queueAccessKey: 'tenant-control-key',
      dataSources: { groupBindings: 'group-bindings-ds' },
    },
  });
  return res;
}

const pushCalls = [];
let pushFailure = null;
let pushReceipt = { status: 200, requestId: 'line-req-1', messageIds: ['line-msg-1'] };
let bindingResults = [
  groupBinding('HOZO 公司群', HOZO_GROUP_ID, { '陸昱晴': 'Uabcdefabcdefabcdefabcdefabcdefab' }),
  groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID }),
];
let bindingPageResolver = () => ({ results: bindingResults });
const notificationIdentities = new Map();
const notificationIdentityCalls = [];
const notionCalls = [];
let notificationIdentityStoreAvailable = true;
let nowMs = Date.now();
const testPlatform = {
  queueAccessKey: 'platform-control-key',
  portalServiceToken: 'portal-service-token',
  rentalCompanyGroupPushKey: 'company-only-key',
  rentalFinanceGroupPushKey: 'rental-only-key',
  notionRequest: async (pathname, opts) => {
    notionCalls.push({ pathname, tenantKey: opts.tenantKey });
    assert.equal(pathname, '/v1/data_sources/group-bindings-ds/query');
    assert.equal(opts.tenantKey, 'hozo-am-2-0');
    return bindingPageResolver(opts.body);
  },
  pushLineMessage: async (to, text, mention, delivery) => {
    pushCalls.push({ to, text, mention, delivery });
    if (pushFailure) throw pushFailure;
    return pushReceipt;
  },
  now: () => nowMs,
  operationalMemory: {
    bindFinanceNotificationIdentity: async (_tenant, input) => {
      notificationIdentityCalls.push({ ...input });
      if (!notificationIdentityStoreAvailable) return { ok: false, skipped: 'database-not-configured' };
      const existing = notificationIdentities.get(input.sourceNotificationId);
      if (existing && (existing.payloadDigest !== input.payloadDigest
        || (existing.status !== 'legacy' && (existing.routeDigest !== input.routeDigest
          || existing.providerRetryKey !== input.providerRetryKey)))) {
        return { ok: true, conflict: true, replayed: true };
      }
      if (existing) return { ok: true, conflict: false, replayed: true, delivered: existing.status === 'delivered', manual: existing.status === 'manual', legacyUnverified: existing.status === 'legacy', createdAt: existing.createdAt };
      const row = { ...input, status: 'pending', createdAt: new Date(nowMs).toISOString() };
      notificationIdentities.set(input.sourceNotificationId, row);
      return { ok: true, conflict: false, replayed: false, delivered: false, manual: false, legacyUnverified: false, createdAt: row.createdAt };
    },
    markFinanceNotificationUncertain: async (_tenant, id) => { notificationIdentities.get(id).status = 'uncertain'; return { ok: true }; },
    markFinanceNotificationManual: async (_tenant, id) => { notificationIdentities.get(id).status = 'manual'; return { ok: true }; },
    markFinanceNotificationDelivered: async (_tenant, id) => { notificationIdentities.get(id).status = 'delivered'; return { ok: true }; },
  },
};
// Legacy map fixtures emulate registry outcomes for the existing delivery suite;
// the dedicated authority suite independently tests encrypted PostgreSQL rows.
testPlatform.resolveClaimsGroupMention = async ({ groupId, mentionName }) => {
  const page = bindingResults.find((item) => __test.extractLineGroupId(item) === groupId);
  return page ? __test.resolveMentionFromBinding(page, mentionName) : null;
};
companyLinePush.init(testPlatform);

const rentalRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/rental/company-group/push');
const rentalFinanceRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/rental/finance-group/push');
const controlRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/company-group/push');
assert.ok(rentalRoute);
assert.ok(rentalFinanceRoute);
assert.ok(controlRoute);
assert.deepEqual(rentalFinanceRoute.access, {
  kind: 'machine', scope: 'tenant', capability: 'line.push.finance-group.rental',
});
const routingBoundCallerKey = financeBody('@陸昱晴 route binding proof').retryKey;
assert.notEqual(
  __test.financeDeliveryRetryKey(routingBoundCallerKey, { groupId: HOZO_FINANCE_GROUP_ID }, { userId: MAGGIE_USER_ID }),
  __test.financeDeliveryRetryKey(routingBoundCallerKey, { groupId: HOZO_GROUP_ID }, { userId: MAGGIE_USER_ID }),
);
assert.notEqual(
  __test.financeDeliveryRetryKey(routingBoundCallerKey, { groupId: HOZO_FINANCE_GROUP_ID }, { userId: MAGGIE_USER_ID }),
  __test.financeDeliveryRetryKey(routingBoundCallerKey, { groupId: HOZO_FINANCE_GROUP_ID }, { userId: 'Uabcdefabcdefabcdefabcdefabcdefab' }),
);

let res = await call(rentalRoute, { body: { text: 'hello' } });
assert.equal(res.status, 401);

res = await call(rentalRoute, {
  headers: { authorization: 'Bearer company-only-key' },
  body: { text: 'dry run', dryRun: true },
});
assert.equal(res.status, 200);
assert.equal(res.payload.ok, true);
assert.equal(res.payload.dryRun, true);
assert.equal(res.payload.source, 'hozo-rental');
assert.equal(pushCalls.length, 0);

res = await call(rentalRoute, {
  headers: { 'x-hozo-rental-key': 'company-only-key' },
  body: {
    message: 'rental production message', retryKey: 'retry-1', timeoutMs: 1000,
    imageUrls: [
      'https://rental.hozorental.com/api/finance/bank-payment-draft-artifacts?file=one.png&share=abc',
      'http://insecure.example.test/two.png',
    ],
  },
});
assert.equal(res.status, 200);
assert.equal(res.payload.ok, true);
assert.equal(res.payload.source, 'hozo-rental');
assert.equal(pushCalls.length, 1);
assert.equal(pushCalls[0].to, HOZO_GROUP_ID);
assert.equal(pushCalls[0].text, 'rental production message');
assert.equal(pushCalls[0].delivery.retryKey, 'retry-1');
assert.equal(res.payload.imageCount, 1);
assert.deepEqual(pushCalls[0].delivery.additionalMessages, [{
  type: 'image',
  originalContentUrl: 'https://rental.hozorental.com/api/finance/bank-payment-draft-artifacts?file=one.png&share=abc',
  previewImageUrl: 'https://rental.hozorental.com/api/finance/bank-payment-draft-artifacts?file=one.png&share=abc',
}]);

res = await call(controlRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: 'wrong key for control' },
});
assert.equal(res.status, 401);

res = await call(controlRoute, {
  headers: { authorization: 'Bearer tenant-control-key' },
  body: { text: 'control message', dryRun: true },
});
assert.equal(res.status, 200);
assert.equal(res.payload.source, 'control');

const callsBeforeFinanceAuthRejections = {
  notion: notionCalls.length,
  push: pushCalls.length,
  identity: notificationIdentityCalls.length,
};
for (const attempt of [
  { headers: { authorization: 'Bearer company-only-key' } },
  { headers: { 'x-hozo-rental-key': 'rental-only-key' } },
  { headers: { 'x-amcore-key': 'rental-only-key' } },
  { url: `https://am.example.test${rentalFinanceRoute.prefix}?key=rental-only-key` },
]) {
  res = await call(rentalFinanceRoute, {
    ...attempt,
    body: financeBody('@陸昱晴 rejected alternate finance credential'),
  });
  assert.equal(res.status, 401);
}

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  tenantKey: 'forest',
  body: financeBody('@陸昱晴 wrong tenant'),
});
assert.equal(res.status, 404);
assert.deepEqual({
  notion: notionCalls.length,
  push: pushCalls.length,
  identity: notificationIdentityCalls.length,
}, callsBeforeFinanceAuthRejections);

const completedNotification = financeBody('@陸昱晴 finance workflow completed');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: completedNotification,
});
assert.equal(res.status, 200);
assert.equal(res.payload.source, 'hozo-rental-finance');
assert.equal(res.payload.target.name, 'HOZO 財務群組');
assert.deepEqual(res.payload.mention, { name: '陸昱晴', resolved: true, delivered: true });
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(res.payload.line, undefined);
assert.equal(pushCalls.length, 2);
assert.equal(pushCalls[1].to, HOZO_FINANCE_GROUP_ID);
assert.equal(pushCalls[1].text.type, 'textV2');
assert.equal(pushCalls[1].text.text, '{who} finance workflow completed');
assert.deepEqual(pushCalls[1].text.substitution.who.mentionee, { type: 'user', userId: MAGGIE_USER_ID });
assert.equal(pushCalls[1].mention, null);
assert.equal(pushCalls[1].delivery.suppressEvidenceLogs, true);
assert.match(pushCalls[1].delivery.retryKey, /^finance-provider:v1:[a-f0-9]{64}$/);

pushReceipt = { status: 409, acceptedRequestId: 'line-accepted-1', messageIds: [] };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: completedNotification,
});
assert.equal(res.status, 200);
assert.equal(res.payload.replayed, true);
assert.equal(res.payload.mention.delivered, true);
assert.equal(pushCalls.length, 2);

const acceptedConflictEvent = financeBody('@陸昱晴 provider accepted retry conflict');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: acceptedConflictEvent,
});
assert.equal(res.status, 200);
assert.equal(res.payload.line, undefined);
assert.equal(res.payload.mention.delivered, true);
assert.equal(pushCalls.length, 3);

pushReceipt = { status: 200, requestId: 'line-req-2', messageIds: ['line-msg-2'] };
const distinctEventSameText = financeBody('@陸昱晴 finance workflow completed', {
  sourceNotificationId: 'bank-draft-notification:v1:11111111-1111-4111-8111-111111111111',
});
assert.notEqual(distinctEventSameText.retryKey, completedNotification.retryKey);
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: distinctEventSameText,
});
assert.equal(res.status, 200);
assert.notEqual(pushCalls.at(-1).delivery.retryKey, pushCalls[1].delivery.retryKey);

const sameSourceChangedContent = financeBody('@陸昱晴 corrected finance workflow message', {
  sourceNotificationId: completedNotification.sourceNotificationId,
});
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: sameSourceChangedContent,
});
assert.equal(res.status, 409);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'source_notification_conflict');

pushReceipt = { status: 409, acceptedRequestId: '', messageIds: [] };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 unconfirmed provider conflict'),
});
assert.equal(res.status, 502);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'line_push_unconfirmed');
assert.equal(res.payload.mention, undefined);
pushReceipt = { status: 200, requestId: 'line-req-1', messageIds: ['line-msg-1'] };

const braceNotification = financeBody('@陸昱晴 請看 {invoice} 與 {{raw}}');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: braceNotification,
});
assert.equal(res.status, 200);
assert.equal(pushCalls.at(-1).text.text, '{who} 請看 {{invoice}} 與 {{{{raw}}}}');
assert.deepEqual(Object.keys(pushCalls.at(-1).text.substitution), ['who']);

const callsBeforeOversized = notificationIdentityCalls.length;
const pushesBeforeOversized = pushCalls.length;
const oversizedText = `@陸昱晴 ${'😀'.repeat(2000)}${'{'.repeat(600)}`;
assert.ok(oversizedText.length <= 4900);
assert.throws(
  () => __test.financeMentionMessage(oversizedText, { name: '陸昱晴', userId: MAGGIE_USER_ID }),
  (error) => error?.code === 'invalid_text',
);
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody(oversizedText),
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_text');
assert.equal(notificationIdentityCalls.length, callsBeforeOversized);
assert.equal(pushCalls.length, pushesBeforeOversized);

for (const receipt of [
  { status: 200, requestId: '' },
  { status: 200, requestId: MAGGIE_USER_ID },
  { status: 202, requestId: 'line-202' },
  { status: 204, requestId: 'line-204' },
  { status: 409, acceptedRequestId: MAGGIE_USER_ID },
]) {
  pushReceipt = receipt;
  res = await call(rentalFinanceRoute, {
    headers: { authorization: 'Bearer rental-only-key' },
    body: financeBody(`@陸昱晴 rejected evidence ${JSON.stringify(receipt)}`),
  });
  assert.equal(res.status, 502);
  assert.equal(res.payload.code, 'line_push_unconfirmed');
  assert.equal(res.payload.mention, undefined);
  assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
}

pushReceipt = { status: 202, requestId: 'line-uncertain' };
const retryableNotification = financeBody('@陸昱晴 retry inside provider window');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' }, body: retryableNotification,
});
assert.equal(res.status, 502);
const uncertainRetryKey = pushCalls.at(-1).delivery.retryKey;
pushReceipt = { status: 200, requestId: 'line-retry-ok' };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' }, body: retryableNotification,
});
assert.equal(res.status, 200);
assert.equal(pushCalls.at(-1).delivery.retryKey, uncertainRetryKey);

pushReceipt = { status: 202, requestId: 'line-old-uncertain' };
const expiredNotification = financeBody('@陸昱晴 expired provider retry');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' }, body: expiredNotification,
});
assert.equal(res.status, 502);
const expiredPushCount = pushCalls.length;
notificationIdentities.get(expiredNotification.sourceNotificationId).createdAt = new Date(
  nowMs - __test.FINANCE_PROVIDER_RETRY_WINDOW_MS,
).toISOString();
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' }, body: expiredNotification,
});
assert.equal(res.status, 409);
assert.equal(res.payload.code, 'manual_reconciliation_required');
assert.equal(pushCalls.length, expiredPushCount);
assert.equal(notificationIdentities.get(expiredNotification.sourceNotificationId).status, 'manual');

const legacyNotification = financeBody('@陸昱晴 legacy succeeded without evidence');
notificationIdentities.set(legacyNotification.sourceNotificationId, {
  payloadDigest: legacyNotification.retryKey.slice(-64),
  status: 'legacy',
  createdAt: new Date(nowMs).toISOString(),
});
const legacyPushCount = pushCalls.length;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' }, body: legacyNotification,
});
assert.equal(res.status, 409);
assert.equal(res.payload.code, 'manual_reconciliation_required');
assert.equal(pushCalls.length, legacyPushCount);
assert.equal(notificationIdentities.get(legacyNotification.sourceNotificationId).status, 'manual');

pushReceipt = { status: 200, requestId: 'line-req-1', messageIds: ['line-msg-1'] };

const pushCountAfterMention = pushCalls.length;

const missingSourceNotificationId = financeBody('@陸昱晴 missing source notification id');
delete missingSourceNotificationId.sourceNotificationId;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: missingSourceNotificationId,
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_source_notification_id');
assert.equal(pushCalls.length, pushCountAfterMention);

notificationIdentityStoreAvailable = false;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 unavailable identity store'),
});
assert.equal(res.status, 503);
assert.equal(res.payload.code, 'idempotency_store_unavailable');
assert.equal(pushCalls.length, pushCountAfterMention);
notificationIdentityStoreAvailable = true;

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 malformed source notification id', { sourceNotificationId: 'bank-draft-notification:v1:not-a-uuid' }),
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_source_notification_id');
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 missing mention field' },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'mention_required');
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: 'name absent from text', mentionName: '陸昱晴' },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'mention_not_in_text');
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: {
    text: '@陸昱晴 missing retry key', mentionName: '陸昱晴',
    sourceNotificationId: sourceNotificationIdFor('missing retry key'),
  },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_retry_key');
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 invalid retry key', { retryKey: `finance-notification:v1:${'a'.repeat(65)}` }),
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_retry_key');
assert.equal(pushCalls.length, pushCountAfterMention);

const boundToDifferentText = financeBody('@陸昱晴 original payload').retryKey;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 changed payload', { retryKey: boundToDifferentText }),
});
assert.equal(res.status, 409);
assert.equal(res.payload.code, 'idempotency_key_mismatch');
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 forbidden caller identity', mentionName: '陸昱晴', userId: MAGGIE_USER_ID },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_payload');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterMention);

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 forbidden caller target', mentionName: '陸昱晴', groupId: HOZO_FINANCE_GROUP_ID },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_payload');
assert.ok(!JSON.stringify(res.payload).includes(HOZO_FINANCE_GROUP_ID));
assert.equal(pushCalls.length, pushCountAfterMention);

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })];
pushFailure = Object.assign(new Error(`provider rejected mention ${MAGGIE_USER_ID}`), {
  code: 'LINE_PUSH_FAILED', lineStatus: 400, requestId: 'line-failed-request',
});
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 provider failure'),
});
assert.equal(res.status, 502);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'line_push_failed');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
pushFailure = null;
const pushCountAfterProviderFailure = pushCalls.length;

bindingResults = [
  groupBinding('HOZO 公司群', HOZO_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID }),
  groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, {}),
];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 wrong-page identity must not be used'),
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const fuzzyFinanceBinding = groupBinding('Unrelated group', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID });
fuzzyFinanceBinding.properties.Description = { type: 'rich_text', rich_text: [{ plain_text: 'notes mention HOZO 財務群組' }] };
bindingResults = [fuzzyFinanceBinding];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 fuzzy group text must not route'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const groupIdOnlyInUnrelatedText = groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID });
delete groupIdOnlyInUnrelatedText.properties['LINE 群組 ID'];
groupIdOnlyInUnrelatedText.properties.Description = {
  type: 'rich_text', rich_text: [{ plain_text: `legacy target ${HOZO_FINANCE_GROUP_ID}` }],
};
bindingResults = [groupIdOnlyInUnrelatedText];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 unrelated group id text must not route'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const multipleCanonicalGroupIds = groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID });
multipleCanonicalGroupIds.properties['LINE 群組 ID'].rich_text.push({ plain_text: HOZO_GROUP_ID });
bindingResults = [multipleCanonicalGroupIds];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 multiple canonical group ids must not route'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

bindingResults = [groupBinding('HOZO 財務群組', 'C-too-short', { '陸昱晴': MAGGIE_USER_ID })];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 malformed canonical group id must not route'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const conflictingCanonicalName = groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID });
conflictingCanonicalName.properties['群組名稱'] = { type: 'rich_text', rich_text: [{ plain_text: 'Unrelated group' }] };
bindingResults = [conflictingCanonicalName];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 explicit canonical name must win'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const duplicateFinanceBinding = groupBinding('HOZO 財務群組', `C${'1'.repeat(32)}`, { '陸昱晴': MAGGIE_USER_ID });
bindingPageResolver = (body) => body.start_cursor
  ? { results: [duplicateFinanceBinding], has_more: false }
  : { results: [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })], has_more: true, next_cursor: 'page-2' };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 duplicate binding on page two'),
});
assert.equal(res.status, 500);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);
bindingPageResolver = () => ({ results: bindingResults });

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': 'not-a-line-user' })];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 invalid identity'),
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.ok(!JSON.stringify(res.payload).includes('not-a-line-user'));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const malformedBinding = groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID);
malformedBinding.properties['成員對照'].rich_text[0].plain_text = '{invalid-json';
bindingResults = [malformedBinding];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 malformed member map'),
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const duplicateRawKeyBinding = groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID);
duplicateRawKeyBinding.properties['成員對照'].rich_text[0].plain_text = `{"\u9678\u6631\u6674":"${MAGGIE_USER_ID}","\u9678\u6631\u6674":"Uabcdefabcdefabcdefabcdefabcdefab"}`;
bindingResults = [duplicateRawKeyBinding];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 duplicate raw member key'),
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, {
  '陸昱晴': MAGGIE_USER_ID,
  ' 陸昱晴 ': 'Uabcdefabcdefabcdefabcdefabcdefab',
})];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 ambiguous identity'),
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })];
const identityCallCountBeforeDryRun = notificationIdentityCalls.length;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 dry run mention', { dryRun: true }),
});
assert.equal(res.status, 200);
assert.deepEqual(res.payload.mention, { name: '陸昱晴', resolved: true, delivered: false });
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);
assert.equal(notificationIdentityCalls.length, identityCallCountBeforeDryRun);

// Registered members, not stale Notion member maps, determine the actual mention.
testPlatform.resolveClaimsGroupMention = async () => ({ name: '陸昱晴', userId: MAGGIE_USER_ID });
bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, {})];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 registry member success'),
});
assert.equal(res.status, 200);
assert.equal(res.payload.mention.delivered, true);
assert.equal(pushCalls.at(-1).text.substitution.who.mentionee.userId, MAGGIE_USER_ID);
const registryPushCount = pushCalls.length;
testPlatform.resolveClaimsGroupMention = async () => null;
bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 registry refuses stale map'),
});
assert.equal(res.status, 422);
assert.equal(pushCalls.length, registryPushCount);
delete testPlatform.resolveClaimsGroupMention;
testPlatform.resolveClaimsGroupMention = async () => ({ resolved: false, reason: 'member_reference_missing' });
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 registry safe reason'),
});
assert.equal(res.status, 422);
assert.match(res.payload.error, /member_reference_missing/u);
assert.equal(pushCalls.length, registryPushCount);
testPlatform.resolveClaimsGroupMention = async () => ({ resolved: false, reason: MAGGIE_USER_ID });
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 registry reason redacted'),
});
assert.equal(res.status, 422);
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
delete testPlatform.resolveClaimsGroupMention;
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 registry unavailable'),
});
assert.equal(res.status, 503);
assert.equal(res.payload.code, 'claims_registry_unavailable');
assert.equal(pushCalls.length, registryPushCount);

const reviewerReference = 'line-ref:v1:11111111-1111-4111-8111-111111111111';
testPlatform.resolveClaimsGroupMention = async (input) => {
  assert.equal(input.mentionIdentityReference, reviewerReference);
  assert.equal(input.groupId, HOZO_FINANCE_GROUP_ID);
  return { name: '陸昱晴', userId: MAGGIE_USER_ID };
};
const referenceBody = financeBody('@陸昱晴 verified opaque reviewer', { mentionIdentityReference: reviewerReference });
assert.notEqual(referenceBody.retryKey, financeBody(referenceBody.text).retryKey);
assert.notEqual(referenceBody.retryKey, financeBody(referenceBody.text, {
  mentionIdentityReference: 'line-ref:v1:22222222-2222-4222-8222-222222222222',
}).retryKey);
res = await call(rentalFinanceRoute, { headers: { authorization: 'Bearer rental-only-key' }, body: referenceBody });
assert.equal(res.status, 200);
assert.equal(res.payload.mention.delivered, true);
assert.equal(pushCalls.at(-1).text.substitution.who.mentionee.userId, MAGGIE_USER_ID);
const referencePushCount = pushCalls.length;
res = await call(rentalFinanceRoute, { headers: { authorization: 'Bearer rental-only-key' }, body: referenceBody });
assert.equal(res.payload.replayed, true);
assert.equal(pushCalls.length, referencePushCount);
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody(completedNotification.text, { sourceNotificationId: completedNotification.sourceNotificationId, mentionIdentityReference: reviewerReference }),
});
assert.equal(res.status, 409, 'Changing an already bound source event to v2 must not duplicate delivery.');
assert.equal(res.payload.code, 'source_notification_conflict');
assert.equal(pushCalls.length, referencePushCount);
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { ...referenceBody, mentionIdentityReference: 'bad' },
});
assert.equal(res.status, 400);
assert.equal(res.payload.code, 'invalid_mention_reference');
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { ...referenceBody, mentionIdentityReference: 'line-ref:v1:22222222-2222-4222-8222-222222222222' },
});
assert.equal(res.status, 409);
assert.equal(res.payload.code, 'idempotency_key_mismatch');
assert.equal(pushCalls.length, referencePushCount);
const diagnosticPushCount = pushCalls.length;
testPlatform.resolveClaimsGroupMention = async () => { throw new Error('Claims authority ciphertext could not be authenticated.'); };
res = await call(rentalFinanceRoute, { headers: { authorization: 'Bearer rental-only-key' }, body: referenceBody });
assert.equal(res.status,500);
assert.equal(res.payload.failureStage,'recipient_registry');
assert.equal(res.payload.failureKind,'ciphertext_authentication_failed');
testPlatform.resolveClaimsGroupMention = async () => ({name:'陸昱晴',userId:MAGGIE_USER_ID});
const originalBind = testPlatform.operationalMemory.bindFinanceNotificationIdentity;
testPlatform.operationalMemory.bindFinanceNotificationIdentity = async () => {
  throw Object.assign(new Error('synthetic private detail '+MAGGIE_USER_ID),{code:'42703'});
};
res = await call(rentalFinanceRoute, { headers: { authorization: 'Bearer rental-only-key' }, body: referenceBody });
assert.equal(res.payload.failureStage,'delivery_identity');
assert.equal(res.payload.failureKind,'database_query_rejected');
assert.equal(res.payload.sqlState,'42703');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.ok(!JSON.stringify(res.payload).includes('synthetic private detail'));
testPlatform.operationalMemory.bindFinanceNotificationIdentity = originalBind;
assert.equal(pushCalls.length,diagnosticPushCount);
for (const [syntheticError, kind] of [
  [new Error('timeout exceeded when trying to connect'),'database_connection_timeout'],
  [Object.assign(new Error('private database host'),{code:'ENOTFOUND'}),'database_connection_failed'],
  [new AggregateError([Object.assign(new Error('private IPv6 host'),{code:'ENETUNREACH'})]),'database_connection_failed'],
  [Object.assign(new Error('private password detail'),{code:'28P01'}),'database_authentication_failed'],
  [Object.assign(new Error('private constraint detail'),{code:'42P10'}),'database_query_rejected'],
  [Object.assign(new Error('private certificate'),{code:'SELF_SIGNED_CERT_IN_CHAIN'}),'database_tls_rejected'],
  [new Error('The server does not support SSL connections'),'database_ssl_unavailable'],
  [new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string'),'database_authentication_failed'],
  [new Error('Invalid finance notification identity'),'invalid_event_binding'],
  [new Error('Unable to persist finance notification identity'),'durable_event_missing'],
]) {
  testPlatform.operationalMemory.bindFinanceNotificationIdentity = async () => { throw syntheticError; };
  res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:referenceBody});
  assert.equal(res.status,500);
  assert.equal(res.payload.failureStage,'delivery_identity');
  assert.equal(res.payload.failureKind,kind);
  assert.ok(!JSON.stringify(res.payload).includes('private '));
  assert.equal(pushCalls.length,diagnosticPushCount);
}
testPlatform.operationalMemory.bindFinanceNotificationIdentity = originalBind;
const originError = new TypeError('private exception '+MAGGIE_USER_ID);
originError.stack = 'TypeError: private detail\n at async /private/deploy/node_modules/pg-pool/index.js:47:12\n at /private/deploy/core/operational-memory.js:143:20';
testPlatform.operationalMemory.bindFinanceNotificationIdentity = async () => {throw originError;};
res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:referenceBody});
assert.equal(res.payload.failureClass,'TypeError');
assert.equal(res.payload.failureOrigin,'postgres_pool');
assert.equal(res.payload.failureLine,47);
assert.ok(!JSON.stringify(res.payload).includes('private'));
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length,diagnosticPushCount);
testPlatform.operationalMemory.bindFinanceNotificationIdentity = originalBind;
console.log('Company LINE push verification passed: actual receipt, immutable retries and allowlisted stage/class/origin diagnostics without private exceptions.');
// Dedicated reconciliation events must never masquerade as bank drafts.
bindingResults = [groupBinding('HOZO 財務群組',HOZO_FINANCE_GROUP_ID,{'陸昱晴':MAGGIE_USER_ID})];
bindingPageResolver = () => ({results:bindingResults});
pushFailure = null;
pushReceipt = {status:200,requestId:'reconciliation-receipt'};
notificationIdentityStoreAvailable = true;
testPlatform.resolveClaimsGroupMention = async () => ({name:'陸昱晴',userId:MAGGIE_USER_ID});
const reconciliationId = 'bank-reconciliation-notification:v1:12121212-1212-4212-8212-121212121212';
const reconciliationRef = 'line-ref:v1:12121212-1212-4212-8212-121212121212';
let beforeReconciliation = pushCalls.length;
res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:financeBody('@陸昱晴 reconciliation review',{sourceNotificationId:reconciliationId})});
assert.equal(res.status,400);
assert.equal(res.payload.code,'invalid_reconciliation_contract');
assert.equal(pushCalls.length,beforeReconciliation);
const reconciliationBody = financeBody('@陸昱晴 reconciliation review',{sourceNotificationId:reconciliationId,mentionIdentityReference:reconciliationRef});
res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:reconciliationBody});
assert.equal(res.status,200);
assert.equal(res.payload.mention.delivered,true);
assert.equal(pushCalls.length,beforeReconciliation+1);
res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:reconciliationBody});
assert.equal(res.payload.replayed,true);
assert.equal(pushCalls.length,beforeReconciliation+1);
res = await call(rentalFinanceRoute,{headers:{authorization:'Bearer rental-only-key'},body:financeBody('@陸昱晴 changed reconciliation review',{sourceNotificationId:reconciliationId,mentionIdentityReference:reconciliationRef})});
assert.equal(res.status,409);
assert.equal(pushCalls.length,beforeReconciliation+1);
console.log('Dedicated bank reconciliation event: verified reference, true mention, immutable replay and conflicts passed.');

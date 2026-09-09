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

async function call(route, { body, headers = {}, url } = {}) {
  const res = response();
  await route.handler(request(body, headers, url), res, {
    url: new URL(url || `https://am.example.test${route.prefix}`),
    tenant: {
      key: 'hozo-am-2-0',
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
let notificationIdentityStoreAvailable = true;
companyLinePush.init({
  queueAccessKey: 'platform-control-key',
  portalServiceToken: 'portal-service-token',
  rentalCompanyGroupPushKey: 'rental-only-key',
  notionRequest: async (pathname, opts) => {
    assert.equal(pathname, '/v1/data_sources/group-bindings-ds/query');
    assert.equal(opts.tenantKey, 'hozo-am-2-0');
    return bindingPageResolver(opts.body);
  },
  pushLineMessage: async (to, text, mention, delivery) => {
    pushCalls.push({ to, text, mention, delivery });
    if (pushFailure) throw pushFailure;
    return pushReceipt;
  },
  operationalMemory: {
    bindProcessingIdentity: async (_tenant, input) => {
      if (!notificationIdentityStoreAvailable) return { ok: false, skipped: 'database-not-configured' };
      const key = `${input.jobKind}:${input.idempotencyKey}`;
      const existing = notificationIdentities.get(key);
      if (existing && existing !== input.payloadDigest) return { ok: true, conflict: true, replayed: true };
      if (existing) return { ok: true, conflict: false, replayed: true };
      notificationIdentities.set(key, input.payloadDigest);
      return { ok: true, conflict: false, replayed: false };
    },
  },
});

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
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: 'dry run', dryRun: true },
});
assert.equal(res.status, 200);
assert.equal(res.payload.ok, true);
assert.equal(res.payload.dryRun, true);
assert.equal(res.payload.source, 'hozo-rental');
assert.equal(pushCalls.length, 0);

res = await call(rentalRoute, {
  headers: { 'x-hozo-rental-key': 'rental-only-key' },
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
assert.equal(pushCalls.length, 2);
assert.equal(pushCalls[1].to, HOZO_FINANCE_GROUP_ID);
assert.equal(pushCalls[1].text, '@陸昱晴 finance workflow completed');
assert.deepEqual(pushCalls[1].mention, { name: '陸昱晴', userId: MAGGIE_USER_ID });
assert.match(pushCalls[1].delivery.retryKey, /^finance-provider:v1:[a-f0-9]{64}$/);

pushReceipt = { status: 409, acceptedRequestId: 'line-accepted-1', messageIds: [] };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: completedNotification,
});
assert.equal(res.status, 200);
assert.equal(res.payload.line.status, 409);
assert.equal(res.payload.mention.delivered, true);
assert.equal(pushCalls[2].delivery.retryKey, pushCalls[1].delivery.retryKey);

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
assert.equal(res.status, 500);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(res.payload.mention, undefined);
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
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: financeBody('@陸昱晴 dry run mention', { dryRun: true }),
});
assert.equal(res.status, 200);
assert.deepEqual(res.payload.mention, { name: '陸昱晴', resolved: true, delivered: false });
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

console.log('Company LINE push verification passed: finance mention identity is binding-scoped, fail-closed, non-leaking, and passed to LINE textV2 delivery.');

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import companyLinePush from '../modules/company-line-push/index.js';

const HOZO_GROUP_ID = 'C1234567890abcdef123456';
const HOZO_FINANCE_GROUP_ID = 'Cabcdef1234567890abcdef';
const MAGGIE_USER_ID = 'U1234567890abcdef1234567890abcdef';

function groupBinding(name, groupId, members = {}) {
  return {
    properties: {
      Name: { type: 'title', title: [{ plain_text: name }] },
      LineId: { type: 'rich_text', rich_text: [{ plain_text: groupId }] },
      '成員對照': { type: 'rich_text', rich_text: [{ plain_text: JSON.stringify(members) }] },
    },
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
let bindingResults = [
  groupBinding('HOZO 公司群', HOZO_GROUP_ID, { '陸昱晴': 'Uabcdefabcdefabcdefabcdefabcdefab' }),
  groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID }),
];
let bindingPageResolver = () => ({ results: bindingResults });
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
    return { status: 200, requestId: 'line-req-1', messageIds: ['line-msg-1'] };
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

res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 finance workflow completed', mentionName: '陸昱晴', retryKey: 'finance-retry-1' },
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
assert.equal(pushCalls[1].delivery.retryKey, 'finance-retry-1');

const pushCountAfterMention = pushCalls.length;

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
  body: { text: '@陸昱晴 provider failure', mentionName: '陸昱晴' },
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
  body: { text: '@陸昱晴 wrong-page identity must not be used', mentionName: '陸昱晴' },
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

const duplicateFinanceBinding = groupBinding('HOZO 財務群組 duplicate', 'C111111111111111111111', { '陸昱晴': MAGGIE_USER_ID });
bindingPageResolver = (body) => body.start_cursor
  ? { results: [duplicateFinanceBinding], has_more: false }
  : { results: [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })], has_more: true, next_cursor: 'page-2' };
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 duplicate binding on page two', mentionName: '陸昱晴' },
});
assert.equal(res.status, 500);
assert.equal(res.payload.ok, false);
assert.equal(res.payload.code, 'finance_notification_failed');
assert.equal(pushCalls.length, pushCountAfterProviderFailure);
bindingPageResolver = () => ({ results: bindingResults });

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': 'not-a-line-user' })];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 invalid identity', mentionName: '陸昱晴' },
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
  body: { text: '@陸昱晴 malformed member map', mentionName: '陸昱晴' },
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
  body: { text: '@陸昱晴 ambiguous identity', mentionName: '陸昱晴' },
});
assert.equal(res.status, 422);
assert.equal(res.payload.code, 'mention_not_resolved');
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

bindingResults = [groupBinding('HOZO 財務群組', HOZO_FINANCE_GROUP_ID, { '陸昱晴': MAGGIE_USER_ID })];
res = await call(rentalFinanceRoute, {
  headers: { authorization: 'Bearer rental-only-key' },
  body: { text: '@陸昱晴 dry run mention', mentionName: '陸昱晴', dryRun: true },
});
assert.equal(res.status, 200);
assert.deepEqual(res.payload.mention, { name: '陸昱晴', resolved: true, delivered: false });
assert.ok(!JSON.stringify(res.payload).includes(MAGGIE_USER_ID));
assert.equal(pushCalls.length, pushCountAfterProviderFailure);

console.log('Company LINE push verification passed: finance mention identity is binding-scoped, fail-closed, non-leaking, and passed to LINE textV2 delivery.');

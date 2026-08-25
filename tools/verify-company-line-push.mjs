import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import companyLinePush from '../modules/company-line-push/index.js';

const HOZO_GROUP_ID = 'C1234567890abcdef123456';
const HOZO_FINANCE_GROUP_ID = 'Cabcdef1234567890abcdef';

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
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
    },
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
companyLinePush.init({
  queueAccessKey: 'platform-control-key',
  portalServiceToken: 'portal-service-token',
  rentalCompanyGroupPushKey: 'rental-only-key',
  notionRequest: async (pathname, opts) => {
    assert.equal(pathname, '/v1/data_sources/group-bindings-ds/query');
    assert.equal(opts.tenantKey, 'hozo-am-2-0');
    return {
      results: [
        {
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'HOZO 公司群' }] },
            LineId: { type: 'rich_text', rich_text: [{ plain_text: HOZO_GROUP_ID }] },
          },
        },
        {
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'HOZO 財務群組' }] },
            LineId: { type: 'rich_text', rich_text: [{ plain_text: HOZO_FINANCE_GROUP_ID }] },
          },
        },
      ],
    };
  },
  pushLineMessage: async (to, text, mention, delivery) => {
    pushCalls.push({ to, text, mention, delivery });
    return { status: 200, requestId: 'line-req-1', messageIds: ['line-msg-1'] };
  },
});

const rentalRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/rental/company-group/push');
const rentalFinanceRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/rental/finance-group/push');
const controlRoute = companyLinePush.routes.find((route) => route.prefix === '/control/hozo/company-group/push');
assert.ok(rentalRoute, 'Rental company-group push route should exist.');
assert.ok(rentalFinanceRoute, 'Rental finance-group push route should exist.');
assert.ok(controlRoute, 'Control company-group push route should exist.');

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
    message: 'rental production message',
    retryKey: 'retry-1',
    timeoutMs: 1000,
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
  body: { text: 'finance workflow completed', retryKey: 'finance-retry-1' },
});
assert.equal(res.status, 200);
assert.equal(res.payload.source, 'hozo-rental-finance');
assert.equal(res.payload.target.name, 'HOZO 財務群組');
assert.equal(pushCalls.length, 2);
assert.equal(pushCalls[1].to, HOZO_FINANCE_GROUP_ID);
assert.equal(pushCalls[1].text, 'finance workflow completed');
assert.equal(pushCalls[1].delivery.retryKey, 'finance-retry-1');

console.log('Company LINE push verification passed: company and finance routing, Rental auth, dry-run, and control separation are working.');

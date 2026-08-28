import assert from 'node:assert/strict';
import { handleContractsRequest } from '../modules/construction/contracts.js';
import { __test as constructionTest } from '../modules/construction/index.js';
import construction from '../modules/construction/index.js';

function response() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value = '') { this.body = String(value); },
  };
}

const pageRes = response();
await handleContractsRequest(
  { method: 'GET' },
  pageRes,
  '/contracts',
  new URL('https://example.test/contracts?contract=1&contractManage=1'),
  { tenantKey: 'engineering' },
);
assert.equal(pageRes.status, 200);
assert.match(pageRes.body, /工程合約管理/);
assert.match(pageRes.body, /待我方確認/);
assert.match(pageRes.body, /付款管理/);
assert.match(pageRes.body, /驗收管理/);
assert.match(pageRes.body, /const CAN_MANAGE = true/);
assert.doesNotMatch(pageRes.body, /localStorage/);

const tenant = { key: 'engineering' };
const access = {
  allowed: true,
  isPlatformOwner: false,
  user: {
    role: 'member',
    allowedFeatures: ['am-engineering-contract-view', 'am-engineering-contract-issue'],
  },
};
const portal = {
  resolveAccess: async () => access,
  tenantScope: () => 'ZS',
  featureGranted: (user, _tenant, feature) => user.allowedFeatures.includes(`am-engineering-${feature}`),
};
const auth = await constructionTest.resolveAuth(portal, tenant, {}, access);
assert.equal(auth.canContract, true);
assert.equal(auth.canContractManage, false);
assert.equal(auth.canContractIssue, true);
assert.equal(auth.canContractConfirm, false);
assert.equal(auth.scope, 'ZS');
const publicSigningRoute = construction.routes.find((route) => route.prefix === '/contract-sign');
assert.equal(publicSigningRoute?.access?.kind, 'public');

console.log('Engineering contract workspace dry-run passed: graphical workspace and split permissions verified.');

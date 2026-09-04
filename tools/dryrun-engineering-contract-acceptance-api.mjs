import assert from 'node:assert/strict';
import { createContractAcceptanceApiHandler } from '../modules/construction/contract-acceptance-api.js';

const calls = [];
const service = {
  async get(context, input) {
    calls.push({ operation: 'get', context, input });
    return { status: 'in_progress' };
  },
  async submit(context, input) {
    calls.push({ operation: 'submit', context, input });
    return { status: 'submitted' };
  },
  async review(context, input) {
    calls.push({ operation: 'review', context, input });
    return { status: 'accepted' };
  },
  async reopen(context, input) {
    calls.push({ operation: 'reopen', context, input });
    return { status: 'rework_required' };
  },
};
const serverContext = Object.freeze({
  actor: 'server-authorized-actor',
  tenant: { key: 'engineering-tenant' },
  scope: { projectIds: ['eng-project-1'] },
  actorRoles: ['engineering_admin'],
});
const handler = createContractAcceptanceApiHandler({
  acceptanceService: service,
  resolveContext: async () => serverContext,
  readJson: async (req) => req.body || {},
  send: (res, status, payload) => {
    res.status = status;
    res.payload = payload;
  },
});

async function request(method, pathname, body) {
  const response = {};
  const handled = await handler({ method, body }, response, new URL('https://example.test' + pathname));
  assert.equal(handled, true);
  return response;
}

let response = await request('GET', '/contracts/api/v2/contracts/contract-1/acceptance/version-1');
assert.equal(response.status, 200);
assert.equal(response.payload.data.status, 'in_progress');
assert.deepEqual(calls.at(-1), {
  operation: 'get',
  context: serverContext,
  input: { contractId: 'contract-1', versionId: 'version-1' },
});

response = await request('POST', '/contracts/api/v2/contracts/contract-1/acceptance/version-1/submit', {
  contractId: 'contract-1',
  versionId: 'version-1',
  itemId: 'cleanup',
  actor: 'client-override',
  tenant: { key: 'other-tenant' },
  scope: { projectIds: ['other-project'] },
});
assert.equal(response.status, 200);
assert.equal(response.payload.data.status, 'submitted');
assert.deepEqual(calls.at(-1), {
  operation: 'submit',
  context: serverContext,
  input: { contractId: 'contract-1', versionId: 'version-1', itemId: 'cleanup' },
});

response = await request('POST', '/contracts/api/v2/contracts/contract-1/acceptance/version-1/review', {
  contractId: 'contract-1',
  versionId: 'version-1',
  itemId: 'cleanup',
  decision: 'accepted',
});
assert.equal(response.status, 200);
assert.equal(calls.at(-1).operation, 'review');

response = await request('POST', '/contracts/api/v2/contracts/contract-1/acceptance/version-1/reopen', {
  contractId: 'contract-1',
  versionId: 'version-1',
  itemId: 'cleanup',
  note: '補正紀錄',
});
assert.equal(response.status, 200);
assert.equal(calls.at(-1).operation, 'reopen');

response = await request('POST', '/contracts/api/v2/contracts/contract-1/acceptance/version-1/submit', {
  contractId: 'different-contract',
  versionId: 'version-1',
});
assert.equal(response.status, 400);
assert.equal(response.payload.error.code, 'ACCEPTANCE_PATH_BODY_MISMATCH');

response = await request('POST', '/contracts/api/v2/contracts/contract-1/acceptance/version-1');
assert.equal(response.status, 405);
assert.equal(response.payload.error.code, 'ACCEPTANCE_METHOD_NOT_ALLOWED');

response = await request('GET', '/contracts/api/v2/contracts/contract-1/acceptance/version-1%2Fother');
assert.equal(response.status, 400);
assert.equal(response.payload.error.code, 'ACCEPTANCE_ROUTE_REFERENCE_INVALID');

response = {};
assert.equal(await handler({ method: 'GET' }, response, new URL('https://example.test/contracts/api/v2/contracts')), false);

console.log('Engineering contract acceptance API dry-run passed: routed read/submit/review/reopen, server-owned authority, path/body matching, and method/route rejection verified.');

import assert from 'node:assert/strict';
import { createClaimsAuthorityAdminHandler, renderClaimsAuthorityAdminPage } from '../core/claims-authority-admin.js';

const actor = { subject: 'synthetic-owner', roles: ['platform_owner'] };
const tenant = { key: 'synthetic', tenantId: '00000000-0000-4000-8000-000000000001' };
const calls = [];
const authority = {
  listGroups: async (input) => { calls.push(['groups', input]); return [{ group_lookup: 'a'.repeat(64), state: 'active' }]; },
  listUnassigned: async (input) => { calls.push(['unassigned', input]); return [{ group_lookup: 'b'.repeat(64), state: 'unassigned' }]; },
  listMembers: async (input) => { calls.push(['members', input]); return [{ member_lookup: 'c'.repeat(64), state: 'observed' }]; },
  assignGroup: async (input) => { calls.push(['assign', input]); return { ok: true }; },
  setMemberDenied: async (input) => { calls.push(['deny', input]); return { ok: true }; },
  setGroupState: async (input) => { calls.push(['state', input]); return { ok: true }; },
};
let mutationChecks = 0;
let discoverySyncs = 0;
const handler = createClaimsAuthorityAdminHandler({
  authority,
  resolveContext: async () => ({ actor, tenant, csrfToken: 'synthetic-csrf' }),
  listTargets: async () => [{ key: 'hozo-default', label: 'HOZO｜預設請款群組' }],
  resolveTarget: async () => ({ tenant, bindingId: 'binding', financeScope: {} }),
  verifyMutation: async () => { mutationChecks += 1; },
  syncDiscovery: async () => { discoverySyncs += 1; return { ok: true, scanned: 4, verified: 3 }; },
});

const page = renderClaimsAuthorityAdminPage();
assert.match(page, /Finance V3 請款授權/u);
assert.match(page, /待綁定群組/u);
assert.match(page, /綁定勾選群組/u);
assert.match(page, /重新掃描已知群組/u);
assert.doesNotMatch(page, /innerHTML/u);

const request = (path, options = {}) => ({
  method: options.method || 'GET',
  url: `https://example.invalid${path}`,
  json: async () => options.body || {},
});

let response = await handler(request('/claims-authority/api/groups'));
assert.equal(response.status, 200);
assert.equal(JSON.parse(response.body).items[0].state, 'active');
response = await handler(request('/claims-authority/api/unassigned'));
assert.equal(response.status, 200);
response = await handler(request('/claims-authority/api/targets'));
assert.equal(JSON.parse(response.body).items[0].key, 'hozo-default');
response = await handler(request('/claims-authority/api/members?groupLookup=' + 'a'.repeat(64)));
assert.equal(response.status, 200);
response = await handler(request('/claims-authority/api/assign', {
  method: 'POST',
  body: { discoveryLookup: 'b'.repeat(64), targetKey: 'hozo-default' },
}));
assert.equal(response.status, 200);
assert.equal(mutationChecks, 1);
assert.ok(calls.some(([name]) => name === 'assign'));
response = await handler(request('/claims-authority/api/discovery/sync', {
  method: 'POST',
  body: {},
}));
assert.equal(response.status, 200);
assert.equal(JSON.parse(response.body).verified, 3);
assert.equal(mutationChecks, 2);
assert.equal(discoverySyncs, 1);

const forbidden = createClaimsAuthorityAdminHandler({
  authority,
  resolveContext: async () => ({ actor: { roles: [] }, tenant }),
  listTargets: async () => [],
  resolveTarget: async () => ({ tenant, bindingId: 'binding' }),
  verifyMutation: async () => {},
});
response = await forbidden(request('/claims-authority/api/groups'));
assert.equal(response.status, 403);

console.log('claims authority admin dry-run passed');

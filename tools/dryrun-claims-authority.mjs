import assert from 'node:assert/strict';
import { createClaimsAuthority, isClaimsCommand } from '../core/claims-authority.js';

const tenantA = {
  key: 'synthetic-a',
  tenantId: '00000000-0000-4000-8000-000000000001',
  config: { claims: { authorityRegistry: { mode: 'enforce' } } },
};
const tenantB = {
  key: 'synthetic-b',
  tenantId: '00000000-0000-4000-8000-000000000002',
  config: { claims: { authorityRegistry: { mode: 'enforce' } } },
};
const owner = { subject: 'synthetic-owner', roles: ['platform_owner'] };
const claimsAdmin = { subject: 'synthetic-admin', roles: ['claims_access_admin'] };
const groupId = 'C-synthetic-group';
const userId = 'U-synthetic-user';

function makeStore({ denied = false } = {}) {
  const calls = [];
  const events = new Set();
  let discoveredCiphertext = '';
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('ca:event')) {
        const identity = `${params[0]}:${params[1]}`;
        if (events.has(identity)) return { rows: [] };
        events.add(identity);
        return { rows: [{ event_key: params[1] }] };
      }
      if (sql.includes('ca:authorize')) {
        return { rows: [{ group_state: 'active', oa_state: 'present', member_state: 'observed', manual_deny: denied }] };
      }
      if (sql.includes('ca:platform-discover')) {
        discoveredCiphertext = params[1];
        return { rows: [] };
      }
      if (sql.includes('ca:platform-claim')) {
        return { rows: [{ group_ciphertext: discoveredCiphertext, key_id: 'fixed-v1', state: 'unassigned' }] };
      }
      if (sql.includes('ca:deny-lookup') || sql.includes('ca:set-group-state')) return { rows: [{ ok: true }] };
      return { rows: [] };
    },
  };
  return {
    calls,
    transaction: async (tenant, work) => { assert.ok(tenant.tenantId); return work(client); },
    discoveryTransaction: async (work) => work(client),
    platformTransaction: async (actor, work) => { assert.ok(actor.roles.includes('platform_owner')); return work(client); },
  };
}

function event(overrides = {}) {
  return {
    type: 'message',
    webhookEventId: 'webhook-1',
    timestamp: 1789197000000,
    source: { groupId, userId },
    message: { id: 'message-1', type: 'text', text: '請款' },
    ...overrides,
  };
}

const store = makeStore();
let provisionCalls = 0;
const authority = createClaimsAuthority({
  store,
  identityKey: 'fixed-synthetic-authority-key-material'.repeat(2),
  financeProvisioner: {
    async provision({ idempotencyKey }) {
      provisionCalls += 1;
      assert.match(idempotencyKey, /^activate:/u);
      return { ok: true, sourceId: 'synthetic-source' };
    },
  },
});

assert.equal(authority.fixedKeyId, 'fixed-v1');
assert.equal(isClaimsCommand('請款'), true);
assert.equal(isClaimsCommand('請款 abc'), false);
assert.notEqual(authority.opaqueIdentity(tenantA, 'group', groupId), authority.opaqueIdentity(tenantB, 'group', groupId));
assert.notEqual(authority.opaqueIdentity(tenantA, 'group', groupId), authority.opaqueIdentity(tenantA, 'member', groupId));
assert.throws(() => authority.opaqueIdentity(tenantA, 'invalid', groupId));

const unbound = await authority.handleEvent({ event: event({ webhookEventId: 'join-1', type: 'join', message: undefined }) });
assert.equal(unbound.state, 'unassigned');
assert.match(unbound.discoveryLookup, /^[a-f0-9]{64}$/u);
await assert.rejects(
  authority.listUnassigned({ actor: claimsAdmin }),
  /access denied/u,
);

const assigned = await authority.assignGroup({
  actor: owner,
  discoveryLookup: unbound.discoveryLookup,
  tenant: tenantA,
  bindingId: 'synthetic-binding',
  financeScope: { forms: ['employee_reimbursement'] },
});
assert.equal(assigned.state, 'active');
assert.equal(provisionCalls, 1);

let opened = 0;
const first = await authority.handleEvent({
  tenant: tenantA,
  binding: { id: 'synthetic-binding' },
  event: event(),
  openClaim: async ({ userId: actualUser, idempotencyKey }) => {
    opened += 1;
    assert.equal(actualUser, userId);
    assert.match(idempotencyKey, /^[a-f0-9]{64}$/u);
    return { applicantBound: true, ttlMinutes: 10 };
  },
});
assert.equal(first.claim.ok, true);
assert.equal(opened, 1);
const duplicate = await authority.handleEvent({
  tenant: tenantA,
  binding: { id: 'synthetic-binding' },
  event: event(),
  openClaim: async () => { opened += 1; },
});
assert.equal(duplicate.duplicate, true);
assert.equal(opened, 1);

const markerIndex = (marker) => store.calls.findIndex(({ sql }) => sql.includes(marker));
assert.ok(markerIndex('ca:observed') >= 0);
assert.ok(markerIndex('ca:observed') < markerIndex('ca:authorize'));
for (const marker of ['ca:platform-discover', 'ca:platform-activating', 'ca:active', 'ca:event', 'ca:audit', 'ca:outbox']) {
  assert.ok(markerIndex(marker) >= 0, `${marker} was not called`);
}

await authority.handleEvent({
  tenant: tenantA,
  binding: { id: 'synthetic-binding' },
  event: event({ webhookEventId: 'leave-1', type: 'leave', message: undefined }),
});
assert.ok(markerIndex('ca:leave') >= 0);

const deniedStore = makeStore({ denied: true });
const deniedAuthority = createClaimsAuthority({ store: deniedStore, identityKey: 'denied-fixed-key-material'.repeat(3) });
let deniedOpen = 0;
const denied = await deniedAuthority.handleEvent({
  tenant: tenantA,
  binding: { id: 'synthetic-binding' },
  event: event({ webhookEventId: 'denied-1' }),
  openClaim: async () => { deniedOpen += 1; },
});
assert.equal(denied.claim.ok, false);
assert.equal(denied.claim.reason, 'not_ready_or_denied');
assert.equal(deniedOpen, 0);

const failureStore = makeStore();
const failingAuthority = createClaimsAuthority({
  store: failureStore,
  identityKey: 'failure-fixed-key-material'.repeat(3),
  financeProvisioner: { provision: async () => ({ ok: false }) },
});
const failed = await failingAuthority.activate({
  tenant: tenantA,
  actor: owner,
  groupId,
  bindingId: 'synthetic-binding',
  financeScope: {},
});
assert.equal(failed.state, 'needs_attention');
assert.ok(failureStore.calls.some(({ sql }) => sql.includes('ca:failed')));

const fingerprintBase = authority.eventFingerprint(
  tenantA,
  authority.opaqueIdentity(tenantA, 'group', groupId),
  authority.opaqueIdentity(tenantA, 'member', userId),
  event({ webhookEventId: '', timestamp: 1, message: { id: 'm1', text: 'private text' } }),
);
assert.equal(fingerprintBase, authority.eventFingerprint(
  tenantA,
  authority.opaqueIdentity(tenantA, 'group', groupId),
  authority.opaqueIdentity(tenantA, 'member', userId),
  event({ webhookEventId: '', timestamp: 1, message: { id: 'm1', text: 'different text is ignored' } }),
));
const changedFingerprint = authority.eventFingerprint(
  tenantA,
  authority.opaqueIdentity(tenantA, 'group', groupId),
  authority.opaqueIdentity(tenantA, 'member', userId),
  event({ webhookEventId: '', timestamp: 1, message: { id: 'm2', text: 'private text' } }),
);
assert.notEqual(fingerprintBase, changedFingerprint);
assert.throws(() => authority.eventFingerprint(
  tenantA,
  authority.opaqueIdentity(tenantA, 'group', groupId),
  '',
  { type: 'message', source: {} },
));

const serializedCalls = JSON.stringify([...store.calls, ...deniedStore.calls, ...failureStore.calls]);
assert.equal(serializedCalls.includes(groupId), false);
assert.equal(serializedCalls.includes(userId), false);
assert.equal(serializedCalls.includes('private text'), false);

console.log('claims authority dry-run passed');

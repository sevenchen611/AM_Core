import assert from 'node:assert/strict';
import { createClaimsAuthorityPostgresStore } from '../core/claims-authority-postgres.js';

function pool(returnRows = []) {
  const calls = [];
  const client = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: sql.includes('ca:lease-outbox') ? returnRows : [{ event_key: params[1], status: 'sent' }] };
    },
    release: () => calls.push({ sql: 'RELEASE', params: [] }),
  };
  return { calls, connect: async () => client };
}

const tenantPool = pool();
const discoveryPool = pool();
const platformPool = pool();
const workerPool = pool([{ tenant_id: 'tenant-a', event_key: 'event-a' }]);
const store = createClaimsAuthorityPostgresStore({ tenantPool, discoveryPool, platformPool, workerPool });
const tenant = { tenantId: '00000000-0000-4000-8000-000000000001' };

await store.transaction(tenant, async (client) => client.query('SELECT 1'));
assert.ok(tenantPool.calls.some(({ sql }) => sql === 'SET LOCAL ROLE am_claims_tenant'));
assert.ok(tenantPool.calls.some(({ sql, params }) => sql.includes("set_config('app.tenant_id'") && params[0] === tenant.tenantId));
await store.discoveryTransaction(async (client) => client.query('SELECT 1'));
assert.ok(discoveryPool.calls.some(({ sql }) => sql === 'SET LOCAL ROLE am_claims_discovery_writer'));
await store.platformTransaction({ roles: ['platform_owner'] }, async (client) => client.query('SELECT 1'));
assert.ok(platformPool.calls.some(({ sql }) => sql === 'SET LOCAL ROLE am_claims_platform_owner'));
assert.throws(() => store.platformTransaction({ roles: [] }, async () => {}), /access denied/u);

const leased = await store.leaseOutbox({ workerId: 'worker-a', limit: 500, leaseSeconds: 1 });
assert.equal(leased.length, 1);
const leaseCall = workerPool.calls.find(({ sql }) => sql.includes('ca:lease-outbox'));
assert.equal(leaseCall.params[0], 100);
assert.equal(leaseCall.params[2], 10);
assert.match(leaseCall.sql, /SKIP LOCKED/u);
await store.completeOutbox({ workerId: 'worker-a', tenantId: 'tenant-a', eventKey: 'event-a' });
await store.failOutbox({ workerId: 'worker-a', tenantId: 'tenant-a', eventKey: 'event-b', error: new Error('synthetic') });
assert.ok(workerPool.calls.some(({ sql }) => sql.includes('ca:complete-outbox')));
assert.ok(workerPool.calls.some(({ sql }) => sql.includes('ca:fail-outbox')));

console.log('claims authority postgres dry-run passed');

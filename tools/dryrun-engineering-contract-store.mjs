import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContractStore, __test } from '../core/contract-store.js';

const tenant = { key: 'engineering', envPrefix: 'ENG' };
assert.equal(__test.configFor({}, tenant).configured, false);
assert.equal(__test.configFor({ ENG_CONTRACTS_DATABASE_URL: 'postgres://example' }, tenant).configured, true);
assert.equal(__test.canonical({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
assert.equal(__test.sha256('same'), __test.sha256('same'));
assert.notEqual(__test.sha256('same'), __test.sha256('different'));
const storeSource = fs.readFileSync(new URL('../core/contract-store.js', import.meta.url), 'utf8');
assert.match(storeSource, /ON CONFLICT \(tenant_key, notion_contract_page_id\)/);
assert.match(storeSource, /c\.tenant_key = \$3 AND v\.status = 'frozen'/);
assert.doesNotMatch(storeSource, /expires_at, created_by\)/, 'legacy unsafe signing-session insert must not remain');
assert.match(storeSource, /async function getSigningBundle/);

const queries = [];
const fakeClient = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes('information_schema.tables')) return { rows: [{ ready: true, schema_version: __test.SCHEMA_VERSION }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  release() {},
};
const store = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://example', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => fakeClient }),
  logger: { warn() {} },
});
assert.equal(store.configured(tenant), true);
assert.deepEqual(await store.status(tenant), { configured: true, schemaReady: true, schemaVersion: __test.SCHEMA_VERSION });
assert.ok(queries.some((entry) => entry.sql.includes("set_config('app.tenant_key'")), 'tenant context must be set per transaction');
assert.ok(queries.some((entry) => entry.sql.includes('SET TRANSACTION READ ONLY')), 'status query must be read-only');

console.log('Engineering contract store dry-run passed: config isolation, deterministic hashing, and tenant transaction context verified.');

const signingRows = new Map();
const signingEvents = [];
const signingClient = {
  async query(sql, params = []) {
    const text = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config)/.test(text.trim())) return { rows: [], rowCount: 0 };
    if (text.includes(`INSERT INTO engineering_contracts.signing_sessions`)) {
      if (signingRows.has(params[0])) return { rows: [], rowCount: 0 };
      signingRows.set(params[0], { id: 'session-db-id', state_snapshot: JSON.parse(params[13]), row_version: params[14] });
      return { rows: [{ id: 'session-db-id' }], rowCount: 1 };
    }
    if (text.includes('SELECT sequence_no, event_hash')) {
      const last = signingEvents.at(-1);
      return { rows: last ? [last] : [], rowCount: last ? 1 : 0 };
    }
    if (text.includes(`INSERT INTO engineering_contracts.signing_events`)) {
      signingEvents.push({ sequence_no: params[1], event_hash: params[11] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('SELECT s.state_snapshot') && text.includes('external_session_id')) {
      const row = signingRows.get(params[1]);
      return { rows: row ? [{ state_snapshot: row.state_snapshot }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('SELECT s.state_snapshot') && text.includes('token_digest')) {
      const row = [...signingRows.values()][0];
      return { rows: row ? [{ state_snapshot: row.state_snapshot }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes('SELECT s.id, s.state_snapshot, s.row_version')) {
      const row = signingRows.get(params[1]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes(`UPDATE engineering_contracts.signing_sessions`)) {
      const row = [...signingRows.values()].find((item) => item.id === params[0]);
      if (!row || Number(row.row_version) !== Number(params[4])) return { rows: [], rowCount: 0 };
      row.state_snapshot = JSON.parse(params[2]);
      row.row_version = params[3];
      return { rows: [], rowCount: 1 };
    }
    if (text.includes(`UPDATE engineering_contracts.contracts c`)) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected signing SQL: ${text}`);
  },
  release() {},
};
const signingStore = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://signing', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => signingClient }),
});
const signingStorage = signingStore.signingStorage(tenant, {
  versionId: 'version-1', groupBindingId: 'group-binding-1', actor: 'Portal Actor', expectedSignerName: '王先生',
});
const initialSession = {
  id: 'cs_example1234567890', version: 1, status: 'issued', signerLineUserId: 'U_SIGNER',
  lineGroupId: 'C_GROUP', tokenHash: 'a'.repeat(64), issuedAt: '2026-08-28T00:00:00.000Z',
  expiresAt: '2026-09-04T00:00:00.000Z',
  events: [{ type: 'issued', at: '2026-08-28T00:00:00.000Z', actorType: 'admin', actorId: 'Portal Actor', idempotencyKeyHash: 'b'.repeat(64), metadata: {} }],
};
assert.equal(await signingStorage.create(initialSession), true);
assert.equal(await signingStorage.create(initialSession), false);
assert.deepEqual(await signingStorage.getById(initialSession.id), initialSession);
const nextSession = structuredClone(initialSession);
nextSession.version = 2;
nextSession.status = 'sent';
nextSession.events.push({ type: 'sent', at: '2026-08-28T00:01:00.000Z', actorType: 'system', idempotencyKeyHash: 'c'.repeat(64), metadata: {} });
assert.equal(await signingStorage.compareAndSwap(initialSession.id, 1, nextSession), true);
assert.equal(await signingStorage.compareAndSwap(initialSession.id, 1, nextSession), false, 'stale CAS must fail');
assert.equal((await signingStorage.getByTokenHash(initialSession.tokenHash)).status, 'sent');
assert.equal(signingEvents.length, 2, 'append-only event projection must include issued and sent');

console.log('Engineering signing PostgreSQL adapter dry-run passed: digest-only create, CAS, and append-only events verified.');

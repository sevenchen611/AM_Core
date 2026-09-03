import assert from 'node:assert/strict';
import { createContractStore, __test } from '../core/contract-store.js';

// This program is intentionally self-contained: it has no production URL,
// reads no environment credentials, opens no database connection, and never
// calls a LINE or Notion client.  It verifies the P0 readiness gate and prints
// the human-approved, read-only recovery sequence for a later runbook.

const tenant = { key: 'engineering', envPrefix: 'ENG' };
const v8 = '2026-09-02.engineering-contract-evidence.v8';
const v9 = '2026-09-02.engineering-contract-evidence.v9';

assert.equal(__test.compatibleSchemaVersion(v8), true, 'v8 remains supported');
assert.equal(__test.compatibleSchemaVersion(v9), true, 'v9 must unblock the runtime');
assert.equal(__test.compatibleSchemaVersion('2026-09-03.engineering-contract-evidence.v10'), false,
  'an unreviewed future schema must remain fail-closed');

assert.deepEqual(__test.statusCapabilities({
  ready: true, profile_ready: true, archive_ready: true, schema_version: v8,
}), {
  schemaVersion: v8,
  coreReady: true,
  schemaReady: true,
  partyAProfileSchemaReady: true,
  archiveSchemaReady: true,
});
assert.deepEqual(__test.statusCapabilities({
  ready: true, profile_ready: true, archive_ready: true, schema_version: v9,
}), {
  schemaVersion: v9,
  coreReady: true,
  schemaReady: true,
  partyAProfileSchemaReady: true,
  archiveSchemaReady: true,
});
assert.equal(__test.statusCapabilities({
  ready: false, profile_ready: true, archive_ready: true, schema_version: v9,
}).schemaReady, false, 'a missing required core table must block recovery');
assert.equal(__test.statusCapabilities({
  ready: true, profile_ready: true, archive_ready: true,
  schema_version: '2026-09-03.engineering-contract-evidence.v10',
}).schemaReady, false, 'a complete but unreviewed schema must block recovery');
assert.equal(__test.statusCapabilities({
  ready: true, profile_ready: true, archive_ready: false, schema_version: v9,
}).archiveSchemaReady, false, 'archive capability must not be inferred from version');

const queries = [];
const fakeClient = {
  async query(sql, params = []) {
    const text = String(sql);
    queries.push({ text, params });
    if (text.includes('information_schema.tables')) {
      return { rows: [{ ready: true, profile_ready: true, archive_ready: false, schema_version: v9 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
  release() {},
};
const store = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://example.invalid/contracts', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => fakeClient }),
  logger: { warn() {} },
});
assert.deepEqual(await store.status(tenant), {
  configured: true,
  schemaReady: true,
  partyAProfileSchemaReady: true,
  archiveSchemaReady: false,
  schemaVersion: v9,
});
const capabilityQuery = queries.find((query) => query.text.includes('information_schema.tables'));
assert.ok(capabilityQuery, 'status must inspect table capabilities');
assert.deepEqual(capabilityQuery.params[1], __test.REQUIRED_CORE_TABLES);
assert.match(capabilityQuery.text, /contract_line_conversation_archives/);
assert.ok(queries.some((query) => query.text.includes('SET TRANSACTION READ ONLY')),
  'the status inspection must run in a read-only transaction');
assert.doesNotMatch(capabilityQuery.text, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i,
  'the readiness query must not mutate contract evidence');

const missingCoreClient = {
  async query(sql) {
    if (String(sql).includes('information_schema.tables')) {
      return { rows: [{ ready: false, profile_ready: true, archive_ready: true, schema_version: v9 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
  release() {},
};
const missingCoreStore = createContractStore({
  env: { ENG_CONTRACTS_DATABASE_URL: 'postgres://example.invalid/contracts', ENG_CONTRACTS_DATABASE_SSL: '0' },
  poolFactory: () => ({ connect: async () => missingCoreClient }),
  logger: { warn() {} },
});
assert.equal((await missingCoreStore.status(tenant)).schemaReady, false,
  'the public status gate must fail closed when a required core capability is absent');

const recoveryPlan = {
  mode: 'dry-run-only',
  guardrails: [
    'Use the engineering restricted database role and BEGIN READ ONLY for every inventory query.',
    'Do not invoke contract issuance, signing, confirmation, completion, resend, retry, enqueue, or any LINE endpoint.',
    'Do not edit PostgreSQL evidence, Notion rows, Drive files, or contract workflow state during the audit.',
  ],
  sequence: [
    'Check store.status(); stop if schemaReady is false or the version is not explicitly supported.',
    'Take a read-only inventory of the two affected contract IDs: contract/version/session identifiers, current workflow state, event timestamps, artifact hashes, and existing outbox status.',
    'Compare the inventory with the Notion projection and prepare a per-contract projection-delta report. This report must exclude line_signing_invitation and every event that could send a message.',
    'Require the engineering project owner to approve each delta before a separate, write-authorized projection-only recovery is designed and executed.',
    'After any approved recovery, re-run the same read-only inventory and preserve the before/after evidence references.',
  ],
};

console.log('Engineering contract control P0 dry-run passed: v8/v9 capability gate and fail-closed cases verified.');
console.log(JSON.stringify(recoveryPlan, null, 2));

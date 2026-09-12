import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../versions/AM-IMP-2026.0912.01/', import.meta.url);
const contract = JSON.parse(await readFile(new URL('config/claims-authority-contract.json', root), 'utf8'));
const upgrade = JSON.parse(await readFile(new URL('upgrade.json', root), 'utf8'));
const sql = await readFile(new URL('config/claims-authority-registry.sql', root), 'utf8');
const integration = await readFile(new URL('runtime-integration.md', root), 'utf8');

assert.equal(contract.fixedIdentityKey.rotationSupported, false);
assert.equal(contract.fixedIdentityKey.ciphertextKeyId, 'fixed-v1');
assert.deepEqual(contract.groupStates, ['unassigned', 'activating', 'active', 'paused', 'needs_attention']);
assert.equal(upgrade.status, 'Ready');
for (const table of ['discovered_groups', 'groups', 'members', 'events', 'outbox', 'audit']) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS am_claims\\.${table}`, 'u'));
  assert.match(sql, new RegExp(`FORCE ROW LEVEL SECURITY[;\\s\\S]*am_claims\\.${table}|am_claims\\.${table} FORCE ROW LEVEL SECURITY`, 'u'));
}
for (const role of ['am_claims_tenant', 'am_claims_discovery_writer', 'am_claims_platform_owner', 'am_claims_worker']) {
  assert.match(sql, new RegExp(role, 'u'));
}
assert.match(sql, /SKIP LOCKED|claims_outbox_ready_idx/u);
assert.match(integration, /createClaimsAuthorityV3Adapter/u);
assert.match(integration, /createClaimsAuthorityAdminHandler/u);
assert.match(integration, /createClaimsAuthorityRuntimeAdapter/u);
assert.match(integration, /createClaimsAuthorityOutboxWorker/u);
assert.doesNotMatch(sql, /(?:U|C)[a-f0-9]{20,}/iu);

console.log('claims authority contract dry-run passed');

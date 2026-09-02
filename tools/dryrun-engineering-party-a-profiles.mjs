import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {
  hydratePartyASigningAssets,
  normalizePartyAProfileInput,
  partyAContractSnapshot,
  uploadPartyAAsset,
} from '../modules/construction/contract-party-a-profiles.js';
import { __test as pdfTest } from '../modules/construction/contract-pdf-renderer.js';
import { __test as contractsPageTest } from '../modules/construction/contracts.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const HASH = crypto.createHash('sha256').update(PNG).digest('hex');
const asset = (kind) => ({ kind, fileId: `private-${kind}`, name: `${kind}.png`, mimeType: 'image/png', sizeBytes: PNG.length, sha256: HASH });

assert.throws(() => normalizePartyAProfileInput({
  profileType: 'company', displayName: '公司甲方', legalName: '範例公司', taxId: '12345678',
  responsiblePerson: '負責人', address: '臺中市', assets: {},
}), /必須上傳公司大章/);

const individual = normalizePartyAProfileInput({
  profileType: 'individual', displayName: '個人甲方', legalName: '王小明', address: '臺中市', assets: {},
});
assert.deepEqual(individual.assets, {});
assert.throws(() => normalizePartyAProfileInput({
  profileType: 'individual', displayName: '個人甲方', legalName: '王小明', address: '臺中市',
  assets: { signature: asset('signature') },
}), /不保存簽名/);

const company = normalizePartyAProfileInput({
  id: '11111111-1111-4111-8111-111111111111', profileType: 'company', displayName: '公司甲方', legalName: '範例股份有限公司',
  taxId: '12345678', responsiblePerson: '王小明', representative: '王小明', address: '臺中市測試路 1 號',
  assets: { large_seal: asset('large_seal') },
});
const snapshot = partyAContractSnapshot(company);
assert.equal(snapshot.contractFields.partyAOrganization, '範例股份有限公司');
assert.equal(snapshot.contractFields.partyATaxId, '12345678');
assert.equal(snapshot.assets.large_seal.sha256, HASH);

const driveFiles = new Map();
const deps = {
  driveConfigured: true,
  driveRootFolderId: 'root',
  actor: 'test-admin',
  ensureDriveFolder: async (name, parent) => `${parent}/${name}`,
  auditDrivePrivate: async () => ({ private: true }),
  uploadToDrive: async (buffer, name, mimeType) => {
    const id = `uploaded-${driveFiles.size + 1}`;
    driveFiles.set(id, { buffer: Buffer.from(buffer), contentType: mimeType });
    return { id, webViewLink: `https://drive.invalid/${encodeURIComponent(name)}` };
  },
  downloadFromDrive: async (id) => driveFiles.get(id) || ({ buffer: PNG, contentType: 'image/png' }),
};
const uploaded = await uploadPartyAAsset(deps, {
  kind: 'signature', filename: 'my-signature.png', mimeType: 'image/png', buffer: PNG, actor: 'test-admin',
});
assert.equal(uploaded.sha256, HASH);
assert.equal(uploaded.sizeBytes, PNG.length);

const hydrated = await hydratePartyASigningAssets(deps, {
  documentPackage: { contractFields: { partyAProfileSnapshot: {
    profileType: 'individual', displayName: '個人甲方', assets: { signature: uploaded },
  } } },
});
assert.equal(hydrated.profileType, 'individual');
assert.equal(hydrated.signature, undefined, 'legacy reusable signatures are never hydrated for an individual profile');
hydrated.signature = { mimeType: 'image/png', base64: PNG_BASE64, sha256: HASH };

const signedPayload = {
  kind: 'signed_pdf',
  contract: { id: 'contract-1', title: '測試合約', amount: 1000, currency: 'TWD' },
  version: { id: 'version-1', versionNo: 1, snapshot: { documentPackage: { contractFields: {} } } },
  bundleHash: 'a'.repeat(64), ipAddress: '203.0.113.1',
  signature: { base64: PNG_BASE64 },
  counterpartyDetails: { name: '乙方', identityNumber: 'A123456789', address: '臺中市' },
  times: { issuedAt: '2026-09-02T01:00:00.000Z' },
  partyASigningAssets: hydrated,
};
assert.equal(pdfTest.validatePayload(signedPayload), signedPayload);
const pdf = await pdfTest.renderContractPdf(signedPayload);
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

const page = contractsPageTest.renderContractsPage('engineering', 'test-key', true, true, true, true);
assert.match(page, /甲方主檔/);
assert.match(page, /party-a-profiles/);
assert.match(page, /簽名不存主檔/);
assert.match(page, /每份合約以指定 LINE 帳號簽名/);
assert.match(page, /assign-party-a/);
assert.doesNotMatch(page, /id="party-a-contract-signature"/);
const pageScript = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(pageScript);
new vm.Script(pageScript, { filename: 'engineering-contracts-page.js' });

const migrationUrl = new URL('../versions/AM-IMP-2026.0902.08/schemas/engineering-contract-party-a-profiles-v6.sql', import.meta.url);
const rawMigration = await fs.readFile(migrationUrl, 'utf8');
const migration = rawMigration.split(/\r?\n/)
  .filter((line) => !/^\\/.test(line.trim()) && !/^\s*GRANT\b/i.test(line))
  .join('\n');
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE SCHEMA engineering_contracts; CREATE TABLE engineering_contracts.schema_meta(singleton boolean primary key, version text, installed_at timestamptz); INSERT INTO engineering_contracts.schema_meta VALUES(true,\'v5\',now());');
await db.exec(migration);
await db.exec(`
  CREATE TABLE engineering_contracts.contract_versions(id uuid primary key, contract_snapshot jsonb not null default '{}'::jsonb);
  CREATE TABLE engineering_contracts.signing_sessions(id uuid primary key, version_id uuid not null references engineering_contracts.contract_versions(id), status text not null);
  CREATE TABLE engineering_contracts.artifacts(
    id uuid primary key default gen_random_uuid(), version_id uuid not null references engineering_contracts.contract_versions(id),
    signing_session_id uuid references engineering_contracts.signing_sessions(id),
    artifact_kind text not null check (artifact_kind in ('issued_pdf','signed_pdf','evidence_receipt'))
  );
  CREATE TABLE engineering_contracts.signing_events(
    id uuid primary key default gen_random_uuid(),
    event_type text not null check (event_type in ('issued','sent','delivery_ack','first_opened','signed','submission_received','confirmed','completed','revoked','expired'))
  );
`);
const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='engineering_contracts' AND table_name='party_a_profiles'");
assert.ok(columns.rows.some((row) => row.column_name === 'assets'));
const v8Url = new URL('../versions/AM-IMP-2026.0902.14/schemas/engineering-contract-party-a-online-signing-v8.sql', import.meta.url);
const rawV8 = await fs.readFile(v8Url, 'utf8');
const migrationV8 = rawV8.split(/\r?\n/)
  .filter((line) => !/^\\/.test(line.trim()) && !/^\s*GRANT\b/i.test(line))
  .join('\n');
await db.exec(migrationV8);
const versionV8 = await db.query('SELECT version FROM engineering_contracts.schema_meta WHERE singleton=true');
assert.equal(versionV8.rows[0].version, '2026-09-02.engineering-contract-evidence.v8');
await assert.rejects(db.query(`
  INSERT INTO engineering_contracts.party_a_profiles
    (profile_type, display_name, legal_name, representative, identity_number, address, assets, created_by, updated_by)
  VALUES ('individual', '遷移前個人', '遷移前個人', '遷移前個人', 'A123456789', '臺中市', '{}'::jsonb, 'test', 'test')
`), /party_a_profiles_check|check constraint/i, 'schema v8 without v7 still has the stale reusable-signature check');

const v9Url = new URL('../versions/AM-IMP-2026.0902.15/schemas/engineering-contract-party-a-profile-constraint-v9.sql', import.meta.url);
const rawV9 = await fs.readFile(v9Url, 'utf8');
const migrationV9 = rawV9.split(/\r?\n/)
  .filter((line) => !/^\\/.test(line.trim()) && !/^\s*GRANT\b/i.test(line))
  .join('\n');
await db.exec(migrationV9);
const versionV9 = await db.query('SELECT version FROM engineering_contracts.schema_meta WHERE singleton=true');
assert.equal(versionV9.rows[0].version, '2026-09-02.engineering-contract-evidence.v9');

await db.query(`
  INSERT INTO engineering_contracts.party_a_profiles
    (profile_type, display_name, legal_name, representative, identity_number, address, assets, created_by, updated_by)
  VALUES ('individual', '個人免簽名', '個人免簽名', '個人免簽名', 'A123456789', '臺中市', '{}'::jsonb, 'test', 'test')
`);
await assert.rejects(db.query(`
  INSERT INTO engineering_contracts.party_a_profiles
    (profile_type, display_name, legal_name, representative, identity_number, address, assets, created_by, updated_by)
  VALUES ('individual', '個人含簽名', '個人含簽名', '個人含簽名', 'B123456789', '臺中市',
          '{"signature":{"fileId":"legacy"}}'::jsonb, 'test', 'test')
`), /engineering_contract_party_a_profile_requirements_check|check constraint/i);
await assert.rejects(db.query(`
  INSERT INTO engineering_contracts.party_a_profiles
    (profile_type, display_name, legal_name, tax_id, responsible_person, representative, address, assets, created_by, updated_by)
  VALUES ('company', '公司無大章', '公司無大章', '12345678', '負責人', '負責人', '臺中市', '{}'::jsonb, 'test', 'test')
`), /engineering_contract_party_a_profile_requirements_check|check constraint/i);

for (const eventType of ['party_a_signer_assigned', 'party_a_first_opened', 'party_a_signed', 'party_a_submission_received']) {
  await db.query('INSERT INTO engineering_contracts.signing_events(event_type) VALUES($1)', [eventType]);
}

const versionId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
await db.query(`INSERT INTO engineering_contracts.contract_versions(id, contract_snapshot)
  VALUES ($1, '{"documentPackage":{"contractFields":{"partyAProfileType":"individual"}}}'::jsonb)`, [versionId]);
await db.query('INSERT INTO engineering_contracts.signing_sessions(id, version_id, status) VALUES($1,$2,$3)',
  [sessionId, versionId, 'signed']);
await assert.rejects(db.query("UPDATE engineering_contracts.signing_sessions SET status='confirmed' WHERE id=$1", [sessionId]),
  /requires one immutable contract-specific signature artifact/i);
await db.query(`INSERT INTO engineering_contracts.artifacts(version_id, signing_session_id, artifact_kind)
  VALUES($1,$2,'party_a_signature_image')`, [versionId, sessionId]);
await db.query("UPDATE engineering_contracts.signing_sessions SET status='confirmed' WHERE id=$1", [sessionId]);
const confirmed = await db.query('SELECT status FROM engineering_contracts.signing_sessions WHERE id=$1', [sessionId]);
assert.equal(confirmed.rows[0].status, 'confirmed');
await db.close();

console.log('Engineering Party A profile dry-run passed: schema v9 repairs the v6-to-v8 constraint gap, rejects reusable signatures, and preserves contract-bound dual signing.');

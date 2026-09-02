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
assert.match(page, /送出甲方簽名並完成雙方歸檔/);
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
`);
const v7Url = new URL('../versions/AM-IMP-2026.0902.12/schemas/engineering-contract-party-a-dual-signing-v7.sql', import.meta.url);
const rawV7 = await fs.readFile(v7Url, 'utf8');
const migrationV7 = rawV7.split(/\r?\n/)
  .filter((line) => !/^\\/.test(line.trim()) && !/^\s*GRANT\b/i.test(line))
  .join('\n');
await db.exec(migrationV7);
const version = await db.query('SELECT version FROM engineering_contracts.schema_meta WHERE singleton=true');
assert.equal(version.rows[0].version, '2026-09-02.engineering-contract-evidence.v7');
const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='engineering_contracts' AND table_name='party_a_profiles'");
assert.ok(columns.rows.some((row) => row.column_name === 'assets'));
await db.close();

console.log('Engineering Party A profile dry-run passed: individual profiles reject reusable signatures, contract-specific signing renders, and schema v7 migration is verified.');

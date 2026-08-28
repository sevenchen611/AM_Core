import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { loadTenants } from '../core/tenants.js';
import construction from '../modules/construction/index.js';
import { createContractArtifactService } from '../modules/construction/contract-artifacts.js';
import { contractSigningRuntimeReadiness } from '../modules/construction/contract-runtime.js';
import { createMemoryContractSigningStorage } from '../modules/construction/contract-signing.js';
import { createContractWorkflowApiHandler } from '../modules/construction/contract-workflow-api.js';

const root = new URL('../', import.meta.url);
const workflow = JSON.parse(await readFile(new URL('versions/AM-IMP-2026.0828.01/config/engineering-contract-workflow.json', root)));
const api = JSON.parse(await readFile(new URL('versions/AM-IMP-2026.0828.01/contracts/engineering-contract-api.json', root)));
assert.equal(workflow.publicEntryPattern, '/contract-sign#token={opaqueToken}');
assert.ok(api.publicRoutes.some((route) => route.path === '/contract-sign#token={opaqueToken}'));
assert.equal(api.publicRoutes.some((route) => /\/\{opaqueToken\}|\?token=/.test(route.path)), false);

const signingRoute = construction.routes.find((route) => route.prefix === '/contract-sign');
assert.equal(signingRoute.tenantKey, 'engineering');
const serverSource = await readFile(new URL('server.js', root), 'utf8');
assert.match(serverSource, /fixedTenantKey \? '' : url\.searchParams\.get\('tenant'\)/);
assert.match(serverSource, /fixedTenantKey && tenantKey !== fixedTenantKey/);

// Database/PDF preparation must load the contracts config before a LIFF app is
// provisioned. Otherwise a safe signingEnabled=0 deployment would silently
// ignore its renderer and database hardening settings.
const preparedTenant = loadTenants({
  ENG_CONTRACTS_SIGNING_ENABLED: '0',
  ENG_CONTRACTS_DATABASE_URL: 'postgresql://runtime:secret@db.example.test/engineering_contracts',
  ENG_CONTRACTS_DATABASE_DEDICATED: '1',
  ENG_CONTRACTS_DATABASE_SSL_MODE: 'verify-full',
  ENG_CONTRACTS_DATABASE_CA: 'test-ca',
  ENG_CONTRACTS_PDF_RENDER_URL: 'https://engineering.example.test/internal',
  ENG_CONTRACTS_PDF_RENDER_TOKEN: 'renderer-token-with-at-least-32-bytes',
}, { warn() {} }).find((tenant) => tenant.key === 'engineering');
assert.equal(preparedTenant.config.contracts.signingEnabled, false);
assert.equal(preparedTenant.config.contracts.databaseDedicated, true);
assert.equal(preparedTenant.config.contracts.databaseSslMode, 'verify-full');
assert.equal(preparedTenant.config.contracts.databaseCaConfigured, true);
assert.equal(preparedTenant.config.contracts.pdfRenderToken, 'renderer-token-with-at-least-32-bytes');

const validDeps = {
  tenant: { key: 'engineering', config: { contracts: {
    signingEnabled: true,
    liffId: '123456-test',
    liffEndpointUrl: 'https://engineering.example.test/contract-sign',
    databaseDedicated: true,
    databaseSslMode: 'verify-full',
    databaseCaConfigured: true,
    trustedProxyIps: ['10.0.0.1'],
    trustedClientIpHeaders: ['x-forwarded-for'],
  } } },
  publicBaseUrl: 'https://engineering.example.test',
};
assert.equal(contractSigningRuntimeReadiness(validDeps).ready, true);
const renderProxyDeps = {
  ...validDeps,
  tenant: { key: 'engineering', config: { contracts: {
    ...validDeps.tenant.config.contracts,
    trustedProxyIps: ['render'],
    trustedClientIpHeaders: ['cf-connecting-ip'],
  } } },
};
assert.equal(contractSigningRuntimeReadiness(renderProxyDeps).ready, true);
for (const trustedClientIpHeaders of [['x-forwarded-for'], ['cf-connecting-ip', 'x-forwarded-for'], []]) {
  assert.equal(contractSigningRuntimeReadiness({
    ...renderProxyDeps,
    tenant: { key: 'engineering', config: { contracts: {
      ...renderProxyDeps.tenant.config.contracts,
      trustedClientIpHeaders,
    } } },
  }).ready, false);
}
assert.equal(contractSigningRuntimeReadiness({
  ...renderProxyDeps,
  tenant: { key: 'engineering', config: { contracts: {
    ...renderProxyDeps.tenant.config.contracts,
    trustedProxyIps: ['render', '10.0.0.1'],
  } } },
}).ready, false);
for (const mutation of [
  { publicBaseUrl: 'https://engineering.example.test/path' },
  { tenant: { key: 'engineering', config: { contracts: { ...validDeps.tenant.config.contracts, liffEndpointUrl: 'https://wrong.example.test/contract-sign' } } } },
  { tenant: { key: 'engineering', config: { contracts: { ...validDeps.tenant.config.contracts, trustedProxyIps: [] } } } },
  { tenant: { key: 'engineering', config: { contracts: { ...validDeps.tenant.config.contracts, databaseDedicated: false } } } },
  { tenant: { key: 'engineering', config: { contracts: { ...validDeps.tenant.config.contracts, databaseSslMode: 'require' } } } },
]) {
  assert.equal(contractSigningRuntimeReadiness({ ...validDeps, ...mutation }).ready, false);
}

let uploads = 0;
const privateGate = createContractArtifactService({
  tenant: { config: { contracts: {
    pdfRenderUrl: 'https://pdf.example.test',
    pdfRenderToken: 'renderer-token-with-at-least-32-bytes',
  } } },
  driveConfigured: true,
  driveRootFolderId: 'root-folder',
  ensureDriveFolder: async (name, parent) => `${parent}/${name}`,
  uploadToDrive: async () => { uploads += 1; return { id: 'uploaded-file-id' }; },
  auditDrivePrivate: async () => ({ private: false, reason: 'anyone' }),
});
await assert.rejects(
  privateGate.storePdf({
    projectLabel: 'P01', contractLabel: 'C01', filename: 'contract.pdf',
    rendered: { buffer: Buffer.from('%PDF-1.7'), sha256: 'a'.repeat(64), byteSize: 8 },
  }),
  (error) => error.code === 'DRIVE_PRIVACY_AUDIT_FAILED',
);
assert.equal(uploads, 0, 'public/inherited folder must be rejected before upload');

// The kill-switch revoke endpoint works with signing disabled, uses the server
// actor, and cannot be enabled by body/query authority fields.
const session = {
  id: 'cs_security_gate', version: 1, status: 'issued', projectId: 'project-1', contractId: 'contract-1',
  documentRef: 'https://drive.google.com/file/d/drive-file-123456/view', documentHash: 'b'.repeat(64),
  lineGroupId: 'C-group', signerLineUserId: 'U-signer', tokenHash: 'c'.repeat(64),
  issuedAt: '2026-08-28T00:00:00.000Z', expiresAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z', events: [], submission: null,
};
const storage = createMemoryContractSigningStorage([session]);
const deps = {
  tenant: { key: 'engineering', config: { contracts: { signingEnabled: false } } },
  actor: 'security-admin',
  contractStore: { configured: () => true, signingStorage: () => storage },
  pushLineMessage: async () => ({ ok: true, messageIds: ['message-1'] }),
  verifyLiffIdentity: async () => { throw new Error('not used'); },
  lineGet: async () => { throw new Error('not used'); },
};
const req = Readable.from([Buffer.from(JSON.stringify({ reason: 'production kill switch', actorId: 'browser' }))]);
req.method = 'POST';
req.headers = { 'content-type': 'application/json' };
req.socket = { remoteAddress: '127.0.0.1' };
let statusCode;
let responseBody = '';
const res = {
  setHeader() {},
  writeHead(status) { statusCode = status; },
  end(value = '') { responseBody += value; },
};
await createContractWorkflowApiHandler(deps)(
  req, res,
  '/contracts/api/v2/signing-sessions/cs_security_gate/revoke',
  new URL('https://engineering.example.test/contracts/api/v2/signing-sessions/cs_security_gate/revoke?tenant=other'),
  { scope: 'all', capabilities: { admin: true } },
);
assert.equal(statusCode, 200);
assert.equal(JSON.parse(responseBody).data.status, 'revoked');
const revoked = await storage.getById('cs_security_gate');
assert.equal(revoked.status, 'revoked');
assert.equal(revoked.revocation.actorId, 'security-admin');
assert.equal(revoked.events.at(-1).actorId, 'security-admin');

console.log('Engineering contract security gates dry-run passed: tenant binding, fragment token, runtime readiness, Drive privacy, and kill-switch revocation verified.');

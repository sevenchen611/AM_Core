import assert from 'node:assert/strict';
import { createContractLineAdapter, createRuntimeSigningService, loadContractPdf, saveContractSignature, __test } from '../modules/construction/contract-runtime.js';
import { createHash } from 'node:crypto';

assert.equal(__test.safeSegment('../危險/名稱', 'fallback'), '.._危險_名稱');

const calls = [];
const deps = {
  tenant: { key: 'engineering', config: { contracts: {
    liffId: '12345-test',
    signingEnabled: true,
    tokenTtlHours: 168,
    tokenPepper: 'test-only-engineering-contract-token-pepper-2026',
    liffEndpointUrl: 'https://engineering.example.test/contract-sign',
    databaseDedicated: true,
    databaseSslMode: 'verify-full',
    databaseCaConfigured: true,
    trustedProxyIps: ['10.0.0.1'],
    trustedClientIpHeaders: ['x-forwarded-for'],
  } } },
  publicBaseUrl: 'https://engineering.example.test',
  pushLineMessage: async (groupId, message, _mention, delivery) => {
    calls.push({ groupId, message, delivery });
    return { ok: true, messageIds: ['line-message-1'] };
  },
  verifyLiffIdentity: async (credential, liffId) => ({ userId: 'U1', displayName: `${credential}:${liffId}` }),
  lineGet: async () => ({ displayName: '王先生' }),
};
const line = createContractLineAdapter(deps);
assert.deepEqual(await line.pushGroup({ groupId: 'C1', message: 'status only', idempotencyKey: 'retry' }), {
  accepted: true, messageId: 'line-message-1',
});
assert.equal((await line.verifyLiffIdentity({ credential: 'token' })).verified, true);
assert.equal((await line.isGroupMember({ groupId: 'C1', userId: 'U1' })).member, true);
assert.equal(calls[0].delivery.retryKey, 'retry');

assert.throws(() => createRuntimeSigningService({ ...deps, contractStore: { configured: () => false } }), /資料庫尚未設定/);
const storage = { create() {}, getById() {}, getByTokenHash() {}, compareAndSwap() {} };
assert.ok(createRuntimeSigningService({
  ...deps,
  contractStore: { configured: () => true, signingStorage: () => storage },
}), 'configured dependencies should construct signing service');

const uploaded = [];
const saved = await saveContractSignature({
  driveConfigured: true,
  driveRootFolderId: 'root',
  ensureDriveFolder: async (name, parent) => `${parent}/${name}`,
  uploadToDrive: async (buffer, filename, contentType, folder) => {
    uploaded.push({ buffer, filename, contentType, folder });
    return { id: 'drive-signature-id', webViewLink: 'https://drive.example/signature' };
  },
  auditDrivePrivate: async () => ({ private: true }),
}, { sessionId: 'cs_example', buffer: Buffer.alloc(128, 1), contentType: 'image/png' });
assert.equal(saved.submissionRef, 'drive-signature-id');
assert.match(saved.signatureHash, /^[a-f0-9]{64}$/);
assert.match(uploaded[0].folder, /工程合約管理\/簽署證據\/cs_example$/);

const pdf = Buffer.from('%PDF-1.7\ncontract\n%%EOF');
const loaded = await loadContractPdf({
  downloadFromDrive: async (fileId, maxBytes) => {
    assert.equal(fileId, 'drive-file-123456');
    assert.equal(maxBytes, 30 * 1024 * 1024);
    return { buffer: pdf, contentType: 'application/pdf' };
  },
}, {
  documentRef: 'https://drive.google.com/file/d/drive-file-123456/view',
  documentHash: createHash('sha256').update(pdf).digest('hex'),
});
assert.deepEqual(loaded.buffer, pdf);

console.log('Engineering contract runtime dry-run passed: LINE group adapter, LIFF membership, config gates, and Drive signature evidence verified.');

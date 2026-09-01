import assert from 'node:assert/strict';
import { createContractLineAdapter, createRuntimeSigningService, isRenderInternalProxyPeer, loadContractPdf, saveContractIdentityDocuments, saveContractSignature, __test } from '../modules/construction/contract-runtime.js';
import { getTrustedClientIp } from '../modules/construction/contract-signing.js';
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

assert.equal(isRenderInternalProxyPeer('10.42.0.8'), true);
assert.equal(isRenderInternalProxyPeer('172.31.4.9'), true);
assert.equal(isRenderInternalProxyPeer('192.168.5.7'), true);
assert.equal(isRenderInternalProxyPeer('127.0.0.1'), true);
assert.equal(isRenderInternalProxyPeer('169.254.8.9'), true);
assert.equal(isRenderInternalProxyPeer('fd00::1234'), true);
assert.equal(isRenderInternalProxyPeer('fe80::1234'), true);
assert.equal(isRenderInternalProxyPeer('::1'), true);
assert.equal(isRenderInternalProxyPeer('203.0.113.9'), false);
assert.equal(isRenderInternalProxyPeer('2001:db8::9'), false);
const renderProxyOptions = __test.trustedProxyOptions({
  trustedProxyIps: ['render'],
  trustedClientIpHeaders: ['cf-connecting-ip'],
});
assert.equal(getTrustedClientIp({
  remoteAddress: '10.42.0.8',
  headers: { 'cf-connecting-ip': '203.0.113.80', 'x-forwarded-for': '192.0.2.80' },
}, renderProxyOptions), '203.0.113.80');
assert.equal(getTrustedClientIp({
  remoteAddress: '198.51.100.8',
  headers: { 'cf-connecting-ip': '203.0.113.81' },
}, renderProxyOptions), '198.51.100.8');
assert.equal(getTrustedClientIp({
  remoteAddress: '10.42.0.8',
  headers: { 'x-forwarded-for': '192.0.2.81' },
}, renderProxyOptions), '10.42.0.8');

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

const identityUploads = [];
const identityDocuments = await saveContractIdentityDocuments({
  driveConfigured: true,
  driveRootFolderId: 'root',
  ensureDriveFolder: async (name, parent) => `${parent}/${name}`,
  uploadToDrive: async (buffer, filename, contentType, folder) => {
    identityUploads.push({ buffer, filename, contentType, folder });
    return { id: `drive-${filename}` };
  },
  auditDrivePrivate: async () => ({ private: true }),
}, {
  sessionId: 'cs_example',
  front: { bytes: Buffer.alloc(800, 2), contentType: 'image/jpeg' },
  back: { bytes: Buffer.alloc(900, 3), contentType: 'image/png' },
});
assert.match(identityUploads[0].folder, /簽署證據\/cs_example\/身分證件（機密）$/);
assert.match(identityDocuments.front.hash, /^[a-f0-9]{64}$/);
assert.match(identityDocuments.back.hash, /^[a-f0-9]{64}$/);
assert.equal(identityDocuments.front.contentType, 'image/jpeg');

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

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { handleContractsRequest } from '../modules/construction/contracts.js';

function response() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value = '') { this.body = String(value); },
  };
}

const fileBuffer = Buffer.from('engineering contract template v1');
const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
let createdInput;
const deps = {
  tenantKey: 'engineering', tenant: { key: 'engineering' }, actor: 'Portal 管理者',
  contractStore: {
    async listContractTemplates() {
      return { value: [{ id: 'template-1', template_name: '泥作標準合約', contract_type: '泥作合約', versions: [] }] };
    },
    async createContractTemplateVersion(_tenant, input) {
      createdInput = input;
      return { value: { template: { id: 'template-1', template_name: input.templateName }, version: { version_no: 1 } } };
    },
  },
  auditDrivePrivate: async () => ({ private: true }),
  downloadFromDrive: async () => ({ buffer: fileBuffer, contentType: 'application/pdf' }),
};

const authUrl = new URL('https://example.test/contracts/api/v2/templates?contract=1&contractManage=1');
const listRes = response();
await handleContractsRequest({ method: 'GET' }, listRes, '/contracts/api/v2/templates', authUrl, deps);
assert.equal(listRes.status, 200);
assert.equal(JSON.parse(listRes.body).data[0].template_name, '泥作標準合約');

const createBody = JSON.stringify({
  templateName: '泥作標準合約', contractType: '泥作合約', description: '工程共用公版',
  effectiveDate: '2026-08-28', notes: '第一版',
  file: { fileId: 'drive_file_123456', name: '泥作標準合約.pdf', mimeType: 'application/pdf', sizeBytes: fileBuffer.length, sha256: fileHash },
});
const createReq = Readable.from([Buffer.from(createBody)]);
createReq.method = 'POST';
const createRes = response();
await handleContractsRequest(createReq, createRes, '/contracts/api/v2/templates/versions', authUrl, deps);
assert.equal(createRes.status, 200);
assert.equal(createdInput.templateName, '泥作標準合約');
assert.equal(createdInput.contractType, '泥作合約');
assert.equal(createdInput.file.sha256, fileHash);
assert.equal(createdInput.file.sizeBytes, fileBuffer.length);
assert.equal(createdInput.actor, 'Portal 管理者');

const tamperedReq = Readable.from([Buffer.from(JSON.stringify({
  templateName: '偽造範本', contractType: '測試',
  file: { fileId: 'drive_file_123456', name: 'bad.pdf', mimeType: 'application/pdf', sizeBytes: fileBuffer.length, sha256: 'a'.repeat(64) },
}))]);
tamperedReq.method = 'POST';
const tamperedRes = response();
await handleContractsRequest(tamperedReq, tamperedRes, '/contracts/api/v2/templates/versions', authUrl, deps);
assert.equal(tamperedRes.status, 409);
assert.match(JSON.parse(tamperedRes.body).error, /驗證失敗/);

console.log('Engineering contract template library dry-run passed: independent listing, verified append-only version creation, and tampered file rejection verified.');

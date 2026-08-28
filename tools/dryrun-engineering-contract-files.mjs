import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  contractFileUploadMetadata,
  readContractFileBody,
  uploadContractSourceFile,
} from '../modules/construction/contract-files.js';

const body = Buffer.from('%PDF-1.7 test contract');
const req = Readable.from([body]);
req.headers = {
  'content-type': 'application/pdf',
  'content-length': String(body.length),
  'x-contract-file-name': encodeURIComponent('../泥作合約.pdf'),
  'x-contract-document-kind': 'contract_body',
};
assert.deepEqual(contractFileUploadMetadata(req), {
  filename: '../泥作合約.pdf', kind: 'contract_body', mimeType: 'application/pdf',
});
assert.deepEqual(await readContractFileBody(req), body);

const calls = [];
const result = await uploadContractSourceFile({
  driveConfigured: true,
  driveRootFolderId: 'root',
  ensureDriveFolder: async (name, parent) => { calls.push({ name, parent }); return `${parent}/${name}`; },
  uploadToDrive: async (buffer, filename, mimeType, folder) => ({
    id: 'drive-file-123', webViewLink: `https://drive.example/${filename}`, buffer, mimeType, folder,
  }),
  auditDrivePrivate: async () => ({ private: true }),
}, {
  projectId: 'project-1', projectLabel: 'P01/測試', actor: 'admin',
  kind: 'contract_body', filename: '../泥作合約.pdf', mimeType: 'application/pdf', buffer: body,
});
assert.equal(result.category, 'contract_body');
assert.equal(result.required, true);
assert.equal(result.fileId, 'drive-file-123');
assert.match(result.sha256, /^[a-f0-9]{64}$/);
assert.equal(result.name, '.._泥作合約.pdf');
assert.equal(calls.at(-1).name, '合約來源附件');

await assert.rejects(() => uploadContractSourceFile({ driveConfigured: true, driveRootFolderId: 'root' }, {
  projectId: 'p', kind: 'contract_body', filename: 'bad.exe', mimeType: 'application/octet-stream', buffer: body,
}), (error) => error.statusCode === 415);

console.log('Engineering contract file dry-run passed: bounded raw upload, type allowlist, Drive hierarchy, and SHA-256 manifest evidence verified.');

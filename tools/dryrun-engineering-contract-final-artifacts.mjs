import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createContractFinalArtifactReader } from '../modules/construction/contract-final-artifact-reader.js';
import { handleContractWorkflowApiRequest, __test as apiTest } from '../modules/construction/contract-workflow-api.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const tenant = { key: 'engineering-test' };
const signedPdf = Buffer.from('%PDF-1.7\nverified signed contract');
const receipt = Buffer.from(JSON.stringify({ schemaVersion: 'test-receipt', completed: true }));
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const files = {
  'private-signed-pdf': signedPdf,
  'private-evidence-receipt': receipt,
};

const contract = {
  id: contractId,
  project_notion_page_id: 'project-demolition',
  project_code: 'HZ',
  contract_number: 'HZ-CT-001',
  title: '拆除合約',
  current_version_id: versionId,
  signing_external_session_id: 'session-completed',
};
const version = {
  id: versionId,
  contract_id: contractId,
  version_no: 14,
  status: 'issued',
  contract_snapshot: { documentPackage: {} },
};
const bundle = {
  contract: { id: contractId },
  version: { id: versionId },
  session: { externalSessionId: 'session-completed', versionId, status: 'completed' },
  artifacts: [
    { artifact_kind: 'signed_pdf', drive_file_id: 'private-signed-pdf', sha256: digest(signedPdf) },
    { artifact_kind: 'evidence_receipt', drive_file_id: 'private-evidence-receipt', sha256: digest(receipt) },
  ],
};
const store = {
  async getContract(_tenant, { contractId: requested }) { return requested === contractId ? contract : null; },
  async listVersions() { return [version]; },
  async listContracts() { return [contract]; },
  async getSigningBundle(_tenant, sessionId) { return sessionId === 'session-completed' ? bundle : null; },
};
const deps = {
  tenant,
  actor: 'contract-admin',
  contractStore: store,
  async auditDrivePrivate(fileId) { return { private: Object.hasOwn(files, fileId) }; },
  async downloadFromDrive(fileId) { return { buffer: files[fileId] }; },
};
const context = { tenant, actor: 'contract-admin', scope: new Set(['project-demolition']) };
const reader = createContractFinalArtifactReader(deps);

const pdfResult = await reader.loadSignedPdf(context, { contractId, versionId });
assert.deepEqual(pdfResult.buffer, signedPdf);
assert.equal(pdfResult.mimeType, 'application/pdf');
assert.equal(pdfResult.fileName, 'HZ-CT-001-signed.pdf');
assert.equal(pdfResult.sha256, digest(signedPdf));

const receiptResult = await reader.loadEvidenceReceipt(context, { contractId, versionId });
assert.deepEqual(receiptResult.buffer, receipt);
assert.equal(receiptResult.mimeType, 'application/json; charset=utf-8');
assert.equal(receiptResult.fileName, 'HZ-CT-001-evidence-receipt.json');

await assert.rejects(
  () => reader.loadSignedPdf({ ...context, scope: new Set(['another-project']) }, { contractId, versionId }),
  { code: 'PROJECT_SCOPE_DENIED' },
);

const originalHash = bundle.artifacts[0].sha256;
bundle.artifacts[0].sha256 = '0'.repeat(64);
await assert.rejects(
  () => reader.loadSignedPdf(context, { contractId, versionId }),
  { code: 'CONTRACT_FINAL_ARTIFACT_HASH_MISMATCH' },
);
bundle.artifacts[0].sha256 = originalHash;

const pdfRoute = apiTest.routeFor('GET', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/final-signed-pdf`);
assert.equal(pdfRoute.operation, 'loadSignedPdf');
assert.equal(pdfRoute.capability, 'view');
assert.equal(pdfRoute.binary, true);
assert.equal(pdfRoute.finalArtifact, true);
const receiptRoute = apiTest.routeFor('GET', `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/evidence-receipt`);
assert.equal(receiptRoute.operation, 'loadEvidenceReceipt');
assert.equal(receiptRoute.finalArtifact, true);

function response() {
  return {
    status: 0, headers: {}, body: Buffer.alloc(0),
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
    },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); },
  };
}
const pathname = `/contracts/api/v2/contracts/${contractId}/versions/${versionId}/final-signed-pdf`;
const binaryResponse = response();
await handleContractWorkflowApiRequest(
  { method: 'GET' }, binaryResponse, pathname, new URL(`https://example.test${pathname}`), deps,
  { scope: context.scope, capabilities: { view: true } },
);
assert.equal(binaryResponse.status, 200);
assert.equal(binaryResponse.headers['content-type'], 'application/pdf');
assert.equal(binaryResponse.headers['cache-control'], 'private, no-store, max-age=0');
assert.deepEqual(binaryResponse.body, signedPdf);

const deniedResponse = response();
await handleContractWorkflowApiRequest(
  { method: 'GET' }, deniedResponse, pathname, new URL(`https://example.test${pathname}`), deps,
  { scope: context.scope, capabilities: { view: false } },
);
assert.equal(deniedResponse.status, 403);
assert.equal(JSON.parse(deniedResponse.body.toString()).error.code, 'CONTRACT_CAPABILITY_REQUIRED');

console.log('dryrun-engineering-contract-final-artifacts: OK');

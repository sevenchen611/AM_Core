import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContractArtifactService } from '../modules/construction/contract-artifacts.js';

const pdf = Buffer.from('%PDF-1.7\nengineering contract test\n%%EOF');
const hash = createHash('sha256').update(pdf).digest('hex');
const requests = [];
const folders = [];
const deps = {
  tenant: { config: { contracts: {
    pdfRenderUrl: 'https://pdf.example.test/',
    pdfRenderToken: 'test-only-pdf-render-token-with-32-bytes',
  } } },
  driveConfigured: true,
  driveRootFolderId: 'root',
  ensureDriveFolder: async (name, parent) => { folders.push({ name, parent }); return `${parent}/${name}`; },
  uploadToDrive: async (buffer, filename, contentType, parent) => ({ id: 'pdf-drive-id', webViewLink: 'https://drive.example/pdf', buffer, filename, contentType, parent }),
  auditDrivePrivate: async () => ({ private: true }),
};
const service = createContractArtifactService(deps, {
  fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'x-content-sha256': hash } });
  },
});
assert.equal(service.configured, true);
const rendered = await service.renderPdf('issued_pdf', { immutable: true }, 'contract-version-1');
assert.equal(rendered.sha256, hash);
assert.equal(JSON.parse(requests[0].init.body).kind, 'issued_pdf');
assert.equal(requests[0].init.headers['idempotency-key'], 'contract-version-1');
const stored = await service.storePdf({ projectLabel: 'P01', contractLabel: '泥作/合約', filename: 'P01-泥作.pdf', rendered });
assert.equal(stored.driveFileId, 'pdf-drive-id');
assert.equal(stored.sha256, hash);
assert.equal(folders.at(-1).name, '正式簽署文件');
const receipt = await service.storeEvidenceReceipt({
  projectLabel: 'P01', contractLabel: '泥作合約', filename: 'receipt.json',
  receipt: { z: 2, a: { utc: '2026-08-28T00:00:00.000Z' } },
});
assert.equal(receipt.driveFileId, 'pdf-drive-id');
assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
const signingImage = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('party-a')]);
const storedSigningImage = await service.storeSigningImage({
  projectLabel: 'P01', contractLabel: '泥作合約', filename: 'party-a-signature.png',
  buffer: signingImage, mimeType: 'image/png',
});
assert.equal(storedSigningImage.driveFileId, 'pdf-drive-id');
assert.equal(storedSigningImage.sha256, createHash('sha256').update(signingImage).digest('hex'));
assert.equal(folders.at(-1).name, '正式簽署文件');

await assert.rejects(() => createContractArtifactService({ tenant: { config: { contracts: {} } } })
  .renderPdf('issued_pdf', {}, 'x'), (error) => error.code === 'PDF_RENDERER_NOT_CONFIGURED');

console.log('Engineering contract artifact dry-run passed: HTTPS renderer gate, PDF/hash validation, idempotency, and Drive archive verified.');

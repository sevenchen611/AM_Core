import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import vm from 'node:vm';

import { createContractDraftReviewService } from '../modules/construction/contract-draft-review.js';
import { __test as reviewTest } from '../modules/construction/contract-draft-review.js';
import { __test as webTest } from '../modules/construction/contract-draft-review-web.js';
import { __test as pdfTest } from '../modules/construction/contract-pdf-renderer.js';
import { __test as apiTest } from '../modules/construction/contract-workflow-api.js';

const now = '2026-08-28T12:00:00.000Z';
const bodyHash = '1'.repeat(64);
const pdfHash = '2'.repeat(64);
const version = {
  id: 'version-2', contractId: 'contract-1', versionNo: 2, status: 'draft',
  snapshot: { documentPackage: {
    contractBody: { fileId: 'driveSource123', name: 'contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256: bodyHash, required: true },
    constructionDrawings: [{ fileId: 'drawing123', name: 'drawing.pdf', sha256: '3'.repeat(64) }],
    quotation: { fileId: 'quote12345', name: 'quote.pdf', sha256: '4'.repeat(64) },
  } },
};
version.documentPackage = version.snapshot.documentPackage;
const contract = {
  id: 'contract-1', projectId: 'project-1', projectCode: 'HZ', contractNumber: 'HZ-CT-001',
  title: '拆除合約', counterpartyName: '測試工班', group_binding_notion_page_id: 'notion-group-binding-1234',
};

let storedInput;
let sentInput;
let openedInput;
let responseInput;
let pushedMessage = '';
const deterministicToken = Buffer.alloc(32, 7).toString('base64url');
const tokenDigest = crypto.createHash('sha256').update(deterministicToken).digest('hex');
const baseReview = {
  external_review_id: `cr_${Buffer.alloc(18, 7).toString('base64url')}`,
  status: 'created', version_no: 2, contract_id: 'contract-1', contract_number: 'HZ-CT-001', title: '拆除合約',
  project_code: 'HZ', counterparty_name: '測試工班', missing_sections: ['付款條件', '驗收標準'],
  created_at: now, expires_at: '2026-09-11T12:00:00.000Z', disclaimer_version: 'engineering-draft-review-v1',
  draft_pdf_drive_file_id: 'draftPdf123', draft_pdf_sha256: pdfHash,
  contract_body_drive_file_id: 'driveSource123', contract_body_sha256: bodyHash,
  contract_body_file_name: 'contract.docx',
  contract_body_mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  contract_snapshot: version.snapshot,
};
const priorReview = {
  ...baseReview,
  external_review_id: 'cr_prior_review_1234567890',
  version_no: 1,
  status: 'changes_requested',
  decision: 'changes_requested',
  reviewer_name: '陳師傅',
  response_notes: 'V1 請補充付款日期與驗收方式',
  responded_at: '2026-08-28T10:00:00.000Z',
};
let currentResponse = null;

const store = {
  async createDraftReview(_tenant, input) { storedInput = input; return { value: { ...baseReview } }; },
  async listDraftReviews() { return [priorReview, currentResponse || { ...baseReview, status: 'sent', sent_at: now }]; },
  async getDraftReviewByTokenDigest(_tenant, digest) {
    assert.equal(digest, tokenDigest);
    return { ...baseReview, status: 'sent', token_digest: digest };
  },
  async recordDraftReviewSent(_tenant, input) { sentInput = input; return { value: { ...baseReview, status: 'sent', sent_at: input.sentAt } }; },
  async openDraftReview(_tenant, input) { openedInput = input; return { value: { ...baseReview, status: 'opened', opened_at: input.openedAt } }; },
  async respondDraftReview(_tenant, input) { responseInput = input; currentResponse = { ...baseReview, status: input.decision,
    decision: input.decision, reviewer_name: input.reviewerName, response_notes: input.notes, responded_at: input.respondedAt }; return { value: currentResponse }; },
  async revokeDraftReview() { return { value: { ...baseReview, status: 'revoked' } }; },
};

const deps = {
  contractStore: store,
  publicBaseUrl: 'https://am.example.test',
  async auditDrivePrivate() { return { private: true }; },
  async pushLineMessage(_groupId, message) { pushedMessage = message; return { ok: true, messageIds: ['line-message-1'] }; },
};

const artifactService = {
  async renderPdf(kind, payload) {
    assert.equal(kind, 'draft_review_pdf');
    assert.match(payload.contractBodyText, /第一條/);
    assert.deepEqual(payload.missingSections, ['付款條件', '驗收標準']);
    return { buffer: Buffer.from('%PDF-draft'), sha256: pdfHash, byteSize: 10 };
  },
  async storePdf() { return { driveFileId: 'draftPdf123', sha256: pdfHash, byteSize: 10 }; },
};

const service = createContractDraftReviewService(deps, {
  artifactService,
  managementService: { async getContractDetail() { return { contract, versions: [version], latestVersion: version }; } },
  authorityResolver: async () => ({ groupBindingId: 'notion-group-binding-1234', lineGroupId: 'Cgroup1234', groupName: '工程群組', members: {} }),
  bodyExtractor: async () => '工程合約書\n第一條：工程名稱',
  randomBytes: (size) => Buffer.alloc(size, 7),
  clock: () => new Date(now),
});

const context = { tenant: { key: 'engineering' }, actor: 'owner@example.test', scope: { all: true } };
const issued = await service.issueDraftReview(context, { contractId: contract.id, versionId: version.id });
assert.equal(issued.sent, true);
assert.equal(storedInput.tokenDigest, tokenDigest);
assert.equal(storedInput.contractBodySha256, bodyHash);
assert.deepEqual(storedInput.missingSections, ['付款條件', '驗收標準']);
assert.equal(sentInput.lineMessageId, 'line-message-1');
assert.match(pushedMessage, /不是正式簽署/);
assert.match(pushedMessage, /\/contract-review\?openExternalBrowser=1#token=/);
assert.equal(JSON.stringify(issued).includes(deterministicToken), false, 'raw token must not return to admin UI');

const unreadableService = createContractDraftReviewService(deps, {
  artifactService,
  managementService: { async getContractDetail() { return { contract, versions: [version], latestVersion: version }; } },
  authorityResolver: async () => ({ groupBindingId: 'notion-group-binding-1234', lineGroupId: 'Cgroup1234' }),
  bodyExtractor: async () => { throw new Error('zip parse failed'); },
  randomBytes: (size) => Buffer.alloc(size, 8),
  clock: () => new Date(now),
});
await assert.rejects(
  () => unreadableService.issueDraftReview(context, { contractId: contract.id, versionId: version.id }),
  (error) => error.code === 'DRAFT_REVIEW_SOURCE_PREPARE_FAILED'
    && /Word／PDF/.test(error.message)
    && error.statusCode === 422,
);

const req = { headers: { 'user-agent': 'draft-review-test' }, socket: { remoteAddress: '203.0.113.8' } };
const opened = await service.openReview(context.tenant, { token: deterministicToken }, req);
assert.equal(opened.status, 'opened');
assert.equal(openedInput.ipAddress, '203.0.113.8');
assert.deepEqual(opened.attachments.map((item) => item.category), ['contract_body', 'construction_drawing', 'quotation']);
assert.deepEqual(opened.reviewHistory.map((item) => [item.versionNo, item.reviewerName, item.responseNotes]), [
  [1, '陳師傅', 'V1 請補充付款日期與驗收方式'],
]);
const responded = await service.respond(context.tenant, {
  token: deterministicToken, reviewerName: '王先生', decision: 'changes_requested', notes: '請調整付款日期',
}, req);
assert.equal(responded.status, 'changes_requested');
assert.equal(responseInput.reviewerName, '王先生');
assert.equal(responded.reviewerName, '王先生');
assert.equal(responded.responseNotes, '請調整付款日期');
assert.equal(responded.respondedAt, now);
assert.deepEqual(responded.reviewHistory.map((item) => item.versionNo), [1, 2]);

const page = webTest.renderPage().body;
assert.match(page, /草約｜不得簽署/);
assert.match(page, /不構成簽約、承諾或電子簽章/);
assert.match(page, /提出修改/);
assert.match(page, /合約與附件檔案/);
assert.match(page, /完整合併草約 PDF/);
assert.match(page, /開啟 PDF 檔案/);
assert.match(page, /本次審閱意見/);
assert.match(page, /歷次審閱意見/);
assert.match(page, /不同意見不會互相覆寫/);
assert.match(page, /response-reviewer/);
assert.match(page, /response-notes/);
const webSource = fs.readFileSync(new URL('../modules/construction/contract-draft-review-web.js', import.meta.url), 'utf8');
assert.match(webSource, /form\.target='_blank'/);
assert.match(webSource, /application\/x-www-form-urlencoded/);
assert.match(webSource, /externalBrowserFallback/);
assert.match(webSource, /openExternalBrowser=1#token=/);
assert.doesNotMatch(webSource, /draft-preview|frame-src blob:|URL\.createObjectURL/);
const testElements = new Map();
const fallbackLinks = [];
const element = () => ({
  after() {}, append() {}, replaceChildren() {}, addEventListener() {},
  className: '', textContent: '', hidden: false, value: '', checked: false,
});
const scriptDocument = {
  getElementById(id) {
    if (!testElements.has(id)) testElements.set(id, element());
    return testElements.get(id);
  },
  createElement(tag) {
    const created = element();
    if (tag === 'a') fallbackLinks.push(created);
    return created;
  },
  querySelector() { return null; },
  body: { append() {} },
};
await new vm.Script(webTest.pageScript()).runInNewContext({
  document: scriptDocument,
  navigator: { userAgent: 'Mozilla/5.0 Line/15.0' },
  location: { hash: `#token=${deterministicToken}`, pathname: '/contract-review', search: '' },
  history: { replaceState() {} },
  fetch: async () => ({ ok: false, async json() { return { error: 'expected test stop' }; } }),
  URLSearchParams,
  encodeURIComponent,
});
assert.equal(fallbackLinks.length, 1, 'legacy LINE links should render one external-browser fallback');
assert.match(fallbackLinks[0].href, /^\/contract-review\?openExternalBrowser=1#token=/);
assert.notEqual(testElements.get('message').textContent, 'i is not defined');
const formRequest = Readable.from([Buffer.from(`token=${encodeURIComponent(deterministicToken)}`)]);
formRequest.headers = { 'content-type': 'application/x-www-form-urlencoded' };
assert.deepEqual(await webTest.readDocumentInput(formRequest), { token: deterministicToken });

const { PDFDocument } = await import('pdf-lib');
const basePdf = await PDFDocument.create(); basePdf.addPage();
const drawingPdf = await PDFDocument.create(); drawingPdf.addPage(); drawingPdf.addPage();
const baseBytes = Buffer.from(await basePdf.save());
const drawingBytes = Buffer.from(await drawingPdf.save());
const drawingSha256 = crypto.createHash('sha256').update(drawingBytes).digest('hex');
const quotationPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nEAAAAAASUVORK5CYII=', 'base64');
const quotationSha256 = crypto.createHash('sha256').update(quotationPng).digest('hex');
const attachmentBuffers = { 'drawing-file': drawingBytes, 'quotation-file': quotationPng };
const composed = await reviewTest.composeDraftBundle(baseBytes, [{
  id: '0', fileId: 'drawing-file', sha256: drawingSha256, name: 'drawing.pdf',
  category: 'construction_drawing', mimeType: 'application/pdf',
}, {
  id: '1', fileId: 'quotation-file', sha256: quotationSha256, name: 'quotation.png',
  category: 'quotation', mimeType: 'image/png',
}], {
  async auditDrivePrivate() { return { private: true }; },
  async downloadFromDrive(fileId) { return { buffer: attachmentBuffers[fileId] }; },
}, [priorReview].map((item) => reviewTest.reviewHistory([item], 2)[0]), contract, 2);
const composedPdf = await PDFDocument.load(composed);
assert.equal(composedPdf.getPageCount(), 5, 'draft preview must append source files and the review-history appendix');

const bodyBytes = Buffer.from('internal contract source');
const internalVersion = {
  ...version,
  snapshot: { documentPackage: {
    contractBody: { fileId: 'internal-body', name: 'contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sha256: crypto.createHash('sha256').update(bodyBytes).digest('hex') },
    constructionDrawings: [{ fileId: 'drawing-file', name: 'drawing.pdf',
      mimeType: 'application/pdf', sha256: drawingSha256 }],
    quotation: { fileId: 'quotation-file', name: 'quotation.png',
      mimeType: 'image/png', sha256: quotationSha256 },
  } },
};
internalVersion.documentPackage = internalVersion.snapshot.documentPackage;
let internalLineSends = 0;
let internalReviewCreates = 0;
const internalStore = {
  ...store,
  async createDraftReview() { internalReviewCreates += 1; throw new Error('must not create review'); },
  async listDraftReviews() { return [priorReview]; },
};
const internalBuffers = { 'internal-body': bodyBytes, ...attachmentBuffers };
const internalService = createContractDraftReviewService({
  ...deps,
  contractStore: internalStore,
  async downloadFromDrive(id) { return { buffer: internalBuffers[id] }; },
  async pushLineMessage() { internalLineSends += 1; throw new Error('must not send LINE'); },
}, {
  artifactService: {
    async renderPdf() { return { buffer: baseBytes, sha256: crypto.createHash('sha256').update(baseBytes).digest('hex'), byteSize: baseBytes.length }; },
    async storePdf() { throw new Error('must not store preview'); },
  },
  managementService: { async getContractDetail() { return { contract, versions: [internalVersion], latestVersion: internalVersion }; } },
  bodyExtractor: async () => '工程合約書\n第一條：工程名稱',
});
const internalPreview = await internalService.previewInternal(context, {
  contractId: contract.id, versionId: internalVersion.id,
});
assert.equal(internalPreview.mimeType, 'application/pdf');
assert.match(internalPreview.fileName, /HZ-CT-001-V2-INTERNAL-REVIEW\.pdf/);
assert.equal((await PDFDocument.load(internalPreview.buffer)).getPageCount(), 5);
const internalBody = await internalService.loadInternalAttachment(context, {
  contractId: contract.id, versionId: internalVersion.id, attachmentId: '0',
});
assert.deepEqual(internalBody.buffer, bodyBytes);
assert.equal(internalLineSends, 0, 'internal preview must not send LINE');
assert.equal(internalReviewCreates, 0, 'internal preview must not create an external review');

const pdfPayload = pdfTest.validatePayload({ kind: 'draft_review_pdf', contract: {}, version: {} });
assert.equal(pdfPayload.kind, 'draft_review_pdf');
const issueRoute = apiTest.routeFor('POST', '/contracts/api/v2/contracts/contract-1/versions/version-1/draft-review');
assert.equal(issueRoute.operation, 'issueDraftReview');
assert.equal(issueRoute.capability, 'manage');
const listRoute = apiTest.routeFor('GET', '/contracts/api/v2/contracts/contract-1/draft-reviews');
assert.equal(listRoute.operation, 'listForContract');
assert.equal(listRoute.capability, 'view');
const previewRoute = apiTest.routeFor('GET', '/contracts/api/v2/contracts/contract-1/versions/version-1/internal-preview');
assert.equal(previewRoute.operation, 'previewInternal');
assert.equal(previewRoute.capability, 'view');
assert.equal(previewRoute.binary, true);
const attachmentRoute = apiTest.routeFor('GET', '/contracts/api/v2/contracts/contract-1/versions/version-1/internal-attachments/2');
assert.equal(attachmentRoute.operation, 'loadInternalAttachment');
assert.equal(attachmentRoute.attachmentId, '2');
const binaryRes = { status: 0, headers: {}, body: null,
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  end(body) { this.body = body; } };
apiTest.sendBinary(binaryRes, { buffer: Buffer.from('pdf'), mimeType: 'application/pdf', fileName: '合約.pdf', sha256: 'a'.repeat(64) });
assert.equal(binaryRes.status, 200);
assert.equal(binaryRes.headers['Content-Type'], 'application/pdf');
assert.match(binaryRes.headers['Content-Disposition'], /^inline;/);
assert.deepEqual(binaryRes.body, Buffer.from('pdf'));

console.log('Engineering contract draft-review dry-run passed: incomplete draft gating, watermarked render kind, LINE group invitation, non-signing disclaimer, open evidence, and reviewer feedback verified.');

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { createContractDraftReviewService } from '../modules/construction/contract-draft-review.js';
import { __test as reviewTest } from '../modules/construction/contract-draft-review.js';
import { __test as webTest } from '../modules/construction/contract-draft-review-web.js';
import { __test as pdfTest } from '../modules/construction/contract-pdf-renderer.js';
import { __test as apiTest } from '../modules/construction/contract-workflow-api.js';

const now = '2026-08-28T12:00:00.000Z';
const bodyHash = '1'.repeat(64);
const pdfHash = '2'.repeat(64);
const version = {
  id: 'version-1', contractId: 'contract-1', versionNo: 1, status: 'draft',
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
  status: 'created', version_no: 1, contract_number: 'HZ-CT-001', title: '拆除合約',
  project_code: 'HZ', counterparty_name: '測試工班', missing_sections: ['付款條件', '驗收標準'],
  created_at: now, expires_at: '2026-09-11T12:00:00.000Z', disclaimer_version: 'engineering-draft-review-v1',
  draft_pdf_drive_file_id: 'draftPdf123', draft_pdf_sha256: pdfHash,
  contract_body_drive_file_id: 'driveSource123', contract_body_sha256: bodyHash,
  contract_body_file_name: 'contract.docx',
  contract_body_mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  contract_snapshot: version.snapshot,
};

const store = {
  async createDraftReview(_tenant, input) { storedInput = input; return { value: { ...baseReview } }; },
  async listDraftReviews() { return [{ ...baseReview, status: 'sent', sent_at: now }]; },
  async getDraftReviewByTokenDigest(_tenant, digest) {
    assert.equal(digest, tokenDigest);
    return { ...baseReview, status: 'sent', token_digest: digest };
  },
  async recordDraftReviewSent(_tenant, input) { sentInput = input; return { value: { ...baseReview, status: 'sent', sent_at: input.sentAt } }; },
  async openDraftReview(_tenant, input) { openedInput = input; return { value: { ...baseReview, status: 'opened', opened_at: input.openedAt } }; },
  async respondDraftReview(_tenant, input) { responseInput = input; return { value: { ...baseReview, status: input.decision,
    decision: input.decision, reviewer_name: input.reviewerName, response_notes: input.notes, responded_at: input.respondedAt } }; },
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
assert.match(pushedMessage, /#token=/);
assert.equal(JSON.stringify(issued).includes(deterministicToken), false, 'raw token must not return to admin UI');

const req = { headers: { 'user-agent': 'draft-review-test' }, socket: { remoteAddress: '203.0.113.8' } };
const opened = await service.openReview(context.tenant, { token: deterministicToken }, req);
assert.equal(opened.status, 'opened');
assert.equal(openedInput.ipAddress, '203.0.113.8');
assert.deepEqual(opened.attachments.map((item) => item.category), ['contract_body', 'construction_drawing', 'quotation']);
const responded = await service.respond(context.tenant, {
  token: deterministicToken, reviewerName: '王先生', decision: 'changes_requested', notes: '請調整付款日期',
}, req);
assert.equal(responded.status, 'changes_requested');
assert.equal(responseInput.reviewerName, '王先生');
assert.equal(responded.reviewerName, '王先生');
assert.equal(responded.responseNotes, '請調整付款日期');
assert.equal(responded.respondedAt, now);

const page = webTest.renderPage().body;
assert.match(page, /草約｜不得簽署/);
assert.match(page, /不構成簽約、承諾或電子簽章/);
assert.match(page, /提出修改/);
assert.match(page, /合約與附件完整預覽/);
assert.match(page, /單獨開啟/);
assert.match(page, /本次審閱意見/);
assert.match(page, /response-reviewer/);
assert.match(page, /response-notes/);
const webSource = fs.readFileSync(new URL('../modules/construction/contract-draft-review-web.js', import.meta.url), 'utf8');
assert.match(webSource, /frame-src blob:/);

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
});
const composedPdf = await PDFDocument.load(composed);
assert.equal(composedPdf.getPageCount(), 4, 'draft preview must append every source PDF page and image');

const pdfPayload = pdfTest.validatePayload({ kind: 'draft_review_pdf', contract: {}, version: {} });
assert.equal(pdfPayload.kind, 'draft_review_pdf');
const issueRoute = apiTest.routeFor('POST', '/contracts/api/v2/contracts/contract-1/versions/version-1/draft-review');
assert.equal(issueRoute.operation, 'issueDraftReview');
assert.equal(issueRoute.capability, 'manage');
const listRoute = apiTest.routeFor('GET', '/contracts/api/v2/contracts/contract-1/draft-reviews');
assert.equal(listRoute.operation, 'listForContract');
assert.equal(listRoute.capability, 'view');

console.log('Engineering contract draft-review dry-run passed: incomplete draft gating, watermarked render kind, LINE group invitation, non-signing disclaimer, open evidence, and reviewer feedback verified.');

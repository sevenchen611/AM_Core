import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

import { captureContractLineArchive } from '../modules/construction/contract-line-archive.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==', 'base64');
const archives = [];
let storedPdf = null;
const messagePages = [{
  id: 'message-page-1', created_time: '2026-08-28T01:00:00.000Z', properties: {
    'LINE 訊息 ID': { rich_text: [{ plain_text: 'line-message-1' }] },
    發送者: { rich_text: [{ plain_text: '陳師傅' }] },
    時間: { date: { start: '2026-08-28T01:00:00.000Z' } },
    訊息類型: { select: { name: '文字' } },
    內容: { rich_text: [{ plain_text: '請確認拆除範圍' }] },
    訊息: { title: [{ plain_text: '請確認拆除範圍' }] },
  },
}, {
  id: 'message-page-2', created_time: '2026-08-28T02:00:00.000Z', properties: {
    'LINE 訊息 ID': { rich_text: [{ plain_text: 'line-message-2' }] },
    發送者: { rich_text: [{ plain_text: '黃師傅' }] },
    時間: { date: { start: '2026-08-28T02:00:00.000Z' } },
    訊息類型: { select: { name: '照片' } },
    內容: { rich_text: [] },
    訊息: { title: [{ plain_text: '[照片] 黃師傅' }] },
  },
}];

const deps = {
  dataSources: { messages: 'messages-ds', attachments: 'attachments-ds' },
  driveConfigured: true, driveRootFolderId: 'root',
  async notionRequest(pathname, request) {
    if (pathname.includes('messages-ds')) {
      const filters = request.body.filter.and;
      assert.equal(filters[0].relation.contains, 'binding-page-123456');
      assert.equal(filters[1].date.on_or_before, '2026-08-28T03:00:00.000Z');
      return { results: messagePages, has_more: false };
    }
    if (pathname.includes('attachments-ds')) return { results: [{ properties: {
      檔案名稱: { rich_text: [{ plain_text: '現場照片.png' }] },
      'Drive 連結': { url: 'https://drive.google.com/file/d/lineImageFile123/view' },
    } }] };
    throw new Error(`unexpected Notion path ${pathname}`);
  },
  async auditDrivePrivate() { return { private: true }; },
  async downloadFromDrive(id) { assert.equal(id, 'lineImageFile123'); return { buffer: png, mimeType: 'image/png' }; },
  contractStore: {
    async listLineConversationArchives() { return archives; },
    async createLineConversationArchive(_tenant, input) {
      const row = {
        id: 'archive-1', archive_key: input.archiveKey, version_id: input.versionId,
        version_no: 1, stage: input.stage, started_after: input.startedAfter,
        ended_at: input.endedAt, message_count: input.messageCount,
        first_message_id: input.firstMessageId, last_message_id: input.lastMessageId,
        source_manifest: input.sourceManifest, source_manifest_sha256: input.sourceManifestSha256,
        pdf_drive_file_id: input.pdfDriveFileId, pdf_sha256: input.pdfSha256,
        created_at: '2026-08-28T03:00:01.000Z',
      };
      archives.push(row);
      return row;
    },
  },
};
const artifactService = {
  async storePdf(input) {
    assert.equal(input.folderName, 'LINE 對話封存');
    storedPdf = input.rendered.buffer;
    return { driveFileId: 'archiveDriveFile123', sha256: input.rendered.sha256, byteSize: input.rendered.byteSize };
  },
};
const result = await captureContractLineArchive(deps, {
  context: { tenant: { key: 'engineering' }, actor: 'owner@example.test' },
  contract: { id: 'contract-1', contractNumber: 'HZ-CT-001', title: '拆除合約', projectCode: 'HZ' },
  version: { id: 'version-1', versionNo: 1 },
  group: { groupBindingId: 'binding-page-123456', lineGroupId: 'Cgroup123', groupName: '拆除工程群組' },
  stage: 'draft_review', endedAt: '2026-08-28T03:00:00.000Z', externalReviewId: 'cr_review_1234567890',
  archiveKey: 'draft-review-line-archive:engineering:cr_review_1234567890',
}, { artifactService });

assert.equal(result.messageCount, 2);
assert.equal(result.firstMessageId, 'line-message-1');
assert.equal(result.lastMessageId, 'line-message-2');
assert.equal(result.driveFileId, 'archiveDriveFile123');
assert.equal(archives[0].source_manifest[1].attachments[0].sha256, crypto.createHash('sha256').update(png).digest('hex'));
assert.ok((await PDFDocument.load(storedPdf)).getPageCount() >= 1);

const duplicate = await captureContractLineArchive(deps, {
  context: { tenant: { key: 'engineering' }, actor: 'owner@example.test' },
  contract: { id: 'contract-1' }, version: { id: 'version-1', versionNo: 1 },
  group: { groupBindingId: 'binding-page-123456', lineGroupId: 'Cgroup123' },
  stage: 'draft_review', endedAt: '2026-08-28T03:00:00.000Z', externalReviewId: 'cr_review_1234567890',
  archiveKey: 'draft-review-line-archive:engineering:cr_review_1234567890',
}, { artifactService });
assert.equal(duplicate.id, 'archive-1');
assert.equal(archives.length, 1, 'archive retry must be idempotent');

console.log('Engineering contract LINE archive dry-run passed: interval messages, image evidence, immutable hashes, PDF output, and idempotency verified.');

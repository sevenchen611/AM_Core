import crypto from 'node:crypto';

import { createContractArtifactService } from './contract-artifacts.js';
import { renderLineConversationArchive } from './contract-pdf-renderer.js';

const MAX_MESSAGES = 5000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function archiveError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
function text(value) { return String(value ?? '').trim(); }
function plain(items) { return (items || []).map((item) => item?.plain_text || item?.text?.content || '').join('').trim(); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function driveFileId(url) { return text(url).match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] || ''; }
function stageLabel(stage) { return stage === 'final_issue' ? '正式確認版送簽前' : '草約送廠商確認前'; }

async function queryAllMessages(deps, groupBindingId, startedAfter, endedAt) {
  if (!deps.dataSources?.messages) throw archiveError('LINE_ARCHIVE_MESSAGES_UNAVAILABLE', '工程 LINE 訊息資料庫尚未設定。', 503);
  const filters = [
    { property: '群組綁定', relation: { contains: groupBindingId } },
    { property: '時間', date: { on_or_before: endedAt } },
  ];
  if (startedAfter) filters.push({ property: '時間', date: { after: startedAfter } });
  const rows = [];
  let cursor;
  do {
    const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.messages)}/query`, {
      method: 'POST',
      body: {
        filter: { and: filters }, sorts: [{ property: '時間', direction: 'ascending' }],
        page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
      },
    });
    rows.push(...(result.results || []));
    if (rows.length > MAX_MESSAGES) throw archiveError('LINE_ARCHIVE_TOO_MANY_MESSAGES', '本次 LINE 對話超過 5,000 則，請先縮小封存區間。', 413);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return rows;
}

async function messageAttachments(deps, messagePageId) {
  if (!deps.dataSources?.attachments) return [];
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.attachments)}/query`, {
    method: 'POST', body: { filter: { property: '訊息', relation: { contains: messagePageId } }, page_size: 20 },
  });
  const output = [];
  for (const page of result.results || []) {
    const properties = page.properties || {};
    const name = plain(properties['檔案名稱']?.rich_text) || plain(properties['附件項目']?.title) || 'LINE 附件';
    const id = driveFileId(properties['Drive 連結']?.url);
    const attachment = { name, fileId: id, mimeType: '', sha256: '', buffer: null };
    if (id && typeof deps.downloadFromDrive === 'function') {
      try {
        await deps.auditDrivePrivate?.(id);
        const downloaded = await deps.downloadFromDrive(id, MAX_IMAGE_BYTES);
        if (Buffer.isBuffer(downloaded?.buffer) && downloaded.buffer.length) {
          attachment.buffer = downloaded.buffer;
          attachment.mimeType = text(downloaded.mimeType || downloaded.contentType).toLowerCase()
            || (/\.png$/i.test(name) ? 'image/png' : 'image/jpeg');
          attachment.sha256 = sha256(downloaded.buffer);
        }
      } catch { /* metadata remains in the immutable archive even when media cannot be embedded */ }
    }
    output.push(attachment);
  }
  return output;
}

async function normalizedMessages(deps, pages) {
  const messages = [];
  for (const page of pages) {
    const properties = page.properties || {};
    const message = {
      pageId: page.id,
      messageId: plain(properties['LINE 訊息 ID']?.rich_text) || page.id,
      sender: plain(properties['發送者']?.rich_text) || '未知發言人',
      time: properties['時間']?.date?.start || page.created_time,
      messageType: properties['訊息類型']?.select?.name || '其他',
      content: plain(properties['內容']?.rich_text) || plain(properties['訊息']?.title),
      attachments: [],
    };
    if (['照片', '檔案'].includes(message.messageType)) message.attachments = await messageAttachments(deps, page.id);
    messages.push(message);
  }
  return messages;
}

function evidenceManifest(messages) {
  return messages.map((message) => ({
    pageId: message.pageId, messageId: message.messageId, sender: message.sender,
    time: message.time, messageType: message.messageType, content: message.content,
    attachments: message.attachments.map(({ name, fileId, mimeType, sha256: hash }) => ({ name, fileId, mimeType, sha256: hash })),
  }));
}

export function publicLineArchive(row) {
  return {
    id: row.id, versionId: row.version_id, versionNo: Number(row.version_no), stage: row.stage,
    stageLabel: stageLabel(row.stage), startedAfter: row.started_after, endedAt: row.ended_at,
    messageCount: Number(row.message_count), firstMessageId: row.first_message_id,
    lastMessageId: row.last_message_id, fileName: row.file_name
      || `V${row.version_no}-${row.stage === 'final_issue' ? '正式送簽前' : '草約送出前'}-LINE對話封存.pdf`,
    mimeType: 'application/pdf', sha256: row.pdf_sha256, createdAt: row.created_at,
  };
}

export async function captureContractLineArchive(deps, input, options = {}) {
  const required = ['createLineConversationArchive', 'listLineConversationArchives'];
  if (required.some((method) => typeof deps.contractStore?.[method] !== 'function')) {
    throw archiveError('LINE_ARCHIVE_STORE_UNAVAILABLE', '工程合約 LINE 對話封存資料庫尚未完成升級。', 503);
  }
  const artifacts = options.artifactService || createContractArtifactService(deps);
  const contract = input.contract;
  const version = input.version;
  const cutoff = new Date(input.endedAt || new Date()).toISOString();
  const archiveKey = input.archiveKey;
  const existing = await deps.contractStore.listLineConversationArchives(input.context.tenant, contract.id);
  const duplicate = existing.find((row) => row.archive_key === archiveKey);
  if (duplicate) return { ...publicLineArchive(duplicate), driveFileId: duplicate.pdf_drive_file_id };
  const previous = [...existing].filter((row) => Date.parse(row.ended_at) < Date.parse(cutoff)).at(-1);
  const startedAfter = input.startedAfter !== undefined ? input.startedAfter : (previous?.ended_at || null);
  const pages = await queryAllMessages(deps, input.group.groupBindingId, startedAfter, cutoff);
  const messages = await normalizedMessages(deps, pages);
  const manifest = evidenceManifest(messages);
  const manifestSha256 = sha256(Buffer.from(canonical(manifest), 'utf8'));
  const pdf = await renderLineConversationArchive({
    contractNumber: contract.contractNumber || contract.contract_number, title: contract.title,
    versionNo: version.versionNo || version.version_no, groupName: input.group.groupName,
    stageLabel: stageLabel(input.stage), startedAfter, endedAt: cutoff, messages,
  });
  const rendered = { buffer: pdf, sha256: sha256(pdf), byteSize: pdf.length };
  const fileName = `${contract.contractNumber || contract.id}-V${version.versionNo || version.version_no}-${input.stage === 'final_issue' ? 'FINAL' : 'DRAFT'}-LINE-對話封存.pdf`;
  const stored = await artifacts.storePdf({
    projectLabel: contract.projectCode || contract.projectId,
    contractLabel: contract.contractNumber || contract.title || contract.id,
    filename: fileName, folderName: 'LINE 對話封存', rendered,
  });
  const row = await deps.contractStore.createLineConversationArchive(input.context.tenant, {
    archiveKey, versionId: version.id, externalReviewId: input.externalReviewId,
    stage: input.stage, groupBindingId: input.group.groupBindingId, lineGroupId: input.group.lineGroupId,
    startedAfter, endedAt: cutoff, firstMessageId: manifest.at(0)?.messageId,
    lastMessageId: manifest.at(-1)?.messageId, messageCount: manifest.length,
    sourceManifest: manifest, sourceManifestSha256: manifestSha256,
    pdfDriveFileId: stored.driveFileId, pdfSha256: stored.sha256,
    pdfByteSize: stored.byteSize, actor: input.context.actor,
  });
  return { ...publicLineArchive({ ...row, file_name: fileName }), driveFileId: stored.driveFileId };
}

export const __test = { canonical, stageLabel, evidenceManifest, publicLineArchive, driveFileId };

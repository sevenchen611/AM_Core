import crypto from 'node:crypto';
import { createContractManagementService } from './contract-management.js';
import { CONTRACT_FILE_MAX_BYTES } from './contract-files.js';
import { ContractSigningError } from './contract-signing.js';

const TYPES = Object.freeze({
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dwg: 'application/acad',
});
const CATEGORIES = new Set(['quotation', 'construction_drawing', 'other']);
const text = (value) => String(value ?? '').trim();
const plain = (items) => (items || []).map((item) => item?.plain_text || item?.text?.content || '').join('').trim();
const unwrap = (value) => value?.value ?? value;
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const fail = (code, message, statusCode = 400) => Object.assign(new ContractSigningError(code, message, statusCode), { statusCode });
const packageOf = (version) => version?.documentPackage || version?.snapshot?.documentPackage || version?.contractSnapshot?.documentPackage || version?.contract_snapshot?.documentPackage || {};
function documents(version) {
  const pkg = packageOf(version);
  return [pkg.contractBody, ...(pkg.constructionDrawings || []), pkg.quotation, ...(pkg.attachments || [])].filter(Boolean);
}
function mimeFor(name) { return TYPES[text(name).split('.').pop().toLowerCase()] || ''; }

export function createContractLineAttachmentService(deps) {
  const management = createContractManagementService({ store: deps.contractStore });

  async function query(source, filter, limit) {
    const rows = [];
    let cursor;
    do {
      const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(source)}/query`, {
        method: 'POST', body: { filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
      });
      rows.push(...(result.results || []));
      if (rows.length > limit) throw fail('LINE_ATTACHMENT_LIMIT', '群組檔案過多，請由管理員分批整理。', 413);
      cursor = result.has_more ? result.next_cursor : null;
      if (result.has_more && !cursor) throw fail('LINE_ATTACHMENT_CURSOR_MISSING', '群組檔案查詢不完整，請稍後重試。', 503);
    } while (cursor);
    return rows;
  }

  async function candidates(context, input) {
    if (!deps.tenant?.key || context?.tenant?.key !== deps.tenant.key) throw fail('LINE_ATTACHMENT_TENANT_MISMATCH', '群組檔案的租戶授權不一致。', 403);
    // Contract management rechecks tenant and project scope before any Notion/Drive access.
    const detail = await management.getContractDetail(context, { contractId: input.contractId });
    const version = detail.versions.find((item) => item.id === text(input.versionId));
    if (!version) throw fail('CONTRACT_VERSION_NOT_FOUND', '找不到合約版本。', 404);
    const groupId = text(detail.contract.groupBindingId || detail.contract.group_binding_id || detail.contract.group_binding_notion_page_id);
    if (!groupId) throw fail('LINE_GROUP_REQUIRED', '這份合約尚未綁定工程 LINE 群組。', 409);
    if (!deps.dataSources?.messages || !deps.dataSources?.attachments || !deps.notionRequest) {
      throw fail('LINE_ATTACHMENT_STORE_UNAVAILABLE', '工程 LINE 檔案資料庫尚未設定。', 503);
    }
    const messages = (await query(deps.dataSources.messages, { and: [
      { property: '群組綁定', relation: { contains: groupId } },
      { or: [{ property: '訊息類型', select: { equals: '檔案' } }, { property: '訊息類型', select: { equals: '照片' } }] },
    ] }, 5000)).filter((message) => !message.archived && !message.in_trash
      && (message.properties?.['群組綁定']?.relation || []).some((item) => item.id === groupId));
    const included = new Set(documents(version).filter((item) => item.inherited !== true).map((item) => text(item.fileId || item.file_id)));
    const excluded = new Set(detail.versions.flatMap((item) => item.snapshot?.attachmentExclusions || []).map((item) => text(item).replace(/^file:/, '')));
    const rows = [];
    const seen = new Set();
    for (let offset = 0; offset < messages.length; offset += 50) {
      const batch = messages.slice(offset, offset + 50);
      const byId = new Map(batch.map((message) => [message.id, message]));
      const pages = await query(deps.dataSources.attachments, { or: batch.map((message) => ({ property: '訊息', relation: { contains: message.id } })) }, 1000);
      for (const page of pages) {
        if (page.archived || page.in_trash) continue;
        const props = page.properties || {};
        const message = (props['訊息']?.relation || []).map((item) => byId.get(item.id)).find(Boolean);
        if (!message) continue;
        const name = plain(props['檔案名稱']?.rich_text) || plain(props['附件項目']?.title) || 'LINE 附件';
        const fileId = text(props['Drive 連結']?.url).match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || '';
        const identity = fileId || page.id;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const mimeType = mimeFor(name);
        const sizeBytes = Number(props['檔案大小']?.number || 0);
        const reason = !fileId ? '尚未保存原始檔，請重新上傳' : !mimeType ? '格式不支援（PDF、圖片、DOCX、XLSX、DWG）'
          : sizeBytes > CONTRACT_FILE_MAX_BYTES ? '檔案超過 25 MB' : excluded.has(fileId) ? '已從合約排除，避免自動重新納入' : '';
        rows.push({ id: page.id, name, fileId, mimeType, sizeBytes, available: !reason, reason,
          included: included.has(fileId), category: /報價|quote|quotation/i.test(name) ? 'quotation' : /施工|圖|drawing|\.dwg$/i.test(name) ? 'construction_drawing' : 'other',
          sourceEvidence: { source: 'line', groupBindingId: groupId, messagePageId: message.id,
            messageId: plain(message.properties?.['LINE 訊息 ID']?.rich_text) || message.id,
            sender: plain(message.properties?.['發送者']?.rich_text),
            time: message.properties?.['時間']?.date?.start || message.created_time,
            attachmentPageId: page.id, fileName: name },
        });
        if (rows.length > 1000) throw fail('LINE_ATTACHMENT_LIMIT', '群組檔案超過 1,000 份，請由管理員分批整理。', 413);
      }
    }
    rows.sort((a, b) => text(b.sourceEvidence.time).localeCompare(text(a.sourceEvidence.time)));
    return { detail, version, rows };
  }

  async function download(item) {
    if (!item.available) throw fail('LINE_ATTACHMENT_UNAVAILABLE', item.reason, 409);
    if (typeof deps.auditDrivePrivate !== 'function' || typeof deps.downloadFromDrive !== 'function') {
      throw fail('LINE_ATTACHMENT_DRIVE_UNAVAILABLE', '私有檔案讀取尚未設定。', 503);
    }
    if ((await deps.auditDrivePrivate(item.fileId))?.private !== true) throw fail('LINE_ATTACHMENT_NOT_PRIVATE', '檔案不是私有保存，禁止納入或開啟。', 409);
    const result = await deps.downloadFromDrive(item.fileId, CONTRACT_FILE_MAX_BYTES);
    const buffer = Buffer.isBuffer(result) ? result : result?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > CONTRACT_FILE_MAX_BYTES) throw fail('LINE_ATTACHMENT_SIZE_INVALID', '檔案大小不合法或超過 25 MB。', 413);
    return { buffer, fileName: item.name, mimeType: item.mimeType, sha256: hash(buffer) };
  }

  async function listCandidates(context, input) {
    const { rows } = await candidates(context, input);
    // Never expose Drive URLs/ids to the browser; previews use the scoped gateway.
    return rows.map(({ fileId, ...item }) => item);
  }
  async function loadCandidate(context, input) {
    const { rows } = await candidates(context, input);
    const item = rows.find((row) => row.id === text(input.attachmentId));
    if (!item) throw fail('LINE_ATTACHMENT_NOT_FOUND', '檔案不屬於本合約群組。', 404);
    return download(item);
  }
  async function importCandidates(context, input) {
    if (!Array.isArray(input.selections) || !input.selections.length || input.selections.length > 30) throw fail('LINE_ATTACHMENT_SELECTION_REQUIRED', '請選擇 1～30 份檔案。');
    const { detail, version, rows } = await candidates(context, input);
    if (detail.latestVersion?.id !== version.id) throw fail('LINE_ATTACHMENT_STALE_VERSION', '合約已建立新版，請重新開啟後再選取檔案。', 409);
    const pkg = structuredClone(packageOf(version));
    const additions = [];
    const selected = new Set();
    for (const selection of input.selections) {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw fail('LINE_ATTACHMENT_SELECTION_INVALID', '附件選取資料不合法。');
      const item = rows.find((row) => row.id === text(selection.id));
      if (!item) throw fail('LINE_ATTACHMENT_NOT_FOUND', '檔案不屬於本合約群組。', 404);
      if (selected.has(item.id)) continue;
      selected.add(item.id);
      if (item.included) throw fail('LINE_ATTACHMENT_ALREADY_INCLUDED', `已納入合約：${item.name}`, 409);
      const category = text(selection.category || item.category);
      if (!CATEGORIES.has(category)) throw fail('LINE_ATTACHMENT_CATEGORY_INVALID', '附件分類不合法。');
      const loaded = await download(item);
      const attachment = { fileId: item.fileId, name: item.name, category, mimeType: loaded.mimeType,
        sizeBytes: loaded.buffer.length, sha256: loaded.sha256, required: category !== 'other',
        sourceVersionNo: version.versionNo + 1, sourceEvidence: item.sourceEvidence };
      if (Array.isArray(pkg.attachments)) pkg.attachments = pkg.attachments.filter((old) => text(old.fileId || old.file_id) !== item.fileId);
      // Promote drawings/first quotation to the required slots; extra quotes stay as attachments.
      if (category === 'construction_drawing') pkg.constructionDrawings = [...(pkg.constructionDrawings || []), attachment];
      else if (category === 'quotation' && !pkg.quotation) pkg.quotation = attachment;
      else pkg.attachments = [...(pkg.attachments || []), attachment];
      additions.push(attachment);
    }
    // Fix the next number to make concurrent imports fail the store's unique version guard.
    return management.createDraftVersion(context, { contractId: detail.contract.id, versionNo: version.versionNo + 1,
      documentPackage: pkg, snapshot: { ...structuredClone(version.snapshot || {}), documentPackage: pkg,
        lineAttachmentImport: { sourceVersionId: version.id, actor: context.actor, attachments: additions.map((item) => item.sourceEvidence) } } });
  }
  return Object.freeze({ listCandidates, loadCandidate, importCandidates });
}

export const __test = { documents, mimeFor };

// Call only with the result of openSigningRequest: it verifies LINE identity,
// group membership and the protected permanent contract token on every read.
export function createContractPublicAttachmentReader(deps) {
  async function attachments(opened) {
    if (!opened?.sessionId || !opened.contractId || !opened.projectId) throw fail('CONTRACT_ATTACHMENT_AUTH_REQUIRED', '請先完成 LINE 身分驗證。', 403);
    const bundle = unwrap(await deps.contractStore.getSigningBundle(deps.tenant, opened.sessionId));
    if (!bundle || bundle.contract?.id !== opened.contractId || bundle.contract?.projectId !== opened.projectId) {
      throw fail('CONTRACT_ATTACHMENT_BUNDLE_MISMATCH', '合約附件與簽署版本不一致。', 409);
    }
    const seen = new Set();
    return documents(bundle.version).filter((item) => {
      const id = text(item.fileId || item.file_id);
      if (!id || seen.has(id) || !/^[a-f0-9]{64}$/i.test(text(item.sha256))) return false;
      seen.add(id);
      return item.category !== 'contract_body' && item !== packageOf(bundle.version).contractBody;
    }).map((item, index) => ({ ...item, id: String(index), fileId: text(item.fileId || item.file_id),
      name: text(item.name || item.fileName) || `附件 ${index + 1}` }));
  }
  return Object.freeze({
    list: async (opened) => (await attachments(opened)).map(({ id, name, category }) => ({ id, name, category: category || 'other' })),
    load: async (opened, input) => {
      const item = (await attachments(opened)).find((entry) => entry.id === text(input.attachmentId));
      if (!item) throw fail('CONTRACT_ATTACHMENT_NOT_FOUND', '找不到本簽署版本的附件。', 404);
      if ((await deps.auditDrivePrivate(item.fileId))?.private !== true) throw fail('CONTRACT_ATTACHMENT_NOT_PRIVATE', '附件不是私有檔案，禁止開啟。', 409);
      const result = await deps.downloadFromDrive(item.fileId, CONTRACT_FILE_MAX_BYTES);
      const buffer = Buffer.isBuffer(result) ? result : result?.buffer;
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > CONTRACT_FILE_MAX_BYTES) throw fail('CONTRACT_ATTACHMENT_SIZE_INVALID', '附件大小不合法。', 413);
      if (hash(buffer) !== text(item.sha256).toLowerCase()) throw fail('CONTRACT_ATTACHMENT_HASH_MISMATCH', '附件內容已變更，禁止開啟。', 409);
      return { buffer, fileName: item.name, mimeType: mimeFor(item.name) || 'application/octet-stream' };
    },
  });
}

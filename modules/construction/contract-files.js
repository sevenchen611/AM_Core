import crypto from 'node:crypto';

export const CONTRACT_FILE_MAX_BYTES = 25 * 1024 * 1024;

const KINDS = new Set([
  'contract_body', 'construction_drawing', 'quotation', 'acceptance_attachment', 'other',
]);
const REQUIRED_KINDS = new Set(['contract_body', 'construction_drawing', 'quotation']);
const MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/acad',
  'application/x-acad',
  'application/x-autocad',
  'image/vnd.dwg',
]);

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function safeSegment(value, fallback) {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (normalized || fallback).slice(0, 160);
}

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

export async function readContractFileBody(req, maxBytes = CONTRACT_FILE_MAX_BYTES) {
  const declared = Number(header(req, 'content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw fail('合約附件不可超過 25 MB', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw fail('合約附件不可超過 25 MB', 413);
    chunks.push(buffer);
  }
  if (!size) throw fail('合約附件不可為空');
  return Buffer.concat(chunks);
}

export async function uploadContractSourceFile(deps, input = {}) {
  if (!deps.driveConfigured || !deps.driveRootFolderId) throw fail('工程合約 Drive 尚未設定', 503);
  const kind = String(input.kind || '').trim();
  if (!KINDS.has(kind)) throw fail('合約附件類型不合法');
  const mimeType = String(input.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!MIME_TYPES.has(mimeType)) throw fail('此附件格式不支援；請使用 PDF、PNG、JPEG、DOCX、XLSX 或 DWG', 415);
  const buffer = input.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > CONTRACT_FILE_MAX_BYTES) {
    throw fail('合約附件大小不合法', buffer?.length > CONTRACT_FILE_MAX_BYTES ? 413 : 400);
  }
  const projectId = String(input.projectId || '').trim();
  if (!projectId) throw fail('缺少工程專案');
  const filename = safeSegment(input.filename, `${kind}.bin`);
  const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
  const projectFolder = await deps.ensureDriveFolder(safeSegment(input.projectLabel || projectId, '工程專案'), root);
  const sourceFolder = await deps.ensureDriveFolder('合約來源附件', projectFolder);
  if (typeof deps.auditDrivePrivate !== 'function') throw fail('工程合約 Drive 隱私稽核尚未設定', 503);
  const folderPrivacy = await deps.auditDrivePrivate(sourceFolder);
  if (folderPrivacy?.private !== true) throw fail('工程合約附件資料夾不可公開分享', 503);
  const uploaded = await deps.uploadToDrive(buffer, filename, mimeType, sourceFolder);
  if (!uploaded?.id) throw fail('Drive 未回傳合約附件 ID', 502);
  const filePrivacy = await deps.auditDrivePrivate(uploaded.id);
  if (filePrivacy?.private !== true) throw fail('工程合約附件不可公開分享', 503);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return Object.freeze({
    category: kind,
    name: filename,
    fileId: uploaded.id,
    sha256,
    mimeType,
    sizeBytes: buffer.length,
    required: REQUIRED_KINDS.has(kind),
    driveUrl: uploaded.webViewLink || '',
    uploadedBy: String(input.actor || ''),
  });
}

export function contractFileUploadMetadata(req) {
  let filename = '';
  try { filename = decodeURIComponent(header(req, 'x-contract-file-name')); } catch { throw fail('附件檔名編碼不正確'); }
  return {
    filename,
    kind: header(req, 'x-contract-document-kind'),
    mimeType: header(req, 'content-type'),
  };
}

export const __test = { safeSegment, MIME_TYPES, KINDS };

import crypto from 'node:crypto';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_SIGNING_IMAGE_BYTES = 2 * 1024 * 1024;
const RENDER_KINDS = new Set(['draft_review_pdf', 'issued_pdf', 'party_a_signed_preview_pdf', 'signed_pdf']);

function artifactError(message, statusCode = 500, code = 'CONTRACT_ARTIFACT_ERROR') {
  return Object.assign(new Error(message), { statusCode, code });
}

function safeSegment(value, fallback) {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (normalized || fallback).slice(0, 160);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function rendererConfig(deps) {
  const config = deps.tenant?.config?.contracts || {};
  const url = String(config.pdfRenderUrl || '').trim().replace(/\/+$/, '');
  const token = String(config.pdfRenderToken || '');
  let safeUrl = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) safeUrl = parsed.toString().replace(/\/+$/, '');
  } catch { /* handled by configured gate */ }
  return { url: safeUrl, token, configured: Boolean(safeUrl && Buffer.byteLength(token, 'utf8') >= 32) };
}

async function responseBuffer(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw artifactError('PDF 產出超過 30 MB', 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw artifactError('PDF 產出大小不合法', 502);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw artifactError('PDF 服務回傳的檔案格式不正確', 502);
  return bytes;
}

export function createContractArtifactService(deps, options = {}) {
  const config = rendererConfig(deps);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs || 30_000);
  const auditDrivePrivate = options.auditDrivePrivate || deps.auditDrivePrivate;

  async function requirePrivateDrive(fileId) {
    if (typeof auditDrivePrivate !== 'function') {
      throw artifactError('工程合約 Drive 隱私稽核尚未設定', 503, 'DRIVE_PRIVACY_AUDIT_REQUIRED');
    }
    const result = await auditDrivePrivate(fileId);
    if (result?.private !== true) throw artifactError('工程合約 Drive 檔案不是私有狀態', 503, 'DRIVE_PRIVACY_AUDIT_FAILED');
  }

  async function renderPdf(kind, payload, idempotencyKey) {
    if (!RENDER_KINDS.has(kind)) throw artifactError('不支援的工程合約 PDF 類型', 400);
    if (!config.configured) throw artifactError('工程合約 PDF 服務尚未設定', 503, 'PDF_RENDERER_NOT_CONFIGURED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.url}/v1/engineering-contracts/render`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
          accept: 'application/pdf',
          'idempotency-key': String(idempotencyKey || ''),
        },
        body: JSON.stringify({ kind, ...payload }),
        signal: controller.signal,
      });
      if (!response.ok) throw artifactError(`工程合約 PDF 服務失敗 (${response.status})`, 502, 'PDF_RENDER_FAILED');
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('application/pdf')) throw artifactError('PDF 服務回傳類型不正確', 502);
      const buffer = await responseBuffer(response, MAX_PDF_BYTES);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const declaredHash = String(response.headers.get('x-content-sha256') || '').trim().toLowerCase();
      if (declaredHash && declaredHash !== sha256) throw artifactError('PDF 服務雜湊驗證失敗', 502, 'PDF_HASH_MISMATCH');
      return { buffer, sha256, byteSize: buffer.length };
    } catch (error) {
      if (error?.name === 'AbortError') throw artifactError('工程合約 PDF 服務逾時', 504, 'PDF_RENDER_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function storePdf({ projectLabel, contractLabel, filename, rendered, folderName = '正式簽署文件' }) {
    if (!deps.driveConfigured || !deps.driveRootFolderId) throw artifactError('工程合約 Drive 尚未設定', 503);
    const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
    const project = await deps.ensureDriveFolder(safeSegment(projectLabel, '工程專案'), root);
    const contract = await deps.ensureDriveFolder(safeSegment(contractLabel, '工程合約'), project);
    const archive = await deps.ensureDriveFolder(safeSegment(folderName, '正式簽署文件'), contract);
    await requirePrivateDrive(archive);
    const uploaded = await deps.uploadToDrive(rendered.buffer, safeSegment(filename, 'contract.pdf'), 'application/pdf', archive);
    if (!uploaded?.id) throw artifactError('Drive 未回傳 PDF 檔案 ID', 502);
    await requirePrivateDrive(uploaded.id);
    return {
      driveFileId: uploaded.id,
      driveUrl: uploaded.webViewLink || '',
      sha256: rendered.sha256,
      byteSize: rendered.byteSize,
    };
  }

  async function storeEvidenceReceipt({ projectLabel, contractLabel, filename, receipt }) {
    if (!deps.driveConfigured || !deps.driveRootFolderId) throw artifactError('工程合約 Drive 尚未設定', 503);
    const buffer = Buffer.from(`${canonical(receipt)}\n`, 'utf8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
    const project = await deps.ensureDriveFolder(safeSegment(projectLabel, '工程專案'), root);
    const contract = await deps.ensureDriveFolder(safeSegment(contractLabel, '工程合約'), project);
    const archive = await deps.ensureDriveFolder('正式簽署文件', contract);
    await requirePrivateDrive(archive);
    const uploaded = await deps.uploadToDrive(buffer, safeSegment(filename, 'evidence-receipt.json'), 'application/json', archive);
    if (!uploaded?.id) throw artifactError('Drive 未回傳證據收據檔案 ID', 502);
    await requirePrivateDrive(uploaded.id);
    return { driveFileId: uploaded.id, driveUrl: uploaded.webViewLink || '', sha256, byteSize: buffer.length };
  }

  async function storeSigningImage({ projectLabel, contractLabel, filename, buffer, mimeType }) {
    if (!deps.driveConfigured || !deps.driveRootFolderId) throw artifactError('工程合約 Drive 尚未設定', 503);
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SIGNING_IMAGE_BYTES) {
      throw artifactError('簽名圖檔大小不合法', buffer?.length > MAX_SIGNING_IMAGE_BYTES ? 413 : 400, 'SIGNING_IMAGE_SIZE_INVALID');
    }
    if (!['image/png', 'image/jpeg'].includes(String(mimeType || '').toLowerCase())) {
      throw artifactError('簽名圖檔必須是 PNG 或 JPEG', 415, 'SIGNING_IMAGE_TYPE_INVALID');
    }
    const normalizedMime = String(mimeType).toLowerCase();
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if ((normalizedMime === 'image/png' && !isPng) || (normalizedMime === 'image/jpeg' && !isJpeg)) {
      throw artifactError('簽名圖檔內容與格式不一致', 422, 'SIGNING_IMAGE_CONTENT_INVALID');
    }
    const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
    const project = await deps.ensureDriveFolder(safeSegment(projectLabel, '工程專案'), root);
    const contract = await deps.ensureDriveFolder(safeSegment(contractLabel, '工程合約'), project);
    const archive = await deps.ensureDriveFolder('正式簽署文件', contract);
    await requirePrivateDrive(archive);
    const uploaded = await deps.uploadToDrive(buffer, safeSegment(filename, 'party-a-signature.png'), normalizedMime, archive);
    if (!uploaded?.id) throw artifactError('Drive 未回傳簽名圖檔 ID', 502);
    await requirePrivateDrive(uploaded.id);
    return {
      driveFileId: uploaded.id,
      driveUrl: uploaded.webViewLink || '',
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      byteSize: buffer.length,
    };
  }

  return Object.freeze({ configured: config.configured, renderPdf, storePdf, storeEvidenceReceipt, storeSigningImage });
}

export const __test = { rendererConfig, safeSegment, responseBuffer, canonical };

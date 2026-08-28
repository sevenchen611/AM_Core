import crypto from 'node:crypto';

import { createContractArtifactService } from './contract-artifacts.js';
import { resolveAuthoritativeContractGroup } from './contract-authority.js';
import { createContractManagementService } from './contract-management.js';
import { isRenderInternalProxyPeer } from './contract-runtime.js';

const REVIEW_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const REVIEW_DECISIONS = new Set(['no_changes', 'changes_requested']);

function reviewError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value) { return String(value ?? '').trim(); }
function unwrap(value) { return value && typeof value === 'object' && Object.hasOwn(value, 'value') ? value.value : value; }
function digestToken(token) { return crypto.createHash('sha256').update(text(token), 'utf8').digest('hex'); }
function safeHash(value) {
  const hash = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw reviewError('DRAFT_REVIEW_HASH_INVALID', '草約文件缺少有效雜湊。', 500);
  return hash;
}
function fileId(value) {
  const id = text(value);
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id)) throw reviewError('DRAFT_REVIEW_FILE_INVALID', '草約文件識別碼不合法。', 500);
  return id;
}

function packageFrom(version) {
  return version?.documentPackage || version?.snapshot?.documentPackage || version?.contract_snapshot?.documentPackage || {};
}

function missingSections(version) {
  const pkg = packageFrom(version);
  const missing = [];
  if (!pkg.contractBody) missing.push('合約本文');
  if (!(pkg.constructionDrawings || []).length) missing.push('施工圖');
  if (!pkg.quotation) missing.push('報價單');
  if (!(pkg.paymentMilestones || []).length) missing.push('付款條件');
  if (!(pkg.acceptanceCriteria || pkg.acceptanceStandards || []).length) missing.push('驗收標準');
  return missing;
}

function contractBody(version) {
  const body = packageFrom(version).contractBody || {};
  return {
    fileId: fileId(body.fileId),
    sha256: safeHash(body.sha256),
    name: text(body.name || body.fileName) || 'contract-body.docx',
    mimeType: text(body.mimeType) || 'application/octet-stream',
  };
}

async function extractContractBody(deps, body) {
  const downloaded = await deps.downloadFromDrive(body.fileId, 25 * 1024 * 1024);
  const buffer = downloaded?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw reviewError('DRAFT_REVIEW_SOURCE_UNAVAILABLE', '無法讀取草約本文。', 502);
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== body.sha256) {
    throw reviewError('DRAFT_REVIEW_SOURCE_CHANGED', '草約本文已變更，請建立新版本後再送出。', 409);
  }
  if (body.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || body.name.toLowerCase().endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const raw = text(result.value);
    if (!raw) throw reviewError('DRAFT_REVIEW_TEXT_EMPTY', 'Word 草約沒有可供審閱的文字。', 422);
    return raw.slice(0, 160_000);
  }
  return '合約本文為附件檔案；請同時開啟草約本文附件查閱。';
}

function contractGroupId(contract) {
  return text(contract.groupBindingId || contract.group_binding_id || contract.group_binding_notion_page_id);
}

function requestEvidence(req) {
  const headers = req?.headers || {};
  const remote = text(req?.socket?.remoteAddress).replace(/^::ffff:/, '');
  const cf = text(headers['cf-connecting-ip']).replace(/^::ffff:/, '');
  const ipAddress = cf && isRenderInternalProxyPeer(remote) ? cf : remote;
  return { ipAddress, userAgent: text(headers['user-agent']).slice(0, 2000) };
}

function publicReview(review) {
  return {
    id: review.external_review_id,
    status: review.status,
    versionNo: Number(review.version_no),
    contractNumber: review.contract_number,
    title: review.title,
    projectCode: review.project_code,
    counterparty: review.counterparty_company || review.counterparty_name || '',
    missingSections: review.missing_sections || [],
    createdAt: review.created_at,
    expiresAt: review.expires_at,
    sentAt: review.sent_at,
    openedAt: review.opened_at,
    respondedAt: review.responded_at,
    decision: review.decision,
    reviewerName: review.reviewer_name,
    responseNotes: review.response_notes,
    disclaimerVersion: review.disclaimer_version,
  };
}

export function createContractDraftReviewService(deps, options = {}) {
  const required = ['createDraftReview', 'listDraftReviews', 'getDraftReviewByTokenDigest',
    'recordDraftReviewSent', 'openDraftReview', 'respondDraftReview', 'revokeDraftReview'];
  if (!deps?.contractStore || required.some((method) => typeof deps.contractStore[method] !== 'function')) {
    throw reviewError('DRAFT_REVIEW_STORE_INVALID', '草約審閱資料庫尚未完成升級。', 503);
  }
  const artifacts = options.artifactService || createContractArtifactService(deps);
  const management = options.managementService || createContractManagementService({ store: deps.contractStore });
  const bodyExtractor = options.bodyExtractor || extractContractBody;
  const authorityResolver = options.authorityResolver || resolveAuthoritativeContractGroup;
  const clock = options.clock || (() => new Date());
  const randomBytes = options.randomBytes || crypto.randomBytes;

  async function issueDraftReview(context, input = {}) {
    const detail = await management.getContractDetail(context, { contractId: input.contractId });
    const contract = detail.contract;
    const version = detail.versions.find((item) => item.id === text(input.versionId));
    if (!version) throw reviewError('DRAFT_REVIEW_VERSION_NOT_FOUND', '找不到這個合約版本。', 404);
    if (version.status !== 'draft') throw reviewError('DRAFT_REVIEW_VERSION_NOT_DRAFT', '只有草稿版本可以送出草約審閱。', 409);
    const body = contractBody(version);
    const group = await authorityResolver(deps, {
      groupBindingId: contractGroupId(contract), projectId: contract.projectId,
    });
    if (typeof deps.auditDrivePrivate !== 'function') throw reviewError('DRAFT_REVIEW_PRIVACY_AUDIT_REQUIRED', 'Drive 隱私稽核尚未設定。', 503);
    await deps.auditDrivePrivate(body.fileId);
    const contractBodyText = await bodyExtractor(deps, body);
    const missing = missingSections(version);
    const idempotencyKey = `engineering-draft-review:${context.tenant.key}:${version.id}:${body.sha256}`;
    const rendered = await artifacts.renderPdf('draft_review_pdf', {
      contract, version, contractBodyText, missingSections: missing,
    }, idempotencyKey);
    const stored = await artifacts.storePdf({
      projectLabel: contract.projectCode || contract.projectId,
      contractLabel: contract.contractNumber || contract.title || contract.id,
      filename: `${contract.contractNumber || contract.id}-v${version.versionNo}-DRAFT-草約.pdf`,
      rendered,
    });
    const rawToken = randomBytes(32).toString('base64url');
    const externalReviewId = `cr_${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(new Date(clock()).getTime() + REVIEW_TTL_MS).toISOString();
    const created = unwrap(await deps.contractStore.createDraftReview(context.tenant, {
      externalReviewId, versionId: version.id, groupBindingId: group.groupBindingId,
      lineGroupId: group.lineGroupId, tokenDigest: digestToken(rawToken),
      draftPdfDriveFileId: stored.driveFileId, draftPdfSha256: safeHash(stored.sha256),
      draftPdfByteSize: stored.byteSize, contractBodyDriveFileId: body.fileId,
      contractBodySha256: body.sha256, contractBodyFileName: body.name,
      contractBodyMimeType: body.mimeType, missingSections: missing, actor: context.actor, expiresAt,
    }));
    const baseUrl = text(deps.publicBaseUrl).replace(/\/+$/, '');
    if (!/^https:\/\//.test(baseUrl)) throw reviewError('DRAFT_REVIEW_PUBLIC_URL_REQUIRED', '草約審閱網址尚未設定。', 503);
    const protectedLink = `${baseUrl}/contract-review#token=${encodeURIComponent(rawToken)}`;
    const missingText = missing.length ? `目前待確認：${missing.join('、')}。` : '目前五項內容已具備，仍以正式簽署版為準。';
    const message = `工程合約草約審閱\n${contract.contractNumber || ''} ${contract.title || ''}／V${version.versionNo}\n${missingText}\n請開啟連結閱覽並回覆「暫無修改意見」或「提出修改」。這不是正式簽署，不產生電子簽章或承諾效力。\n${protectedLink}`;
    const sentAt = new Date(clock()).toISOString();
    let receipt;
    try {
      receipt = await deps.pushLineMessage(group.lineGroupId, message, undefined, {
        retryKey: `engineering-draft-review-line:${externalReviewId}`,
      });
      if (receipt?.ok !== true) throw reviewError('DRAFT_REVIEW_LINE_SEND_FAILED', 'LINE 未接受草約審閱訊息。', 502);
    } catch (error) {
      await deps.contractStore.revokeDraftReview(context.tenant, {
        externalReviewId, revokedAt: new Date(clock()).toISOString(), actor: context.actor,
        reason: 'line_send_failed',
      }).catch(() => {});
      throw error;
    }
    const sent = unwrap(await deps.contractStore.recordDraftReviewSent(context.tenant, {
      externalReviewId, sentAt, lineMessageId: receipt.messageIds?.[0] || receipt.requestId || '',
    }));
    return { ok: true, review: publicReview({ ...created, ...sent, version_no: version.versionNo }), sent: true };
  }

  async function listForContract(context, input = {}) {
    const detail = await management.getContractDetail(context, { contractId: input.contractId });
    const rows = await deps.contractStore.listDraftReviews(context.tenant, detail.contract.id);
    return rows.map(publicReview);
  }

  async function loadByToken(tenant, token) {
    const raw = text(token);
    if (!/^[A-Za-z0-9_-]{32,180}$/.test(raw)) throw reviewError('DRAFT_REVIEW_TOKEN_INVALID', '草約審閱連結無效。', 404);
    const row = await deps.contractStore.getDraftReviewByTokenDigest(tenant, digestToken(raw));
    if (!row) throw reviewError('DRAFT_REVIEW_NOT_FOUND', '找不到草約審閱。', 404);
    if (Date.parse(row.expires_at) <= new Date(clock()).getTime()) throw reviewError('DRAFT_REVIEW_EXPIRED', '草約審閱連結已逾期。', 410);
    if (['revoked', 'expired'].includes(row.status)) throw reviewError('DRAFT_REVIEW_CLOSED', '草約審閱連結已關閉。', 410);
    return { row, tokenDigest: digestToken(raw) };
  }

  async function openReview(tenant, input = {}, req) {
    const loaded = await loadByToken(tenant, input.token);
    const evidence = requestEvidence(req);
    const openedAt = new Date(clock()).toISOString();
    const row = unwrap(await deps.contractStore.openDraftReview(tenant, {
      tokenDigest: loaded.tokenDigest, openedAt, ...evidence,
    }));
    return publicReview({ ...loaded.row, ...row });
  }

  async function respond(tenant, input = {}, req) {
    const loaded = await loadByToken(tenant, input.token);
    const reviewerName = text(input.reviewerName).slice(0, 240);
    if (!reviewerName) throw reviewError('DRAFT_REVIEW_NAME_REQUIRED', '請填寫回覆人姓名。', 422);
    const decision = text(input.decision);
    if (!REVIEW_DECISIONS.has(decision)) throw reviewError('DRAFT_REVIEW_DECISION_REQUIRED', '請選擇審閱結果。', 422);
    const notes = text(input.notes).slice(0, 8000);
    if (decision === 'changes_requested' && notes.length < 2) throw reviewError('DRAFT_REVIEW_NOTES_REQUIRED', '提出修改時請填寫修改內容。', 422);
    const row = unwrap(await deps.contractStore.respondDraftReview(tenant, {
      tokenDigest: loaded.tokenDigest, reviewerName, decision, notes,
      respondedAt: new Date(clock()).toISOString(), ...requestEvidence(req),
    }));
    return publicReview({ ...loaded.row, ...row });
  }

  async function loadDocument(tenant, input = {}, kind = 'draft') {
    const { row } = await loadByToken(tenant, input.token);
    const selected = kind === 'source'
      ? { fileId: row.contract_body_drive_file_id, sha256: row.contract_body_sha256,
        mimeType: row.contract_body_mime_type, fileName: row.contract_body_file_name }
      : { fileId: row.draft_pdf_drive_file_id, sha256: row.draft_pdf_sha256,
        mimeType: 'application/pdf', fileName: `${row.contract_number || 'contract'}-V${row.version_no}-DRAFT.pdf` };
    const downloaded = await deps.downloadFromDrive(selected.fileId, 30 * 1024 * 1024);
    if (!Buffer.isBuffer(downloaded?.buffer)) throw reviewError('DRAFT_REVIEW_DOCUMENT_UNAVAILABLE', '草約文件目前無法讀取。', 502);
    if (crypto.createHash('sha256').update(downloaded.buffer).digest('hex') !== selected.sha256) {
      throw reviewError('DRAFT_REVIEW_DOCUMENT_CHANGED', '草約文件雜湊驗證失敗。', 409);
    }
    return { buffer: downloaded.buffer, ...selected };
  }

  return Object.freeze({ issueDraftReview, listForContract, openReview, respond, loadDocument });
}

export const __test = { digestToken, missingSections, requestEvidence, publicReview };

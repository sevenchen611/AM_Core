import crypto from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { createContractArtifactService } from './contract-artifacts.js';
import { composeDraftBundle, extractContractBodyForVersion } from './contract-draft-review.js';
import { hydratePartyASigningAssets, partyAProfileContext } from './contract-party-a-profiles.js';
import { createContractSigningService } from './contract-signing.js';

const RENDER_PROXY_SENTINEL = 'render';
const RENDER_INTERNAL_PROXY_PEERS = new BlockList();
RENDER_INTERNAL_PROXY_PEERS.addSubnet('10.0.0.0', 8, 'ipv4');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('172.16.0.0', 12, 'ipv4');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('192.168.0.0', 16, 'ipv4');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('127.0.0.0', 8, 'ipv4');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('169.254.0.0', 16, 'ipv4');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('fc00::', 7, 'ipv6');
RENDER_INTERNAL_PROXY_PEERS.addSubnet('fe80::', 10, 'ipv6');
RENDER_INTERNAL_PROXY_PEERS.addAddress('::1', 'ipv6');

function renderProxyMode(proxyIps) {
  return proxyIps.length === 1 && String(proxyIps[0]).trim().toLowerCase() === RENDER_PROXY_SENTINEL;
}

export function isRenderInternalProxyPeer(value) {
  let ip = String(value || '').trim().replace(/%.+$/, '');
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 4) return RENDER_INTERNAL_PROXY_PEERS.check(ip, 'ipv4');
  if (family === 6) return RENDER_INTERNAL_PROXY_PEERS.check(ip, 'ipv6');
  return false;
}

function trustedProxyOptions(config) {
  const trustedProxyIps = new Set(config.trustedProxyIps || []);
  const isRenderProxyMode = renderProxyMode([...trustedProxyIps]);
  return {
    isTrustedProxy: isRenderProxyMode
      ? isRenderInternalProxyPeer
      : (ip) => trustedProxyIps.has(ip),
    trustedClientIpHeaders: config.trustedClientIpHeaders || [],
    // Render documents that CF-Connecting-IP is overwritten while
    // X-Forwarded-For is appended. Never fall back to the spoofable chain in
    // Render mode.
    allowForwardedForFallback: !isRenderProxyMode,
  };
}

function contractConfig(deps) {
  return deps.tenant?.config?.contracts || {};
}

function exactHttpsOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function contractSigningRuntimeReadiness(deps) {
  const config = contractConfig(deps);
  const publicOrigin = exactHttpsOrigin(deps.publicBaseUrl);
  const expectedLiffEndpoint = publicOrigin ? `${publicOrigin}/contract-sign` : '';
  const configuredEndpoint = String(config.liffEndpointUrl || '').trim().replace(/\/+$/, '');
  const proxyIps = Array.isArray(config.trustedProxyIps) ? config.trustedProxyIps.filter(Boolean) : [];
  const proxyHeaders = Array.isArray(config.trustedClientIpHeaders) ? config.trustedClientIpHeaders.filter(Boolean) : [];
  const isRenderProxyMode = renderProxyMode(proxyIps);
  const checks = Object.freeze({
    signingEnabled: config.signingEnabled === true,
    publicBaseUrl: Boolean(publicOrigin),
    liffId: /^\d+-[A-Za-z0-9]+$/.test(String(config.liffId || '').trim()),
    liffEndpoint: Boolean(expectedLiffEndpoint && configuredEndpoint === expectedLiffEndpoint),
    trustedProxy: isRenderProxyMode
      ? proxyHeaders.length === 1 && proxyHeaders[0] === 'cf-connecting-ip'
      : proxyIps.length > 0 && proxyIps.every((ip) => isIP(String(ip).trim()) > 0)
        && proxyHeaders.length > 0 && proxyHeaders.every((header) => /^[a-z0-9-]+$/.test(String(header))),
    dedicatedDatabase: config.databaseDedicated === true,
    databaseTls: (config.databaseSslMode === 'verify-full' && config.databaseCaConfigured === true)
      || (config.databaseSslMode === 'verify-pinned' && config.databaseCaConfigured === true
        && config.databaseCertSha256Configured === true),
  });
  return Object.freeze({
    ready: Object.values(checks).every(Boolean),
    checks,
    publicOrigin,
    expectedLiffEndpoint,
  });
}

export function signingRequestMeta(req) {
  return {
    headers: req?.headers || {},
    remoteAddress: req?.socket?.remoteAddress || '',
  };
}

export function createContractLineAdapter(deps) {
  const config = contractConfig(deps);
  return {
    async pushGroup({ groupId, message, idempotencyKey }) {
      const receipt = await deps.pushLineMessage(groupId, message, undefined, { retryKey: idempotencyKey });
      return {
        accepted: receipt?.ok === true,
        messageId: receipt?.messageIds?.[0] || receipt?.requestId || receipt?.acceptedRequestId || '',
        // LINE push acceptance is not a delivery/read receipt.
      };
    },
    async verifyLiffIdentity({ credential }) {
      const identity = await deps.verifyLiffIdentity(credential, config.liffId);
      return { ...identity, verified: Boolean(identity?.userId) };
    },
    async isGroupMember({ groupId, userId }) {
      try {
        const profile = await deps.lineGet(`/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
        return { member: Boolean(profile?.displayName), displayName: profile?.displayName || '' };
      } catch (error) {
        if (Number(error?.lineStatus || 0) === 404) return { member: false };
        throw error;
      }
    },
  };
}

export function createRuntimeSigningService(deps, storageContext = {}, options = {}) {
  if (!deps.contractStore?.configured(deps.tenant)) throw Object.assign(new Error('合約證據資料庫尚未設定'), { statusCode: 503 });
  const config = contractConfig(deps);
  const readiness = contractSigningRuntimeReadiness(deps);
  if (config.signingEnabled !== true && options.allowDisabledForRevocation !== true) throw Object.assign(new Error('工程合約電子簽署尚未啟用'), { statusCode: 503 });
  if (options.allowDisabledForRevocation !== true && (!readiness.checks.publicBaseUrl || !readiness.checks.liffId || !readiness.checks.liffEndpoint
      || !readiness.checks.trustedProxy || !readiness.checks.dedicatedDatabase || !readiness.checks.databaseTls)) {
    throw Object.assign(new Error('工程合約正式環境安全設定尚未完成'), { statusCode: 503, code: 'CONTRACT_SECURITY_GATE_NOT_READY' });
  }
  if (options.allowDisabledForRevocation !== true && (!config.tokenPepper || Buffer.byteLength(config.tokenPepper, 'utf8') < 32)) {
    throw Object.assign(new Error('工程合約簽署權杖雜湊金鑰尚未設定'), { statusCode: 503 });
  }
  const proxyOptions = trustedProxyOptions(config);
  return createContractSigningService({
    storage: deps.contractStore.signingStorage(deps.tenant, storageContext),
    line: createContractLineAdapter(deps),
    baseUrl: readiness.publicOrigin || 'https://revocation.invalid',
    signingPath: '/contract-sign',
    tokenTtlMs: Number(config.tokenTtlHours || 168) * 60 * 60 * 1000,
    tokenPepper: Buffer.byteLength(String(config.tokenPepper || ''), 'utf8') >= 32
      ? config.tokenPepper
      : 'revocation-only-placeholder-not-used',
    ...proxyOptions,
  });
}

function safeSegment(value, fallback) {
  const normalized = String(value || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (normalized || fallback).slice(0, 120);
}

export async function saveContractSignature(deps, { sessionId, buffer, contentType = 'image/png' }) {
  if (!deps.driveConfigured || !deps.driveRootFolderId) throw Object.assign(new Error('工程合約 Drive 尚未設定'), { statusCode: 503 });
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 2 * 1024 * 1024) {
    throw Object.assign(new Error('簽名圖片大小不合法'), { statusCode: 422 });
  }
  if (!['image/png', 'image/jpeg'].includes(contentType)) throw Object.assign(new Error('簽名必須是 PNG 或 JPEG'), { statusCode: 415 });
  const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
  const evidence = await deps.ensureDriveFolder('簽署證據', root);
  const sessionFolder = await deps.ensureDriveFolder(safeSegment(sessionId, 'unknown-session'), evidence);
  if (typeof deps.auditDrivePrivate !== 'function') throw Object.assign(new Error('工程合約 Drive 隱私稽核尚未設定'), { statusCode: 503 });
  await deps.auditDrivePrivate(sessionFolder);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
  const uploaded = await deps.uploadToDrive(buffer, `signature-${digest.slice(0, 12)}.${extension}`, contentType, sessionFolder);
  if (!uploaded?.id) throw new Error('Drive 未回傳簽名檔案 ID');
  const privacy = await deps.auditDrivePrivate(uploaded.id);
  if (privacy?.private !== true) throw Object.assign(new Error('簽名檔案不可公開分享'), { statusCode: 503 });
  return { signatureHash: digest, submissionRef: uploaded.id, driveUrl: uploaded.webViewLink || '' };
}

export async function saveContractIdentityDocuments(deps, { sessionId, front, back }) {
  if (!deps.driveConfigured || !deps.driveRootFolderId) throw Object.assign(new Error('工程合約 Drive 尚未設定'), { statusCode: 503 });
  if (typeof deps.auditDrivePrivate !== 'function') throw Object.assign(new Error('工程合約 Drive 隱私稽核尚未設定'), { statusCode: 503 });
  const items = { front, back };
  for (const [side, item] of Object.entries(items)) {
    if (!Buffer.isBuffer(item?.bytes) || item.bytes.length < 500 || item.bytes.length > 3 * 1024 * 1024) {
      throw Object.assign(new Error(`身分證${side === 'front' ? '正面' : '反面'}圖片大小不合法`), { statusCode: 422 });
    }
    if (!['image/png', 'image/jpeg'].includes(item.contentType)) {
      throw Object.assign(new Error('身分證照片必須是 PNG 或 JPEG'), { statusCode: 415 });
    }
  }
  const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
  const evidence = await deps.ensureDriveFolder('簽署證據', root);
  const sessionFolder = await deps.ensureDriveFolder(safeSegment(sessionId, 'unknown-session'), evidence);
  const identityFolder = await deps.ensureDriveFolder('身分證件（機密）', sessionFolder);
  const folderPrivacy = await deps.auditDrivePrivate(identityFolder);
  if (folderPrivacy?.private !== true) throw Object.assign(new Error('身分證件資料夾不可公開分享'), { statusCode: 503 });
  const stored = {};
  for (const [side, item] of Object.entries(items)) {
    const hash = crypto.createHash('sha256').update(item.bytes).digest('hex');
    const extension = item.contentType === 'image/jpeg' ? 'jpg' : 'png';
    const uploaded = await deps.uploadToDrive(
      item.bytes,
      `identity-${side}-${hash.slice(0, 12)}.${extension}`,
      item.contentType,
      identityFolder,
    );
    if (!uploaded?.id) throw new Error('Drive 未回傳身分證照片檔案 ID');
    const privacy = await deps.auditDrivePrivate(uploaded.id);
    if (privacy?.private !== true) throw Object.assign(new Error('身分證照片不可公開分享'), { statusCode: 503 });
    stored[side] = {
      hash,
      ref: uploaded.id,
      contentType: item.contentType,
      byteSize: item.bytes.length,
      receivedAt: new Date().toISOString(),
    };
  }
  return stored;
}

function runtimeFailure(message, statusCode = 500, code = 'CONTRACT_DOCUMENT_FAILED') {
  return Object.assign(new Error(message), { statusCode, code });
}

function unwrap(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
    ? value.value : value;
}

function requiredSha256(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw runtimeFailure(`${label}雜湊不完整`, 500, 'CONTRACT_DOCUMENT_HASH_INVALID');
  return normalized;
}

function signingImage(buffer, expectedContentType) {
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const contentType = png ? 'image/png' : (jpeg ? 'image/jpeg' : '');
  if (!contentType || contentType !== String(expectedContentType || '').trim().toLowerCase()) {
    throw runtimeFailure('甲方簽名檔案格式不一致', 409, 'PARTY_A_SIGNATURE_CONTENT_MISMATCH');
  }
  return contentType;
}

async function renderPartyASignedPreview(deps, opened, original, options) {
  const state = options.signingState;
  const submission = state?.partyASubmission;
  if (!state || String(state.id || '') !== String(opened.sessionId || '') || !submission) {
    throw runtimeFailure('甲方簽署狀態不完整，暫時無法顯示已簽版本', 409, 'PARTY_A_SIGNING_STATE_MISMATCH');
  }
  const originalHash = requiredSha256(opened.documentHash, '原始簽發文件');
  if (requiredSha256(submission.documentHash, '甲方簽署文件') !== originalHash || original.sha256 !== originalHash) {
    throw runtimeFailure('甲方簽署的合約版本與原始文件不一致', 409, 'PARTY_A_DOCUMENT_VERSION_MISMATCH');
  }
  const signatureHash = requiredSha256(submission.signatureHash, '甲方簽名');
  const signatureRef = String(submission.submissionRef || '').trim();
  const signatureByteSize = Number(submission.signatureByteSize);
  if (!signatureRef || !Number.isSafeInteger(signatureByteSize) || signatureByteSize < 1 || signatureByteSize > 2 * 1024 * 1024) {
    throw runtimeFailure('甲方簽名證據不完整', 409, 'PARTY_A_SIGNATURE_EVIDENCE_INVALID');
  }
  const downloaded = await deps.downloadFromDrive(signatureRef, 2 * 1024 * 1024);
  const signatureBuffer = Buffer.isBuffer(downloaded) ? downloaded : downloaded?.buffer;
  if (!Buffer.isBuffer(signatureBuffer) || signatureBuffer.length !== signatureByteSize
      || crypto.createHash('sha256').update(signatureBuffer).digest('hex') !== signatureHash) {
    throw runtimeFailure('甲方簽名檔案與不可變證據不一致', 409, 'PARTY_A_SIGNATURE_HASH_MISMATCH');
  }
  const signatureContentType = signingImage(signatureBuffer, submission.signatureContentType);
  if (typeof deps.contractStore?.getSigningBundle !== 'function') {
    throw runtimeFailure('工程合約資料庫缺少簽署版本讀取功能', 503, 'CONTRACT_STORE_UNAVAILABLE');
  }
  const bundle = unwrap(await deps.contractStore.getSigningBundle(deps.tenant, opened.sessionId));
  if (!bundle?.contract || !bundle?.version || String(bundle.session?.externalSessionId || '') !== String(opened.sessionId || '')
      || String(bundle.version.id || '') !== String(bundle.session?.versionId || '')
      || requiredSha256(bundle.version.issuedPdfSha256, '資料庫簽發文件') !== originalHash) {
    throw runtimeFailure('甲方簽署流程與合約版本關聯不一致', 409, 'PARTY_A_SIGNING_BUNDLE_MISMATCH');
  }
  const partyA = partyAProfileContext(bundle.version);
  if (partyA.profileType !== 'individual') {
    throw runtimeFailure('只有個人甲方合約可產生甲方階段簽署版', 409, 'PARTY_A_PREVIEW_NOT_APPLICABLE');
  }
  const bodyExtractor = options.bodyExtractor || extractContractBodyForVersion;
  const artifactService = options.artifactService || createContractArtifactService(deps);
  const pdfComposer = options.pdfComposer || composeDraftBundle;
  const contractBody = await bodyExtractor(deps, bundle.version);
  const partyASigningAssets = await hydratePartyASigningAssets(deps, bundle.version);
  partyASigningAssets.signature = {
    mimeType: signatureContentType,
    base64: signatureBuffer.toString('base64'),
    sha256: signatureHash,
  };
  const bundleHash = requiredSha256(bundle.version.bundleSha256, '凍結合約');
  const partyASignedAt = String(submission.receivedAt || '').trim();
  if (!partyASignedAt || !Number.isFinite(Date.parse(partyASignedAt))) {
    throw runtimeFailure('甲方簽署時間不完整', 409, 'PARTY_A_SIGNED_TIME_INVALID');
  }
  const rendered = await artifactService.renderPdf('party_a_signed_preview_pdf', {
    contract: bundle.contract,
    version: bundle.version,
    contractBodyText: contractBody.text,
    contractBodyHtml: contractBody.html,
    immutable: true,
    bundleHash,
    documentHash: originalHash,
    partyASignerName: partyA.signerName,
    partyASigningAssets,
    times: { issuedAt: bundle.session?.issuedAt || bundle.version.issuedAt, partyASignedAt },
  }, `engineering-contract-party-a-preview:${deps.tenant?.key || 'engineering'}:${opened.sessionId}:${originalHash}:${signatureHash}`);
  const archives = typeof deps.contractStore.listLineConversationArchives === 'function'
    ? await deps.contractStore.listLineConversationArchives(deps.tenant, bundle.contract.id, Number(bundle.version.versionNo)) : [];
  const archiveAttachments = archives.map((row) => ({
    fileId: String(row.pdf_drive_file_id || ''), sha256: String(row.pdf_sha256 || ''),
    name: `V${row.version_no}-${row.stage === 'final_issue' ? '正式送簽前' : '草約送出前'}-LINE對話封存.pdf`,
    category: 'line_conversation_archive', mimeType: 'application/pdf',
  }));
  const buffer = archiveAttachments.length
    ? await pdfComposer(rendered.buffer, archiveAttachments, deps, [], bundle.contract, bundle.version.versionNo, { watermark: false })
    : rendered.buffer;
  return {
    buffer,
    contentType: 'application/pdf',
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    originalSha256: originalHash,
    viewKind: 'party_a_signed_preview_pdf',
  };
}

export async function loadContractPdf(deps, { documentRef, documentHash, sessionId, partyASigned }, options = {}) {
  if (typeof deps.downloadFromDrive !== 'function') throw Object.assign(new Error('工程合約 Drive 讀取功能尚未設定'), { statusCode: 503 });
  let fileId = String(documentRef || '').trim();
  const driveUrl = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,200})\/view(?:[?#].*)?$/i.exec(fileId);
  if (driveUrl) fileId = driveUrl[1];
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw Object.assign(new Error('工程合約文件識別碼不合法'), { statusCode: 500 });
  const downloaded = await deps.downloadFromDrive(fileId, 30 * 1024 * 1024);
  const buffer = downloaded?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw Object.assign(new Error('工程合約文件不是有效 PDF'), { statusCode: 502 });
  }
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (digest !== String(documentHash || '').trim().toLowerCase()) {
    throw Object.assign(new Error('工程合約文件雜湊驗證失敗'), { statusCode: 409 });
  }
  const original = { buffer, contentType: 'application/pdf', sha256: digest, viewKind: 'issued_pdf' };
  if (partyASigned === true) return renderPartyASignedPreview(deps, {
    documentRef, documentHash, sessionId, partyASigned,
  }, original, options);
  return original;
}

export const __test = { safeSegment, contractConfig, renderProxyMode, trustedProxyOptions };

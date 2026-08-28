import crypto from 'node:crypto';
import { BlockList, isIP } from 'node:net';
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

export async function loadContractPdf(deps, { documentRef, documentHash }) {
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
  return { buffer, contentType: 'application/pdf', sha256: digest };
}

export const __test = { safeSegment, contractConfig, renderProxyMode, trustedProxyOptions };

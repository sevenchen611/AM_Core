import crypto from 'node:crypto';
import { createContractSigningService } from './contract-signing.js';

function contractConfig(deps) {
  return deps.tenant?.config?.contracts || {};
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

export function createRuntimeSigningService(deps, storageContext = {}) {
  if (!deps.contractStore?.configured(deps.tenant)) throw Object.assign(new Error('合約證據資料庫尚未設定'), { statusCode: 503 });
  const config = contractConfig(deps);
  if (config.signingEnabled !== true) throw Object.assign(new Error('工程合約電子簽署尚未啟用'), { statusCode: 503 });
  if (!config.liffId) throw Object.assign(new Error('工程合約 LIFF 尚未設定'), { statusCode: 503 });
  if (!config.tokenPepper || Buffer.byteLength(config.tokenPepper, 'utf8') < 32) {
    throw Object.assign(new Error('工程合約簽署權杖雜湊金鑰尚未設定'), { statusCode: 503 });
  }
  if (!deps.publicBaseUrl) throw Object.assign(new Error('工程合約公開網址尚未設定'), { statusCode: 503 });
  const trustedProxyIps = new Set(config.trustedProxyIps || []);
  return createContractSigningService({
    storage: deps.contractStore.signingStorage(deps.tenant, storageContext),
    line: createContractLineAdapter(deps),
    baseUrl: deps.publicBaseUrl,
    signingPath: '/contract-sign',
    tokenTtlMs: Number(config.tokenTtlHours || 168) * 60 * 60 * 1000,
    tokenPepper: config.tokenPepper,
    isTrustedProxy: (ip) => trustedProxyIps.has(ip),
    trustedClientIpHeaders: config.trustedClientIpHeaders || [],
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
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
  const uploaded = await deps.uploadToDrive(buffer, `signature-${digest.slice(0, 12)}.${extension}`, contentType, sessionFolder);
  if (!uploaded?.id) throw new Error('Drive 未回傳簽名檔案 ID');
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

export const __test = { safeSegment, contractConfig };

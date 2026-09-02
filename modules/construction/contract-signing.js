import {
  createHash,
  createHmac,
  randomBytes as cryptoRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { isIP } from 'node:net';

export const CONTRACT_SIGNING_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ACTIVE_TOKEN_STATUSES = new Set(['issued', 'sent', 'opened']);
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_CAS_ATTEMPTS = 8;

export class ContractSigningError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ContractSigningError';
    this.code = code;
    this.status = status;
  }
}

function signingError(code, message, status) {
  return new ContractSigningError(code, message, status);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function hashSigningToken(token, pepper) {
  const normalized = String(token || '').trim();
  if (!normalized) throw signingError('TOKEN_REQUIRED', '簽署權杖不可為空。', 400);
  const secret = String(pepper || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw signingError('TOKEN_PEPPER_REQUIRED', '簽署權杖雜湊金鑰未設定或長度不足。', 500);
  }
  return createHmac('sha256', secret).update(normalized, 'utf8').digest('hex');
}

function safeHashEqual(left, right) {
  if (!HASH_PATTERN.test(String(left || '')) || !HASH_PATTERN.test(String(right || ''))) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function normalizeHash(value, fieldName) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw signingError('INVALID_HASH', `${fieldName} 必須是 SHA-256 十六進位雜湊。`, 400);
  }
  return normalized;
}

function requiredText(value, fieldName, maxLength = 240) {
  const normalized = String(value || '').trim();
  if (!normalized) throw signingError('FIELD_REQUIRED', `${fieldName} 不可為空。`, 400);
  if (normalized.length > maxLength) throw signingError('FIELD_TOO_LONG', `${fieldName} 過長。`, 400);
  return normalized;
}

function optionalText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeIdentityDocuments(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {};
  for (const side of ['front', 'back']) {
    const item = source[side] && typeof source[side] === 'object' ? source[side] : {};
    const receivedAt = requiredText(item.receivedAt, `identityDocuments.${side}.receivedAt`, 80);
    if (!Number.isFinite(Date.parse(receivedAt))) {
      throw signingError('IDENTITY_DOCUMENT_TIME_INVALID', '身分證照片收件時間格式不正確。', 400);
    }
    const contentType = requiredText(item.contentType, `identityDocuments.${side}.contentType`, 40);
    if (!['image/png', 'image/jpeg'].includes(contentType)) {
      throw signingError('IDENTITY_DOCUMENT_TYPE_INVALID', '身分證照片格式不正確。', 400);
    }
    const byteSize = Number(item.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 500 || byteSize > 3 * 1024 * 1024) {
      throw signingError('IDENTITY_DOCUMENT_SIZE_INVALID', '身分證照片大小不正確。', 400);
    }
    normalized[side] = {
      hash: normalizeHash(item.hash, `identityDocuments.${side}.hash`),
      ref: requiredText(item.ref, `identityDocuments.${side}.ref`, 1000),
      contentType,
      byteSize,
      receivedAt: new Date(receivedAt).toISOString(),
    };
  }
  return normalized;
}

function normalizeCounterpartyDetails(value) {
  const source = value && typeof value === 'object' ? value : {};
  const name = requiredText(source.name, 'counterpartyDetails.name', 100);
  const identityNumber = requiredText(source.identityNumber, 'counterpartyDetails.identityNumber', 30)
    .toUpperCase().replace(/\s+/g, '');
  const address = requiredText(source.address, 'counterpartyDetails.address', 300);
  if (!/^[A-Z0-9-]{6,30}$/.test(identityNumber)) {
    throw signingError('COUNTERPARTY_IDENTITY_NUMBER_INVALID', '乙方身分證字號格式不正確。', 400);
  }
  return { name, identityNumber, address };
}

function dateFromClock(clock) {
  const raw = typeof clock === 'function' ? clock() : clock?.now?.();
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('contract signing clock returned an invalid date');
  return date;
}

function randomBuffer(randomBytes, size) {
  const value = randomBytes(size);
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length < size) throw new Error(`contract signing random source returned fewer than ${size} bytes`);
  return buffer.subarray(0, size);
}

function randomBase64Url(randomBytes, size) {
  return randomBuffer(randomBytes, size).toString('base64url');
}

function eventId(randomBytes) {
  return `cse_${randomBase64Url(randomBytes, 12)}`;
}

function eventKeyHash(type, idempotencyKey) {
  return sha256(`${type}:${String(idempotencyKey || '')}`);
}

function findIdempotentEvent(session, type, idempotencyKey) {
  const expected = eventKeyHash(type, idempotencyKey);
  return (session.events || []).find((event) => event.type === type && event.idempotencyKeyHash === expected) || null;
}

function appendEvent(session, {
  type,
  at,
  actorType,
  actorId = '',
  idempotencyKey,
  ip = '',
  userAgent = '',
  metadata = {},
  randomBytes,
}) {
  const existing = findIdempotentEvent(session, type, idempotencyKey);
  if (existing) return { event: existing, inserted: false };
  const event = {
    id: eventId(randomBytes),
    type,
    at,
    actorType,
    actorId: optionalText(actorId, 180),
    idempotencyKeyHash: eventKeyHash(type, idempotencyKey),
    ip: optionalText(ip, 80),
    userAgent: optionalText(userAgent, 400),
    metadata: clone(metadata),
  };
  session.events = Array.isArray(session.events) ? session.events : [];
  session.events.push(event);
  return { event, inserted: true };
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.join(',').trim();
    return String(value || '').trim();
  }
  return '';
}

function normalizeIp(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end > 0) text = text.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.replace(/:\d+$/, '');
  }
  text = text.replace(/%.+$/, '');
  if (text.toLowerCase().startsWith('::ffff:') && isIP(text.slice(7)) === 4) text = text.slice(7);
  return isIP(text) ? text : '';
}

/**
 * Resolve a client IP without blindly trusting forwarding headers.
 *
 * Forwarding headers are ignored unless the immediate socket peer is accepted
 * by `isTrustedProxy`. Provider-specific headers (for example
 * `cf-connecting-ip`) are only considered when explicitly listed in
 * `trustedClientIpHeaders`; the caller must only list headers its trusted proxy
 * overwrites rather than appends.
 */
export function getTrustedClientIp(requestMeta = {}, options = {}) {
  const remoteAddress = normalizeIp(requestMeta.remoteAddress || requestMeta.socket?.remoteAddress);
  const isTrustedProxy = typeof options.isTrustedProxy === 'function' ? options.isTrustedProxy : () => false;
  if (!remoteAddress || !isTrustedProxy(remoteAddress)) return remoteAddress;

  for (const headerName of options.trustedClientIpHeaders || []) {
    const candidate = normalizeIp(headerValue(requestMeta.headers, headerName).split(',')[0]);
    if (candidate) return candidate;
  }

  // Some hosting providers append to X-Forwarded-For instead of replacing a
  // caller-supplied value. Provider modes that rely on an overwritten, single-
  // value header must disable this compatibility fallback explicitly.
  if (options.allowForwardedForFallback === false) return remoteAddress;

  const forwarded = headerValue(requestMeta.headers, 'x-forwarded-for')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);
  const chain = [...forwarded, remoteAddress];
  while (chain.length && isTrustedProxy(chain.at(-1))) chain.pop();
  return chain.at(-1) || remoteAddress;
}

export function contractSigningSecurityHeaders(options = {}) {
  const extraConnect = Array.isArray(options.connectSources) ? options.connectSources : [];
  const connectSources = ["'self'", ...extraConnect.filter((source) => /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(String(source)))];
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, private',
    Pragma: 'no-cache',
    Expires: '0',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src ${connectSources.join(' ')}`,
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  };
}

export function buildProtectedSigningLink(baseUrl, signingPath, token) {
  const base = new URL(requiredText(baseUrl, 'baseUrl', 1000));
  const local = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !local) {
    throw signingError('HTTPS_REQUIRED', '簽署連結必須使用 HTTPS。', 500);
  }
  const url = new URL(signingPath || '/engineering/contracts/sign', base);
  // The fragment is not sent in HTTP requests or Referer headers. A future
  // route should let the page exchange it after LIFF identity verification.
  url.hash = `token=${encodeURIComponent(requiredText(token, 'token', 500))}`;
  return url.toString();
}

function validateStorage(storage) {
  for (const method of ['create', 'getById', 'getByTokenHash', 'compareAndSwap']) {
    if (typeof storage?.[method] !== 'function') throw new Error(`contract signing storage.${method} is required`);
  }
}

function validateLineAdapter(line) {
  for (const method of ['pushGroup', 'verifyLiffIdentity', 'isGroupMember']) {
    if (typeof line?.[method] !== 'function') throw new Error(`contract signing line.${method} is required`);
  }
}

export function createMemoryContractSigningStorage(initialSessions = []) {
  const byId = new Map();
  const byTokenHash = new Map();
  for (const source of initialSessions) {
    const session = clone(source);
    byId.set(session.id, session);
    byTokenHash.set(session.tokenHash, session.id);
  }
  return {
    async create(source) {
      const session = clone(source);
      if (byId.has(session.id) || byTokenHash.has(session.tokenHash)) return false;
      byId.set(session.id, session);
      byTokenHash.set(session.tokenHash, session.id);
      return true;
    },
    async getById(id) {
      return clone(byId.get(String(id)) || null);
    },
    async getByTokenHash(tokenHash) {
      const id = byTokenHash.get(String(tokenHash));
      return clone(id ? byId.get(id) : null);
    },
    async compareAndSwap(id, expectedVersion, source) {
      const current = byId.get(String(id));
      if (!current || current.version !== expectedVersion) return false;
      const next = clone(source);
      byId.set(String(id), next);
      if (current.tokenHash !== next.tokenHash) byTokenHash.delete(current.tokenHash);
      byTokenHash.set(next.tokenHash, String(id));
      return true;
    },
    async dump() {
      return [...byId.values()].map(clone);
    },
  };
}

export function createContractSigningService(options = {}) {
  const storage = options.storage;
  const line = options.line;
  validateStorage(storage);
  validateLineAdapter(line);
  const clock = options.clock || (() => new Date());
  const randomBytes = options.randomBytes || cryptoRandomBytes;
  const tokenTtlMs = Number(options.tokenTtlMs || CONTRACT_SIGNING_TOKEN_TTL_MS);
  if (!Number.isFinite(tokenTtlMs) || tokenTtlMs <= 0) throw new Error('contract signing tokenTtlMs must be positive');
  const baseUrl = requiredText(options.baseUrl, 'baseUrl', 1000);
  const tokenPepper = requiredText(options.tokenPepper, 'tokenPepper', 4096);
  if (Buffer.byteLength(tokenPepper, 'utf8') < 32) {
    throw new Error('contract signing tokenPepper must contain at least 32 bytes');
  }
  const consentVersion = requiredText(options.consentVersion || 'engineering-contract-consent-v3-party-details', 'consentVersion', 120);
  const signingPath = options.signingPath || '/engineering/contracts/sign';
  const proxyOptions = {
    isTrustedProxy: options.isTrustedProxy,
    trustedClientIpHeaders: options.trustedClientIpHeaders || [],
    allowForwardedForFallback: options.allowForwardedForFallback,
  };

  const nowDate = () => dateFromClock(clock);
  const nowIso = () => nowDate().toISOString();
  const requestEvidence = (requestMeta = {}) => ({
    ip: getTrustedClientIp(requestMeta, proxyOptions),
    userAgent: headerValue(requestMeta.headers, 'user-agent').slice(0, 400),
  });

  async function mutate(sessionId, mutation) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await storage.getById(sessionId);
      if (!current) throw signingError('SIGNING_NOT_FOUND', '找不到簽署流程。', 404);
      const draft = clone(current);
      const decision = await mutation(draft, current);
      if (decision?.noWrite) return { session: current, result: decision.result, changed: false };
      draft.version = Number(current.version || 0) + 1;
      draft.updatedAt = nowIso();
      if (await storage.compareAndSwap(sessionId, Number(current.version || 0), draft)) {
        return { session: draft, result: decision?.result, changed: true };
      }
    }
    throw signingError('CONCURRENT_UPDATE', '簽署狀態同時被更新，請重試。', 409);
  }

  async function expireSession(session) {
    if (!ACTIVE_TOKEN_STATUSES.has(session.status)) return session;
    if (Date.parse(session.expiresAt) > nowDate().getTime()) return session;
    const changed = await mutate(session.id, (draft) => {
      if (!ACTIVE_TOKEN_STATUSES.has(draft.status) || Date.parse(draft.expiresAt) > nowDate().getTime()) {
        return { noWrite: true };
      }
      const at = nowIso();
      draft.status = 'expired';
      draft.expiredAt = at;
      appendEvent(draft, {
        type: 'expired', at, actorType: 'system', idempotencyKey: `expired:${draft.id}`,
        metadata: { reason: 'token_ttl_elapsed' }, randomBytes,
      });
      return {};
    });
    return changed.session;
  }

  async function loadByToken(token) {
    const tokenHash = hashSigningToken(token, tokenPepper);
    let session = await storage.getByTokenHash(tokenHash);
    if (!session || !safeHashEqual(session.tokenHash, tokenHash)) {
      throw signingError('TOKEN_INVALID', '簽署連結無效。', 404);
    }
    session = await expireSession(session);
    if (session.status === 'expired') throw signingError('TOKEN_EXPIRED', '簽署連結已過期。', 410);
    if (session.status === 'revoked') throw signingError('TOKEN_REVOKED', '簽署連結已撤銷。', 410);
    return session;
  }

  async function authenticateGroupMember(session, liffCredential) {
    const credential = requiredText(liffCredential, 'LIFF credential', 5000);
    const identity = await line.verifyLiffIdentity({ credential, sessionId: session.id });
    if (!identity || identity.verified !== true || !identity.userId) {
      throw signingError('LIFF_IDENTITY_INVALID', 'LINE 身分驗證失敗。', 401);
    }
    const membership = await line.isGroupMember({
      groupId: session.lineGroupId,
      userId: identity.userId,
      sessionId: session.id,
    });
    const isMember = membership === true || membership?.member === true;
    if (!isMember) throw signingError('GROUP_MEMBERSHIP_REQUIRED', '目前 LINE 帳號不在此工程 LINE 群組。', 403);
    return {
      userId: String(identity.userId),
      canSign: String(identity.userId) === session.signerLineUserId,
      canInspectSigning: true,
    };
  }

  async function authenticateSigner(session, liffCredential) {
    const identity = await authenticateGroupMember(session, liffCredential);
    if (!identity.canSign) {
      throw signingError('SIGNER_MISMATCH', '目前 LINE 帳號不是指定簽署人，只能檢視合約。', 403);
    }
    return identity;
  }

  function publicSigningView(session, idempotent = false, authorization = {}) {
    const canSign = authorization.canSign === true;
    const canInspectSigning = authorization.canInspectSigning === true;
    return {
      sessionId: session.id,
      contractId: session.contractId,
      projectId: session.projectId,
      documentRef: session.documentRef,
      documentHash: session.documentHash,
      status: session.status,
      expiresAt: session.expiresAt,
      idempotent,
      canSign,
      canInspectSigning,
      accessMode: canSign ? 'signer' : canInspectSigning ? 'signer_inspection_read_only' : 'group_member_read_only',
    };
  }

  function fixedGroupMessage(kind, protectedLink = '') {
    if (kind === 'invite') {
      return `工程合約簽署邀請已建立。此工程 LINE 群組的成員完成 LINE 身分驗證後皆可檢視；只有指定簽署人可以簽署：\n${protectedLink}\n本訊息僅表示系統已提出簽署邀請，不代表對方已讀或平台已送達。`;
    }
    if (kind === 'signed') return '工程合約簽署狀態：指定簽署人已提交資料，待工程 AM 內部確認。';
    if (kind === 'confirmed') return '工程合約簽署狀態：內部已確認，待完成歸檔。請至工程 AM 權限頁查看詳細資料。';
    if (kind === 'completed') return '工程合約簽署狀態：流程已完成。請至工程 AM 權限頁查看已歸檔合約。';
    if (kind === 'revoked') return '工程合約簽署狀態：原簽署連結已撤銷；如仍需簽署，請由工程 AM 重新簽發。';
    throw new Error(`unknown group message kind: ${kind}`);
  }

  async function pushStatus(session, kind) {
    const message = fixedGroupMessage(kind);
    try {
      const result = await line.pushGroup({
        groupId: session.lineGroupId,
        message,
        idempotencyKey: sha256(`contract-signing-status:${kind}:${session.id}`),
        contentClass: 'status_only_no_sensitive_artifacts',
      });
      return { accepted: result?.accepted === true, error: result?.accepted === true ? '' : 'provider_not_accepted' };
    } catch (error) {
      return { accepted: false, error: optionalText(error?.message || error, 300) };
    }
  }

  async function issueSigningRequest(input = {}) {
    const issuedAt = nowIso();
    const durableKey = optionalText(input.idempotencyKey, 500);
    // A durable outbox may retry after a process restart. Derive the opaque
    // token from the high-entropy pepper and the server-owned outbox key so the
    // same invitation can be reconstructed without ever persisting raw token
    // material. Calls without an idempotency key retain fully random behavior.
    const token = durableKey
      ? createHmac('sha256', tokenPepper).update(`contract-signing-token:${durableKey}`, 'utf8').digest('base64url')
      : randomBase64Url(randomBytes, 32);
    const tokenHash = hashSigningToken(token, tokenPepper);
    const id = durableKey
      ? `cs_${createHmac('sha256', tokenPepper).update(`contract-signing-session:${durableKey}`, 'utf8').digest('base64url').slice(0, 24)}`
      : `cs_${randomBase64Url(randomBytes, 18)}`;
    const session = {
      id,
      version: 1,
      status: 'issued',
      projectId: requiredText(input.projectId, 'projectId'),
      contractId: requiredText(input.contractId, 'contractId'),
      documentRef: requiredText(input.documentRef, 'documentRef', 1000),
      documentHash: normalizeHash(input.documentHash, 'documentHash'),
      lineGroupId: requiredText(input.lineGroupId, 'lineGroupId'),
      signerLineUserId: requiredText(input.signerLineUserId, 'signerLineUserId'),
      tokenHash,
      issuedAt,
      expiresAt: new Date(new Date(issuedAt).getTime() + tokenTtlMs).toISOString(),
      updatedAt: issuedAt,
      events: [],
      submission: null,
      confirmation: null,
      completion: null,
      revocation: null,
    };
    appendEvent(session, {
      type: 'issued', at: issuedAt, actorType: 'admin', actorId: input.actorId,
      idempotencyKey: `issued:${id}`, metadata: { channel: 'line_group' }, randomBytes,
    });
    if (!await storage.create(session)) {
      if (!durableKey) throw signingError('SIGNING_COLLISION', '簽署識別碼發生衝突，請重試。', 409);
      const existing = await storage.getById(id);
      if (!existing
          || !safeHashEqual(existing.tokenHash, tokenHash)
          || existing.projectId !== session.projectId
          || existing.contractId !== session.contractId
          || existing.documentRef !== session.documentRef
          || !safeHashEqual(existing.documentHash, session.documentHash)
          || existing.lineGroupId !== session.lineGroupId
          || existing.signerLineUserId !== session.signerLineUserId) {
        throw signingError('SIGNING_COLLISION', '簽署識別碼發生衝突，請重試。', 409);
      }
      return {
        sessionId: id,
        token,
        protectedLink: buildProtectedSigningLink(baseUrl, signingPath, token),
        expiresAt: existing.expiresAt,
        idempotent: true,
      };
    }
    return {
      sessionId: id,
      token,
      protectedLink: buildProtectedSigningLink(baseUrl, signingPath, token),
      expiresAt: session.expiresAt,
    };
  }

  async function sendInvitation({ sessionId, token } = {}) {
    const id = requiredText(sessionId, 'sessionId');
    const rawToken = requiredText(token, 'token', 500);
    let session = await storage.getById(id);
    if (!session) throw signingError('SIGNING_NOT_FOUND', '找不到簽署流程。', 404);
    if (!safeHashEqual(session.tokenHash, hashSigningToken(rawToken, tokenPepper))) throw signingError('TOKEN_INVALID', '簽署權杖不符。', 404);
    session = await expireSession(session);
    if (session.status === 'expired') throw signingError('TOKEN_EXPIRED', '簽署連結已過期。', 410);
    if (session.status === 'revoked') throw signingError('TOKEN_REVOKED', '簽署連結已撤銷。', 410);
    const existing = findIdempotentEvent(session, 'sent', `sent:${id}`);
    const protectedLink = buildProtectedSigningLink(baseUrl, signingPath, rawToken);
    if (existing) return { ok: true, idempotent: true, protectedLink, sentAt: existing.at };
    if (!ACTIVE_TOKEN_STATUSES.has(session.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);

    const providerResult = await line.pushGroup({
      groupId: session.lineGroupId,
      message: fixedGroupMessage('invite', protectedLink),
      idempotencyKey: sha256(`contract-signing-invite:${id}`),
      contentClass: 'status_and_protected_link_only',
    });
    if (providerResult?.accepted !== true) {
      throw signingError('LINE_SEND_NOT_ACCEPTED', 'LINE 未接受簽署邀請，尚未記錄為已發送。', 502);
    }
    const sentAt = nowIso();
    const updated = await mutate(id, (draft) => {
      const duplicate = findIdempotentEvent(draft, 'sent', `sent:${id}`);
      if (duplicate) return { noWrite: true, result: { sentAt: duplicate.at, idempotent: true } };
      if (!ACTIVE_TOKEN_STATUSES.has(draft.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);
      draft.status = draft.status === 'issued' ? 'sent' : draft.status;
      appendEvent(draft, {
        type: 'sent', at: sentAt, actorType: 'system', idempotencyKey: `sent:${id}`,
        metadata: {
          channel: 'line_group',
          providerAccepted: true,
          providerMessageId: optionalText(providerResult.messageId, 240),
          // Deliberately no `delivered` or `read` flag.
        },
        randomBytes,
      });
      const receipt = providerResult.deliveryReceipt;
      if (receipt?.acknowledged === true && receipt.receiptId) {
        appendEvent(draft, {
          type: 'delivery_ack',
          at: receipt.at ? new Date(receipt.at).toISOString() : sentAt,
          actorType: 'provider',
          actorId: 'line',
          idempotencyKey: `delivery-ack:${receipt.receiptId}`,
          metadata: { providerReceiptId: optionalText(receipt.receiptId, 240) },
          randomBytes,
        });
      }
      return { result: { sentAt, idempotent: false } };
    });
    return { ok: true, protectedLink, ...updated.result };
  }

  async function issueAndSend(input = {}) {
    const issued = await issueSigningRequest(input);
    try {
      const sent = await sendInvitation({ sessionId: issued.sessionId, token: issued.token });
      return { ...issued, sentAt: sent.sentAt, sent: true };
    } catch (failure) {
      // Raw tokens are never persisted. If LINE does not accept the invitation,
      // revoke this unusable session without posting a misleading group status;
      // an administrator can safely issue a fresh token later.
      await mutate(issued.sessionId, (draft) => {
        if (!ACTIVE_TOKEN_STATUSES.has(draft.status)) return { noWrite: true };
        const at = nowIso();
        draft.status = 'revoked';
        draft.tokenRevokedAt = at;
        draft.revocation = { revokedAt: at, actorId: input.actorId || '', reason: 'line_send_failed' };
        appendEvent(draft, {
          type: 'revoked', at, actorType: 'system', actorId: 'engineering-am',
          idempotencyKey: `line-send-failed:${issued.sessionId}`,
          metadata: { reason: 'line_send_failed' }, randomBytes,
        });
        return {};
      }).catch(() => {});
      throw failure;
    }
  }

  async function recordProviderDeliveryAck({ sessionId, receipt } = {}) {
    const id = requiredText(sessionId, 'sessionId');
    if (receipt?.acknowledged !== true || !receipt.receiptId) {
      throw signingError('PROVIDER_RECEIPT_REQUIRED', '只有可驗證的服務商回執才能記錄 delivery_ack。', 400);
    }
    const at = receipt.at ? new Date(receipt.at) : nowDate();
    if (Number.isNaN(at.getTime())) throw signingError('INVALID_RECEIPT_TIME', '服務商回執時間格式不正確。', 400);
    const result = await mutate(id, (draft) => {
      const key = `delivery-ack:${receipt.receiptId}`;
      const existing = findIdempotentEvent(draft, 'delivery_ack', key);
      if (existing) return { noWrite: true, result: { idempotent: true, at: existing.at } };
      if (!(draft.events || []).some((event) => event.type === 'sent')) {
        throw signingError('NOT_SENT', '尚未有服務商接受發送的紀錄。', 409);
      }
      appendEvent(draft, {
        type: 'delivery_ack', at: at.toISOString(), actorType: 'provider', actorId: 'line',
        idempotencyKey: key, metadata: { providerReceiptId: optionalText(receipt.receiptId, 240) }, randomBytes,
      });
      return { result: { idempotent: false, at: at.toISOString() } };
    });
    return { ok: true, ...result.result };
  }

  async function openSigningRequest({ token, liffCredential, requestMeta } = {}) {
    let session = await loadByToken(token);
    const identity = await authenticateGroupMember(session, liffCredential);
    if (!ACTIVE_TOKEN_STATUSES.has(session.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);
    if (!(session.events || []).some((event) => event.type === 'sent')) {
      throw signingError('INVITATION_NOT_SENT', '簽署邀請尚未由 LINE 群組發出。', 409);
    }
    // A verified member of the bound LINE group may inspect the exact frozen
    // PDF, but must not advance signer state or create signer-open evidence.
    if (!identity.canSign) return publicSigningView(session, true, identity);
    const evidence = requestEvidence(requestMeta);
    const opened = await mutate(session.id, (draft) => {
      const existing = (draft.events || []).find((event) => event.type === 'first_opened');
      if (existing) return { noWrite: true, result: { idempotent: true } };
      if (!ACTIVE_TOKEN_STATUSES.has(draft.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);
      const at = nowIso();
      draft.status = 'opened';
      draft.firstOpenedAt = at;
      appendEvent(draft, {
        type: 'first_opened', at, actorType: 'signer', actorId: identity.userId,
        idempotencyKey: `first-opened:${draft.id}`, ip: evidence.ip, userAgent: evidence.userAgent,
        metadata: { identitySource: 'verified_liff', membershipVerified: true }, randomBytes,
      });
      return { result: { idempotent: false } };
    });
    session = opened.session;
    return publicSigningView(session, opened.result?.idempotent === true, identity);
  }

  async function submitSignature(input = {}) {
    let session = await loadByToken(input.token);
    const identity = await authenticateSigner(session, input.liffCredential);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    const idempotencyHash = eventKeyHash('submission_received', idempotencyKey);
    if (session.status === 'signed') {
      if (session.submission?.idempotencyKeyHash === idempotencyHash) {
        return { ok: true, sessionId: session.id, status: 'signed', idempotent: true };
      }
      throw signingError('TOKEN_REPLAYED', '簽署權杖已完成提交，不可重複使用。', 409);
    }
    if (!ACTIVE_TOKEN_STATUSES.has(session.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);
    if (!(session.events || []).some((event) => event.type === 'first_opened')) {
      throw signingError('SIGNING_NOT_OPENED', '請先完成 LINE 身分驗證並開啟合約。', 409);
    }
    const documentHash = normalizeHash(input.documentHash, 'documentHash');
    if (!safeHashEqual(documentHash, session.documentHash)) {
      throw signingError('DOCUMENT_VERSION_MISMATCH', '合約版本已改變，請重新開啟簽署連結。', 409);
    }
    if (input.reviewAcknowledged !== true) {
      throw signingError('REVIEW_ACKNOWLEDGEMENT_REQUIRED', '請先開啟並詳閱合約文件。', 400);
    }
    const signatureHash = normalizeHash(input.signatureHash, 'signatureHash');
    const submissionRef = requiredText(input.submissionRef, 'submissionRef', 1000);
    const counterpartyDetails = normalizeCounterpartyDetails(input.counterpartyDetails);
    const identityDocuments = normalizeIdentityDocuments(input.identityDocuments);
    const evidence = requestEvidence(input.requestMeta);
    const submitted = await mutate(session.id, (draft) => {
      if (draft.status === 'signed') {
        if (draft.submission?.idempotencyKeyHash === idempotencyHash) {
          return { noWrite: true, result: { idempotent: true } };
        }
        throw signingError('TOKEN_REPLAYED', '簽署權杖已完成提交，不可重複使用。', 409);
      }
      if (!ACTIVE_TOKEN_STATUSES.has(draft.status)) throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409);
      const at = nowIso();
      draft.status = 'signed';
      draft.tokenConsumedAt = at;
      draft.submission = {
        documentHash,
        signatureHash,
        submissionRef,
        counterpartyDetails,
        identityDocuments,
        consentVersion,
        reviewAcknowledged: true,
        idempotencyKeyHash: idempotencyHash,
        receivedAt: at,
      };
      appendEvent(draft, {
        type: 'signed', at, actorType: 'signer', actorId: identity.userId,
        idempotencyKey: `signed:${idempotencyKey}`, ip: evidence.ip, userAgent: evidence.userAgent,
        metadata: {
          identitySource: 'verified_liff', membershipVerified: true, specifiedUserMatched: true,
          reviewAcknowledged: true, documentHash, signatureHash, consentVersion,
          counterpartyName: counterpartyDetails.name,
          identityDocumentHashes: { front: identityDocuments.front.hash, back: identityDocuments.back.hash },
          identityDocumentsReceivedAt: { front: identityDocuments.front.receivedAt, back: identityDocuments.back.receivedAt },
        }, randomBytes,
      });
      appendEvent(draft, {
        type: 'submission_received', at, actorType: 'system', actorId: 'engineering-am',
        idempotencyKey, ip: evidence.ip, userAgent: evidence.userAgent,
        metadata: { documentHash, signatureHash, submissionRef, counterpartyDetails, identityDocuments, consentVersion, reviewAcknowledged: true }, randomBytes,
      });
      return { result: { idempotent: false } };
    });
    const notification = submitted.changed ? await pushStatus(submitted.session, 'signed') : { accepted: true, error: '' };
    return {
      ok: true,
      sessionId: submitted.session.id,
      status: submitted.session.status,
      idempotent: submitted.result?.idempotent === true,
      groupNotificationAccepted: notification.accepted,
      groupNotificationError: notification.error,
    };
  }

  async function confirmSubmission(input = {}) {
    const id = requiredText(input.sessionId, 'sessionId');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    const actorId = requiredText(input.actorId, 'actorId');
    const evidence = requestEvidence(input.requestMeta);
    const confirmed = await mutate(id, (draft) => {
      const existing = findIdempotentEvent(draft, 'confirmed', idempotencyKey);
      if (existing) return { noWrite: true, result: { idempotent: true } };
      if (draft.status !== 'signed' || !(draft.events || []).some((event) => event.type === 'submission_received')) {
        throw signingError('SUBMISSION_NOT_READY', '簽署資料尚未完整提交，無法確認。', 409);
      }
      const at = nowIso();
      draft.status = 'confirmed';
      draft.confirmation = { confirmedAt: at, actorId, idempotencyKeyHash: eventKeyHash('confirmed', idempotencyKey) };
      appendEvent(draft, {
        type: 'confirmed', at, actorType: 'admin', actorId, idempotencyKey,
        ip: evidence.ip, userAgent: evidence.userAgent,
        metadata: { submissionRef: draft.submission.submissionRef }, randomBytes,
      });
      return { result: { idempotent: false } };
    });
    const notification = confirmed.changed ? await pushStatus(confirmed.session, 'confirmed') : { accepted: true, error: '' };
    return {
      ok: true, sessionId: id, status: confirmed.session.status,
      idempotent: confirmed.result?.idempotent === true,
      groupNotificationAccepted: notification.accepted,
      groupNotificationError: notification.error,
    };
  }

  async function completeSigning(input = {}) {
    const id = requiredText(input.sessionId, 'sessionId');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    const actorId = requiredText(input.actorId, 'actorId');
    const finalArtifactHash = normalizeHash(input.finalArtifactHash, 'finalArtifactHash');
    const finalArtifactRef = requiredText(input.finalArtifactRef, 'finalArtifactRef', 1000);
    const evidence = requestEvidence(input.requestMeta);
    const completed = await mutate(id, (draft) => {
      const existing = findIdempotentEvent(draft, 'completed', idempotencyKey);
      if (existing) return { noWrite: true, result: { idempotent: true } };
      if (draft.status !== 'confirmed') throw signingError('CONFIRMATION_REQUIRED', '必須先確認簽署資料才能完成歸檔。', 409);
      const at = nowIso();
      draft.status = 'completed';
      draft.completion = {
        completedAt: at,
        actorId,
        finalArtifactHash,
        finalArtifactRef,
        idempotencyKeyHash: eventKeyHash('completed', idempotencyKey),
      };
      appendEvent(draft, {
        type: 'completed', at, actorType: 'admin', actorId, idempotencyKey,
        ip: evidence.ip, userAgent: evidence.userAgent,
        metadata: { finalArtifactHash, finalArtifactRef }, randomBytes,
      });
      return { result: { idempotent: false } };
    });
    const notification = completed.changed ? await pushStatus(completed.session, 'completed') : { accepted: true, error: '' };
    return {
      ok: true, sessionId: id, status: completed.session.status,
      idempotent: completed.result?.idempotent === true,
      groupNotificationAccepted: notification.accepted,
      groupNotificationError: notification.error,
    };
  }

  async function revokeSigningToken(input = {}) {
    const id = requiredText(input.sessionId, 'sessionId');
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    const actorId = requiredText(input.actorId, 'actorId');
    const reason = optionalText(input.reason || 'manual_revoke', 500);
    const evidence = requestEvidence(input.requestMeta);
    const revoked = await mutate(id, (draft) => {
      const existing = findIdempotentEvent(draft, 'revoked', idempotencyKey);
      if (existing) return { noWrite: true, result: { idempotent: true } };
      if (draft.status === 'revoked') throw signingError('TOKEN_REVOKED', '簽署連結已撤銷。', 410);
      if (!ACTIVE_TOKEN_STATUSES.has(draft.status)) {
        throw signingError('TOKEN_ALREADY_USED', '簽署權杖已使用，不能再撤銷。', 409);
      }
      const at = nowIso();
      draft.status = 'revoked';
      draft.tokenRevokedAt = at;
      draft.revocation = { revokedAt: at, actorId, reason, idempotencyKeyHash: eventKeyHash('revoked', idempotencyKey) };
      appendEvent(draft, {
        type: 'revoked', at, actorType: 'admin', actorId, idempotencyKey,
        ip: evidence.ip, userAgent: evidence.userAgent, metadata: { reason }, randomBytes,
      });
      return { result: { idempotent: false } };
    });
    const notification = revoked.changed ? await pushStatus(revoked.session, 'revoked') : { accepted: true, error: '' };
    return {
      ok: true, sessionId: id, status: revoked.session.status,
      idempotent: revoked.result?.idempotent === true,
      groupNotificationAccepted: notification.accepted,
      groupNotificationError: notification.error,
    };
  }

  async function getSession(sessionId) {
    const session = await storage.getById(requiredText(sessionId, 'sessionId'));
    if (!session) throw signingError('SIGNING_NOT_FOUND', '找不到簽署流程。', 404);
    return session;
  }

  return Object.freeze({
    issueSigningRequest,
    sendInvitation,
    issueAndSend,
    recordProviderDeliveryAck,
    openSigningRequest,
    submitSignature,
    confirmSubmission,
    completeSigning,
    revokeSigningToken,
    getSession,
  });
}

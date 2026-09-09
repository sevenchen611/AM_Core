import crypto from 'node:crypto';
import { readBody, sendJson } from '../../core/util.js';

let platform = null;

const COMPANY_GROUP_RE = /HOZO\s*\u516c\u53f8[\u7fa4\u7d44]*/i;
const LINE_GROUP_ID_RE = /^C[a-f0-9]{32}$/i;
const LINE_USER_ID_RE = /^U[a-f0-9]{32}$/i;
const HOZO_TENANT_KEY = 'hozo-am-2-0';
const FINANCE_GROUP_CANONICAL_NAME = 'HOZO \u8ca1\u52d9\u7fa4\u7d44';
const FINANCE_RETRY_KEY_RE = /^finance-notification:v1:[a-f0-9]{64}$/;
const FINANCE_SOURCE_NOTIFICATION_ID_RE = /^bank-draft-notification:v1:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FINANCE_BODY_FIELDS = new Set([
  'text', 'message', 'imageUrls', 'image_urls', 'dryRun', 'retryKey', 'timeoutMs', 'mentionName',
  'sourceNotificationId',
]);

function init(injected) {
  platform = injected;
}

function textValues(prop) {
  if (!prop) return [];
  if (prop.type === 'title') return (prop.title || []).map((item) => item.plain_text || '').filter(Boolean);
  if (prop.type === 'rich_text') return (prop.rich_text || []).map((item) => item.plain_text || '').filter(Boolean);
  if (prop.type === 'select') return prop.select?.name ? [prop.select.name] : [];
  if (prop.type === 'multi_select') return (prop.multi_select || []).map((item) => item.name).filter(Boolean);
  return [];
}

function pageText(page) {
  return Object.values(page?.properties || {})
    .flatMap((prop) => textValues(prop))
    .join('\n');
}

function titleText(page) {
  return Object.values(page?.properties || {})
    .find((prop) => prop.type === 'title')
    ?.title?.map((item) => item.plain_text || '')
    .join('') || '';
}

function extractLineGroupId(page) {
  const prop = page?.properties?.['LINE \u7fa4\u7d44 ID'];
  if (prop?.type !== 'rich_text' || !Array.isArray(prop.rich_text) || prop.rich_text.length !== 1) return '';
  const value = String(prop.rich_text[0]?.plain_text || '').trim();
  return LINE_GROUP_ID_RE.test(value) ? value : '';
}

function maskLineId(id) {
  return id && id.length > 8 ? `${id.slice(0, 1)}***${id.slice(-4)}` : '***';
}

function requestError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function richTextPlain(prop) {
  return (prop?.rich_text || []).map((item) => item.plain_text || '').join('');
}

function normalizedMemberName(value) {
  return String(value || '').normalize('NFKC').trim();
}

function readJsonStringToken(raw, start) {
  if (raw[start] !== '"') throw new Error('Expected JSON string.');
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') return { value: JSON.parse(raw.slice(start, index + 1)), end: index + 1 };
    if (char.charCodeAt(0) < 0x20) throw new Error('Invalid JSON string.');
  }
  throw new Error('Unterminated JSON string.');
}

function parseFlatMemberMap(rawValue) {
  const raw = String(rawValue || '');
  let index = 0;
  const skipWhitespace = () => { while (/\s/.test(raw[index] || '')) index += 1; };
  skipWhitespace();
  if (raw[index] !== '{') throw new Error('Member map must be an object.');
  index += 1;
  skipWhitespace();
  const members = Object.create(null);
  const keys = new Set();
  if (raw[index] === '}') { index += 1; skipWhitespace(); if (index !== raw.length) throw new Error('Trailing JSON.'); return members; }
  while (index < raw.length) {
    const keyToken = readJsonStringToken(raw, index);
    index = keyToken.end;
    if (keys.has(keyToken.value)) throw new Error('Duplicate member key.');
    keys.add(keyToken.value);
    skipWhitespace();
    if (raw[index] !== ':') throw new Error('Expected colon.');
    index += 1;
    skipWhitespace();
    const valueToken = readJsonStringToken(raw, index);
    index = valueToken.end;
    members[keyToken.value] = valueToken.value;
    skipWhitespace();
    if (raw[index] === '}') { index += 1; break; }
    if (raw[index] !== ',') throw new Error('Expected comma.');
    index += 1;
    skipWhitespace();
  }
  skipWhitespace();
  if (index !== raw.length) throw new Error('Trailing JSON.');
  return members;
}

function normalizedCanonicalGroupName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function canonicalGroupName(page) {
  const explicit = textValues(page?.properties?.['\u7fa4\u7d44\u540d\u7a31']).join('').trim();
  return explicit || titleText(page);
}

function financeRetryKeyFor({ sourceNotificationId, text, mentionName, imageUrls }) {
  const identity = JSON.stringify({
    contract: 'hozo-rental-finance-group-mention-v1',
    sourceNotificationId,
    text,
    mentionName,
    imageUrls,
  });
  return `finance-notification:v1:${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

function validateSourceNotificationId(value) {
  const sourceNotificationId = String(value || '').trim();
  if (!FINANCE_SOURCE_NOTIFICATION_ID_RE.test(sourceNotificationId)) {
    throw requestError(400, 'invalid_source_notification_id', 'Finance push requires a valid sourceNotificationId.');
  }
  return sourceNotificationId.toLowerCase();
}

function validateFinanceRetryKey(value, identity) {
  const supplied = String(value || '');
  if (!FINANCE_RETRY_KEY_RE.test(supplied)) {
    throw requestError(400, 'invalid_retry_key', 'Finance push requires a valid content-bound retryKey.');
  }
  const expected = financeRetryKeyFor(identity);
  if (!timingSafeEqual(supplied, expected)) {
    throw requestError(409, 'idempotency_key_mismatch', 'Finance push retryKey does not match the normalized payload.');
  }
  return supplied;
}

function financeDeliveryRetryKey(retryKey, target, mention) {
  const routingIdentity = JSON.stringify({
    retryKey,
    groupId: target.groupId,
    userId: mention.userId,
  });
  return `finance-provider:v1:${crypto.createHash('sha256').update(routingIdentity).digest('hex')}`;
}

async function bindFinanceNotificationIdentity(ctx, sourceNotificationId, retryKey) {
  const store = platform?.operationalMemory;
  if (!store || typeof store.bindProcessingIdentity !== 'function') {
    throw requestError(503, 'idempotency_store_unavailable', 'Finance notification identity store is unavailable.');
  }
  const binding = await store.bindProcessingIdentity(ctx.tenant, {
    jobKind: 'finance-line-notification',
    idempotencyKey: sourceNotificationId,
    payloadDigest: retryKey.slice(-64),
  });
  if (!binding?.ok) {
    throw requestError(503, 'idempotency_store_unavailable', 'Finance notification identity store is unavailable.');
  }
  if (binding.conflict) {
    throw requestError(409, 'source_notification_conflict', 'Finance sourceNotificationId is already bound to different content.');
  }
  return binding;
}

function resolveMentionFromBinding(page, requestedName) {
  const mentionName = normalizedMemberName(requestedName);
  if (!mentionName || mentionName.length > 80 || /[\u0000-\u001f\u007f]/.test(mentionName)) {
    throw requestError(400, 'invalid_mention_name', 'Invalid mentionName.');
  }

  let members;
  try {
    members = parseFlatMemberMap(richTextPlain(page?.properties?.['\u6210\u54e1\u5c0d\u7167']));
  } catch {
    throw requestError(422, 'mention_not_resolved', 'Finance group mention could not be resolved.');
  }
  if (!members || Array.isArray(members) || typeof members !== 'object') {
    throw requestError(422, 'mention_not_resolved', 'Finance group mention could not be resolved.');
  }

  const matches = Object.entries(members)
    .filter(([name]) => normalizedMemberName(name) === mentionName)
    .map(([, userId]) => String(userId || '').trim());
  if (matches.length !== 1 || !LINE_USER_ID_RE.test(matches[0])) {
    throw requestError(422, 'mention_not_resolved', 'Finance group mention could not be resolved.');
  }
  return { name: mentionName, userId: matches[0] };
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function providedToken(req, ctx) {
  return bearerToken(req)
    || String(req.headers['x-amcore-key'] || '')
    || ctx.url.searchParams.get('key')
    || '';
}

function matchesAnySecret(provided, secrets) {
  return secrets.filter(Boolean).some((secret) => timingSafeEqual(provided, secret));
}

function isAuthorized(req, ctx) {
  const provided = providedToken(req, ctx);
  return matchesAnySecret(provided, [
    ctx.tenant?.queueAccessKey,
    platform?.queueAccessKey,
    platform?.portalServiceToken,
  ]);
}

function isRentalAuthorized(req, ctx) {
  const provided = bearerToken(req)
    || String(req.headers['x-hozo-rental-key'] || '')
    || String(req.headers['x-amcore-key'] || '')
    || ctx.url.searchParams.get('key')
    || '';
  return matchesAnySecret(provided, [platform?.rentalCompanyGroupPushKey]);
}

async function readJson(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeImageUrls(value) {
  const urls = Array.isArray(value) ? value : [];
  return [...new Set(urls.map((item) => String(item || '').trim()).filter(Boolean))]
    .filter((item) => {
      try {
        const url = new URL(item);
        return url.protocol === 'https:' && !url.username && !url.password && item.length <= 1800;
      } catch {
        return false;
      }
    })
    .slice(0, 4);
}

async function resolveGroup(ctx, { matcher, canonicalName, label }) {
  const dataSourceId = ctx.tenant?.dataSources?.groupBindings;
  if (!dataSourceId) throw new Error('HOZO group bindings data source is not configured.');

  const pages = [];
  const seenCursors = new Set();
  let startCursor = '';
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const result = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      method: 'POST',
      tenantKey: ctx.tenant.key,
      body: { page_size: 100, ...(startCursor ? { start_cursor: startCursor } : {}) },
    });
    pages.push(...(result.results || []));
    if (!result.has_more) break;
    startCursor = String(result.next_cursor || '');
    if (!startCursor || seenCursors.has(startCursor)) {
      throw new Error(`HOZO ${label} group binding lookup was incomplete.`);
    }
    seenCursors.add(startCursor);
    if (pageNumber === 99) throw new Error(`HOZO ${label} group binding lookup exceeded the page limit.`);
  }
  const candidates = pages.map((page) => ({
      page,
      name: canonicalGroupName(page),
      groupId: extractLineGroupId(page),
      text: pageText(page),
    }));
  const matches = candidates.filter((item) => (canonicalName
      ? normalizedCanonicalGroupName(item.name) === normalizedCanonicalGroupName(canonicalName)
      : item.groupId && matcher.test(item.text)));

  if (matches.length === 0) throw new Error(`HOZO ${label} group binding was not found.`);
  if (matches.length > 1) throw new Error(`Multiple HOZO ${label} group bindings were found.`);
  if (!matches[0].groupId) throw new Error(`HOZO ${label} group binding has an invalid canonical LINE group ID.`);
  return matches[0];
}

async function pushToGroup(req, res, ctx, {
  source = 'control', matcher = COMPANY_GROUP_RE, canonicalName = '', label = 'company', requireMention = false,
} = {}) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });

  try {
    const body = await readJson(req);
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw requestError(400, 'invalid_payload', 'Invalid request body.');
    }
    if (requireMention && Object.keys(body).some((field) => !FINANCE_BODY_FIELDS.has(field))) {
      throw requestError(400, 'invalid_payload', 'Finance push body contains an unsupported field.');
    }
    const text = String(body.text || body.message || '').trim();
    if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text.' });
    if (text.length > 4900) return sendJson(res, 400, { ok: false, error: 'Text is too long.' });
    const imageUrls = normalizeImageUrls(body.imageUrls || body.image_urls);

    let mention;
    let financeRetryKey = '';
    let sourceNotificationId = '';
    if (requireMention) {
      if (!Object.hasOwn(body, 'mentionName')) {
        throw requestError(400, 'mention_required', 'Finance push requires mentionName.');
      }
      const mentionName = normalizedMemberName(body.mentionName);
      if (!mentionName || mentionName.length > 80 || /[\u0000-\u001f\u007f]/.test(mentionName)) {
        throw requestError(400, 'invalid_mention_name', 'Invalid mentionName.');
      }
      if (!text.includes(mentionName)) {
        throw requestError(400, 'mention_not_in_text', 'Finance push text must contain mentionName.');
      }
      sourceNotificationId = validateSourceNotificationId(body.sourceNotificationId);
      financeRetryKey = validateFinanceRetryKey(body.retryKey, {
        sourceNotificationId, text, mentionName, imageUrls,
      });
    }
    const target = await resolveGroup(ctx, { matcher, canonicalName, label });
    if (requireMention) mention = resolveMentionFromBinding(target.page, body.mentionName);
    const deliveryRetryKey = requireMention
      ? financeDeliveryRetryKey(financeRetryKey, target, mention)
      : body.retryKey || crypto.randomUUID();
    if (body.dryRun === true) {
      return sendJson(res, 200, {
        ok: true,
        dryRun: true,
        source,
        imageCount: imageUrls.length,
        target: { name: target.name || `HOZO ${label} group`, maskedId: maskLineId(target.groupId) },
        ...(mention ? { mention: { name: mention.name, resolved: true, delivered: false } } : {}),
      });
    }
    if (requireMention) {
      await bindFinanceNotificationIdentity(ctx, sourceNotificationId, financeRetryKey);
    }

    const receipt = await platform.pushLineMessage(target.groupId, text, mention, {
      retryKey: deliveryRetryKey,
      timeoutMs: body.timeoutMs,
      additionalMessages: imageUrls.map((url) => ({
        type: 'image',
        originalContentUrl: url,
        previewImageUrl: url,
      })),
    });
    if (requireMention) {
      const status = Number(receipt?.status || 0);
      const accepted = (status >= 200 && status < 300) || (status === 409 && Boolean(receipt.acceptedRequestId));
      if (!accepted) throw Object.assign(new Error('LINE push did not provide accepted delivery evidence.'), { code: 'LINE_PUSH_UNCONFIRMED' });
    }
    return sendJson(res, 200, {
      ok: true,
      source,
      imageCount: imageUrls.length,
      target: { name: target.name || `HOZO ${label} group`, maskedId: maskLineId(target.groupId) },
      ...(mention ? { mention: { name: mention.name, resolved: true, delivered: true } } : {}),
      line: {
        status: receipt.status,
        requestId: receipt.requestId || '',
        acceptedRequestId: receipt.acceptedRequestId || '',
        messageIds: receipt.messageIds || [],
      },
    });
  } catch (error) {
    const lineFailure = error.code === 'LINE_PUSH_FAILED' || error.code === 'LINE_PUSH_TIMEOUT';
    const protectedFailure = requireMention && !error.statusCode;
    return sendJson(res, error.statusCode || (lineFailure ? 502 : 500), {
      ok: false,
      code: error.statusCode ? error.code : lineFailure ? 'line_push_failed' : protectedFailure ? 'finance_notification_failed' : error.code || undefined,
      error: lineFailure ? 'LINE push failed.' : protectedFailure ? 'Finance group notification failed.' : error.message,
      detail: lineFailure && !requireMention ? error.message : undefined,
      lineStatus: error.lineStatus || undefined,
      requestId: error.requestId || undefined,
    });
  }
}

async function handlePush(req, res, ctx) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!isAuthorized(req, ctx)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  return pushToGroup(req, res, ctx, { source: 'control' });
}

async function handleRentalPush(req, res, ctx) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!platform?.rentalCompanyGroupPushKey) {
    return sendJson(res, 503, { ok: false, error: 'Rental company-group push key is not configured.' });
  }
  if (!isRentalAuthorized(req, ctx)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  return pushToGroup(req, res, ctx, { source: 'hozo-rental' });
}

async function handleRentalFinancePush(req, res, ctx) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!platform?.rentalCompanyGroupPushKey) {
    return sendJson(res, 503, { ok: false, error: 'Rental finance-group push key is not configured.' });
  }
  if (!isRentalAuthorized(req, ctx)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  return pushToGroup(req, res, ctx, {
    source: 'hozo-rental-finance',
    canonicalName: FINANCE_GROUP_CANONICAL_NAME,
    label: 'finance',
    requireMention: true,
  });
}

export default {
  name: 'company-line-push',
  init,
  routes: [
    {
      prefix: '/control/hozo/company-group/push',
      method: 'POST',
      access: { kind: 'machine', scope: 'tenant', capability: 'line.push.company-group' },
      handler: handlePush,
    },
    {
      prefix: '/control/hozo/rental/company-group/push',
      method: 'POST',
      access: { kind: 'machine', scope: 'tenant', capability: 'line.push.company-group.rental' },
      handler: handleRentalPush,
    },
    {
      prefix: '/control/hozo/rental/finance-group/push',
      method: 'POST',
      access: { kind: 'machine', scope: 'tenant', capability: 'line.push.finance-group.rental' },
      handler: handleRentalFinancePush,
    },
  ],
};

export const __test = {
  extractLineGroupId, pageText, titleText, isRentalAuthorized, resolveMentionFromBinding,
  parseFlatMemberMap, canonicalGroupName, financeRetryKeyFor, financeDeliveryRetryKey,
  validateSourceNotificationId,
};

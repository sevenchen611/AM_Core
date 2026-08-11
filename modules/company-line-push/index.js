import crypto from 'node:crypto';
import { readBody, sendJson } from '../../core/util.js';

let platform = null;

const COMPANY_GROUP_RE = /HOZO\s*\u516c\u53f8[\u7fa4\u7d44]*/i;
const LINE_GROUP_ID_RE = /^C[a-f0-9]{20,}$/i;
const HOZO_TENANT_KEY = 'hozo-am-2-0';

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
  for (const prop of Object.values(page?.properties || {})) {
    for (const value of textValues(prop)) {
      if (LINE_GROUP_ID_RE.test(value)) return value;
    }
  }
  return '';
}

function maskLineId(id) {
  return id && id.length > 8 ? `${id.slice(0, 1)}***${id.slice(-4)}` : '***';
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

async function resolveCompanyGroup(ctx) {
  const dataSourceId = ctx.tenant?.dataSources?.groupBindings;
  if (!dataSourceId) throw new Error('HOZO group bindings data source is not configured.');

  const result = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
    method: 'POST',
    tenantKey: ctx.tenant.key,
    body: { page_size: 100 },
  });
  const matches = (result.results || [])
    .map((page) => ({
      page,
      name: titleText(page),
      groupId: extractLineGroupId(page),
      text: pageText(page),
    }))
    .filter((item) => item.groupId && COMPANY_GROUP_RE.test(item.text));

  if (matches.length === 0) throw new Error('HOZO company group binding was not found.');
  if (matches.length > 1) throw new Error('Multiple HOZO company group bindings were found.');
  return matches[0];
}

async function pushToCompanyGroup(req, res, ctx, source = 'control') {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });

  try {
    const body = await readJson(req);
    const text = String(body.text || body.message || '').trim();
    if (!text) return sendJson(res, 400, { ok: false, error: 'Missing text.' });
    if (text.length > 4900) return sendJson(res, 400, { ok: false, error: 'Text is too long.' });
    const imageUrls = normalizeImageUrls(body.imageUrls || body.image_urls);

    const target = await resolveCompanyGroup(ctx);
    if (body.dryRun === true) {
      return sendJson(res, 200, {
        ok: true,
        dryRun: true,
        source,
        imageCount: imageUrls.length,
        target: { name: target.name || 'HOZO company group', maskedId: maskLineId(target.groupId) },
      });
    }

    const receipt = await platform.pushLineMessage(target.groupId, text, undefined, {
      retryKey: body.retryKey || crypto.randomUUID(),
      timeoutMs: body.timeoutMs,
      additionalMessages: imageUrls.map((url) => ({
        type: 'image',
        originalContentUrl: url,
        previewImageUrl: url,
      })),
    });
    return sendJson(res, 200, {
      ok: true,
      source,
      imageCount: imageUrls.length,
      target: { name: target.name || 'HOZO company group', maskedId: maskLineId(target.groupId) },
      line: {
        status: receipt.status,
        requestId: receipt.requestId || '',
        acceptedRequestId: receipt.acceptedRequestId || '',
        messageIds: receipt.messageIds || [],
      },
    });
  } catch (error) {
    const lineFailure = error.code === 'LINE_PUSH_FAILED' || error.code === 'LINE_PUSH_TIMEOUT';
    return sendJson(res, error.statusCode || (lineFailure ? 502 : 500), {
      ok: false,
      error: lineFailure ? 'LINE push failed.' : error.message,
      detail: lineFailure ? error.message : undefined,
      lineStatus: error.lineStatus || undefined,
      requestId: error.requestId || undefined,
    });
  }
}

async function handlePush(req, res, ctx) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!isAuthorized(req, ctx)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  return pushToCompanyGroup(req, res, ctx, 'control');
}

async function handleRentalPush(req, res, ctx) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (ctx.tenant?.key !== HOZO_TENANT_KEY) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!platform?.rentalCompanyGroupPushKey) {
    return sendJson(res, 503, { ok: false, error: 'Rental company-group push key is not configured.' });
  }
  if (!isRentalAuthorized(req, ctx)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  return pushToCompanyGroup(req, res, ctx, 'hozo-rental');
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
  ],
};

export const __test = { extractLineGroupId, pageText, titleText, isRentalAuthorized };

// HTTP adapter for the Engineering contract payment-control domain.
//
// Authentication, CSRF validation, tenant selection, project scope, and role
// mapping are intentionally server-owned through resolveContext. Request JSON
// is never allowed to supply any of those values.

import { createEngineeringContractPaymentService } from './contract-payments.js';

export const CONTRACT_PAYMENT_API_BASE = '/contracts/api/v2';

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_BODY_FIELDS = Object.freeze([
  'actor', 'tenant', 'tenantKey', 'scope', 'permissions', 'capabilities',
  'authorization', 'projectAuthorization', 'allowedProjectIds',
]);

function apiError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function decodeSegment(value) {
  try {
    const output = decodeURIComponent(value);
    if (!output || output.includes('/')) throw new Error('invalid segment');
    return output;
  } catch {
    throw apiError('PAYMENT_ROUTE_REFERENCE_INVALID', '付款路由識別碼不合法。', 400);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw apiError('PAYMENT_REQUEST_BODY_TOO_LARGE', '付款請求內容過大。', 413);
    }
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch {
    throw apiError('PAYMENT_INVALID_JSON_BODY', '付款請求必須是有效 JSON 物件。', 400);
  }
}

function cleanInput(value) {
  const output = { ...(value || {}) };
  for (const field of FORBIDDEN_BODY_FIELDS) delete output[field];
  return output;
}

function routeFor(method, pathname) {
  let match = pathname.match(/^\/contracts\/api\/v2\/contracts\/([^/]+)\/payments\/schedule$/);
  if (match) {
    if (method !== 'GET') return { methodNotAllowed: true, allow: 'GET' };
    return { operation: 'schedule', contractId: decodeSegment(match[1]) };
  }
  if (pathname === '/contracts/api/v2/payment-claims') {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return { operation: 'submitClaim', body: true };
  }
  match = pathname.match(/^\/contracts\/api\/v2\/payment-claims\/([^/]+)$/);
  if (match) {
    if (method !== 'GET') return { methodNotAllowed: true, allow: 'GET' };
    return { operation: 'getClaim', claimId: decodeSegment(match[1]) };
  }
  match = pathname.match(/^\/contracts\/api\/v2\/payment-claims\/([^/]+)\/review$/);
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return { operation: 'reviewClaim', claimId: decodeSegment(match[1]), body: true };
  }
  match = pathname.match(/^\/contracts\/api\/v2\/payment-claims\/([^/]+)\/approve$/);
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return { operation: 'approveClaim', claimId: decodeSegment(match[1]), body: true };
  }
  return null;
}

function safeError(error) {
  return {
    ok: false,
    error: {
      code: String(error?.code || 'PAYMENT_CONTROL_FAILED').slice(0, 120),
      message: String(error?.message || '付款控制作業失敗。').slice(0, 500),
    },
  };
}

export function createContractPaymentApiHandler({
  paymentService,
  resolveContext,
  readJson = readJsonBody,
  send = sendJson,
} = {}) {
  const service = paymentService || createEngineeringContractPaymentService();
  if (!resolveContext || typeof resolveContext !== 'function') {
    throw new TypeError('resolveContext must return server-authorized payment context');
  }

  return async function handleContractPaymentApi(req, res, url) {
    const route = routeFor(req.method, url.pathname);
    if (!route) return false;
    if (route.methodNotAllowed) {
      send(res, 405, { ok: false, error: { code: 'PAYMENT_METHOD_NOT_ALLOWED', message: '不支援的付款控制方法。' } });
      return true;
    }
    try {
      const context = await resolveContext(req, { operation: route.operation });
      let input = route.body ? cleanInput(await readJson(req)) : {};
      if (route.contractId) {
        if (input.contractId && String(input.contractId) !== route.contractId) {
          throw apiError('PAYMENT_PATH_BODY_MISMATCH', '路由與內容中的合約不一致。', 400);
        }
        input = { ...input, contractId: route.contractId };
      }
      if (route.claimId) {
        if (input.claimId && String(input.claimId) !== route.claimId) {
          throw apiError('PAYMENT_PATH_BODY_MISMATCH', '路由與內容中的請款不一致。', 400);
        }
        input = { ...input, claimId: route.claimId };
      }
      const value = route.operation === 'schedule'
        ? await service.schedule(context, route.contractId)
        : (route.operation === 'submitClaim'
          ? await service.submitClaim(context, input)
          : (route.operation === 'reviewClaim'
            ? await service.reviewClaim(context, input)
            : (route.operation === 'approveClaim'
              ? await service.approveClaim(context, input)
              : await service.getClaim(context, route.claimId))));
      send(res, 200, { ok: true, data: value });
    } catch (error) {
      send(res, Number(error?.statusCode) || 500, safeError(error));
    }
    return true;
  };
}

export const __test = Object.freeze({
  routeFor,
  cleanInput,
  decodeSegment,
  safeError,
  readJsonBody,
});

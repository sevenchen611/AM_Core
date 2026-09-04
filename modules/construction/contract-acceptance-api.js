// HTTP adapter for the Engineering contract acceptance-control domain.
//
// Authentication, CSRF validation, tenant selection, project scope, and role
// mapping are intentionally server-owned through resolveContext. Request JSON
// is never allowed to supply or override any of those values.

import { createContractAcceptanceService } from './contract-acceptance.js';

export const CONTRACT_ACCEPTANCE_API_BASE = '/contracts/api/v2';

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_BODY_FIELDS = Object.freeze([
  'actor', 'actorId', 'tenant', 'tenantKey', 'scope', 'permissions',
  'capabilities', 'authorization', 'projectAuthorization', 'allowedProjectIds',
  'projectId', 'project_id', 'version', 'contract', 'eventHash',
  'previousEventHash', 'sequenceNo', 'occurredAt',
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
    throw apiError('ACCEPTANCE_ROUTE_REFERENCE_INVALID', '驗收路由識別碼不合法。', 400);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw apiError('ACCEPTANCE_REQUEST_BODY_TOO_LARGE', '驗收請求內容過大。', 413);
    }
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value;
  } catch {
    throw apiError('ACCEPTANCE_INVALID_JSON_BODY', '驗收請求必須是有效 JSON 物件。', 400);
  }
}

function cleanInput(value) {
  const output = { ...(value || {}) };
  for (const field of FORBIDDEN_BODY_FIELDS) delete output[field];
  return output;
}

function routeFor(method, pathname) {
  const base = '^/contracts/api/v2/contracts/([^/]+)/acceptance/([^/]+)';
  let match = pathname.match(new RegExp(base + '$'));
  if (match) {
    if (method !== 'GET') return { methodNotAllowed: true, allow: 'GET' };
    return {
      operation: 'get',
      contractId: decodeSegment(match[1]),
      versionId: decodeSegment(match[2]),
    };
  }
  match = pathname.match(new RegExp(base + '/submit$'));
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return {
      operation: 'submit',
      contractId: decodeSegment(match[1]),
      versionId: decodeSegment(match[2]),
      body: true,
    };
  }
  match = pathname.match(new RegExp(base + '/review$'));
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return {
      operation: 'review',
      contractId: decodeSegment(match[1]),
      versionId: decodeSegment(match[2]),
      body: true,
    };
  }
  match = pathname.match(new RegExp(base + '/reopen$'));
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return {
      operation: 'reopen',
      contractId: decodeSegment(match[1]),
      versionId: decodeSegment(match[2]),
      body: true,
    };
  }
  return null;
}

function safeError(error) {
  return {
    ok: false,
    error: {
      code: String(error?.code || 'ACCEPTANCE_CONTROL_FAILED').slice(0, 120),
      message: String(error?.message || '驗收控制作業失敗。').slice(0, 500),
    },
  };
}

export function createContractAcceptanceApiHandler({
  acceptanceService,
  resolveContext,
  readJson = readJsonBody,
  send = sendJson,
} = {}) {
  const service = acceptanceService || createContractAcceptanceService();
  if (!resolveContext || typeof resolveContext !== 'function') {
    throw new TypeError('resolveContext must return server-authorized acceptance context');
  }

  return async function handleContractAcceptanceApi(req, res, url) {
    let route;
    try {
      route = routeFor(req.method, url.pathname);
    } catch (error) {
      send(res, Number(error?.statusCode) || 400, safeError(error));
      return true;
    }
    if (!route) return false;
    if (route.methodNotAllowed) {
      send(res, 405, { ok: false, error: { code: 'ACCEPTANCE_METHOD_NOT_ALLOWED', message: '不支援的驗收控制方法。' } });
      return true;
    }
    try {
      const context = await resolveContext(req, { operation: route.operation });
      let input = route.body ? cleanInput(await readJson(req)) : {};
      if (input.contractId && String(input.contractId) !== route.contractId) {
        throw apiError('ACCEPTANCE_PATH_BODY_MISMATCH', '路由與內容中的合約不一致。', 400);
      }
      if (input.versionId && String(input.versionId) !== route.versionId) {
        throw apiError('ACCEPTANCE_PATH_BODY_MISMATCH', '路由與內容中的合約版本不一致。', 400);
      }
      input = { ...input, contractId: route.contractId, versionId: route.versionId };
      const value = route.operation === 'get'
        ? await service.get(context, input)
        : await service[route.operation](context, input);
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

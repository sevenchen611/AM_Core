// Internal JSON API for the engineering contract workflow.
//
// The caller must pass the already-authorized project scope and explicit
// capabilities. Tenant and actor always come from server-owned dependencies;
// request bodies cannot replace authorization context.

import { createContractManagementService } from './contract-management.js';
import { createContractIssuanceService } from './contract-issuance.js';
import { createContractCompletionService } from './contract-completion.js';
import { createContractArtifactService } from './contract-artifacts.js';
import { createRuntimeSigningService, signingRequestMeta } from './contract-runtime.js';

export const CONTRACT_WORKFLOW_API_BASE = '/contracts/api/v2';

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const UNTRUSTED_AUTHORIZATION_FIELDS = Object.freeze([
  'actor',
  'operator',
  'tenant',
  'tenantKey',
  'scope',
  'capabilities',
  'authorization',
  'projectAuthorization',
  'allowedProjectIds',
  'allowedProjectCodes',
]);

function apiError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw apiError('REQUEST_BODY_TOO_LARGE', 'JSON request body is too large.', 413, {
        maxBytes: MAX_JSON_BODY_BYTES,
      });
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('body must be an object');
    }
    return parsed;
  } catch (error) {
    throw apiError('INVALID_JSON_BODY', 'Request body must be a valid JSON object.', 400);
  }
}

function cleanRequestInput(body) {
  const input = { ...(body || {}) };
  for (const field of UNTRUSTED_AUTHORIZATION_FIELDS) delete input[field];
  return input;
}

function requireAuthority(deps, authority) {
  if (!deps?.tenant || !String(deps.tenant.key || '').trim()) {
    throw apiError('CONTRACT_TENANT_REQUIRED', 'Authoritative tenant context is required.', 403);
  }
  if (!String(deps.actor || '').trim()) {
    throw apiError('SERVER_ACTOR_REQUIRED', 'Authoritative server actor is required.', 403);
  }
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)
      || !Object.prototype.hasOwnProperty.call(authority, 'scope')) {
    throw apiError('PROJECT_SCOPE_REQUIRED', 'Explicit authoritative project scope is required.', 403);
  }
  if (!authority.capabilities || typeof authority.capabilities !== 'object'
      || Array.isArray(authority.capabilities)) {
    throw apiError('CONTRACT_CAPABILITIES_REQUIRED', 'Explicit contract capabilities are required.', 403);
  }
  return {
    tenant: deps.tenant,
    actor: deps.actor,
    scope: authority.scope,
  };
}

function requireCapability(authority, capability) {
  if (authority.capabilities[capability] !== true) {
    throw apiError(
      'CONTRACT_CAPABILITY_REQUIRED',
      `Contract capability '${capability}' is required.`,
      403,
      { capability },
    );
  }
}

function sameReference(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function bindPathReference(input, field, value) {
  const aliases = field === 'contractId' ? ['contractId', 'contract_id']
    : field === 'sessionId' ? ['sessionId', 'externalSessionId'] : ['versionId', 'version_id'];
  for (const alias of aliases) {
    if (input[alias] !== undefined && !sameReference(input[alias], value)) {
      throw apiError(
        'PATH_BODY_REFERENCE_MISMATCH',
        `${field} in the request body does not match the route.`,
        400,
        { field },
      );
    }
    delete input[alias];
  }
  input[field] = value;
  return input;
}

function decodeSegment(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim() || decoded.includes('/')) throw new Error('invalid segment');
    return decoded;
  } catch {
    throw apiError('INVALID_ROUTE_REFERENCE', 'Contract route reference is invalid.', 400);
  }
}

function routeFor(method, pathname) {
  if (!pathname.startsWith(`${CONTRACT_WORKFLOW_API_BASE}/`)) return null;
  if (method === 'GET' && pathname === `${CONTRACT_WORKFLOW_API_BASE}/contracts`) {
    return { operation: 'listContracts', capability: 'view' };
  }
  if (method === 'POST' && pathname === `${CONTRACT_WORKFLOW_API_BASE}/contracts/sync`) {
    return { operation: 'createOrSyncContract', capability: 'manage', body: true };
  }

  let match = pathname.match(/^\/contracts\/api\/v2\/signing-sessions\/([^/]+)\/confirm-complete$/);
  if (match) {
    if (method !== 'POST') return { methodNotAllowed: true, allow: 'POST' };
    return { operation: 'completeContract', capability: 'confirm', body: true, completion: true, sessionId: decodeSegment(match[1]) };
  }

  match = pathname.match(/^\/contracts\/api\/v2\/contracts\/([^/]+)$/);
  if (method === 'GET' && match) {
    return { operation: 'getContractDetail', capability: 'view', contractId: decodeSegment(match[1]) };
  }
  match = pathname.match(/^\/contracts\/api\/v2\/contracts\/([^/]+)\/versions$/);
  if (method === 'POST' && match) {
    return { operation: 'createDraftVersion', capability: 'manage', body: true, contractId: decodeSegment(match[1]) };
  }
  match = pathname.match(/^\/contracts\/api\/v2\/contracts\/([^/]+)\/versions\/([^/]+)\/(submit-review|approve|freeze|readiness|issue|retry-signing)$/);
  if (!match) return { notFound: true };
  const action = match[3];
  const definitions = {
    'submit-review': { method: 'POST', operation: 'submitVersionForReview', capability: 'manage', body: true },
    approve: { method: 'POST', operation: 'approveVersion', capability: 'issue', body: true },
    freeze: { method: 'POST', operation: 'freezeVersion', capability: 'issue', body: true },
    readiness: { method: 'GET', operation: 'issueReadiness', capability: 'view' },
    issue: { method: 'POST', operation: 'issueFrozenVersion', capability: 'issue', body: true, issuance: true },
    'retry-signing': { method: 'POST', operation: 'retryIssuedVersionSigning', capability: 'issue', body: true, issuance: true },
  };
  const definition = definitions[action];
  if (method !== definition.method) return { methodNotAllowed: true, allow: definition.method };
  return {
    ...definition,
    contractId: decodeSegment(match[1]),
    versionId: decodeSegment(match[2]),
  };
}

function listInput(url) {
  if (!url?.searchParams) return {};
  const projectIds = url.searchParams.getAll('projectId').filter(Boolean);
  const projectCodes = url.searchParams.getAll('projectCode').filter(Boolean);
  const count = Math.max(projectIds.length, projectCodes.length);
  if (count === 0) return {};
  return {
    projects: Array.from({ length: count }, (_, index) => ({
      id: projectIds[index] || '',
      code: projectCodes[index] || '',
    })),
  };
}

function publicError(error) {
  const statusCode = Number(error?.statusCode);
  const safeStatus = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
  if (safeStatus === 500) {
    return {
      statusCode: 500,
      payload: { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Contract workflow request failed.' } },
    };
  }
  const details = error?.details && typeof error.details === 'object' ? error.details : undefined;
  return {
    statusCode: safeStatus,
    payload: {
      ok: false,
      error: {
        code: String(error?.code || 'CONTRACT_WORKFLOW_ERROR'),
        message: String(error?.message || 'Contract workflow request failed.'),
        ...(details ? { details } : {}),
      },
    },
  };
}

/**
 * Build a per-request-safe handler around the injected tenant contract store.
 *
 * Integration shape:
 * `handler(req, res, pathname, url, { scope, capabilities })`.
 * Returns `false` only when the pathname is outside the v2 API namespace.
 */
export function createContractWorkflowApiHandler(deps) {
  let service;
  let issuanceService;
  return async function handleContractWorkflowApi(req, res, pathname, url, authority) {
    const route = routeFor(String(req.method || 'GET').toUpperCase(), pathname);
    if (!route) return false;
    try {
      if (route.notFound) throw apiError('NOT_FOUND', 'Contract workflow endpoint not found.', 404);
      if (route.methodNotAllowed) {
        res.setHeader?.('Allow', route.allow);
        throw apiError('METHOD_NOT_ALLOWED', 'HTTP method is not allowed for this endpoint.', 405);
      }
      const context = requireAuthority(deps, authority);
      requireCapability(authority, route.capability);
      service ||= createContractManagementService({
        store: deps.contractStore,
        ...(deps.contractClock ? { clock: deps.contractClock } : {}),
      });

      let input = route.operation === 'listContracts' ? listInput(url) : {};
      if (route.body) input = cleanRequestInput(await readJsonBody(req));
      if (route.contractId) bindPathReference(input, 'contractId', route.contractId);
      if (route.versionId) bindPathReference(input, 'versionId', route.versionId);
      if (route.sessionId) bindPathReference(input, 'sessionId', route.sessionId);
      if (route.issuance) issuanceService ||= createContractIssuanceService(deps);
      const completionService = route.completion ? createContractCompletionService(deps, {
        artifactService: createContractArtifactService(deps),
        signingService: createRuntimeSigningService(deps),
        requestMeta: signingRequestMeta(req),
      }) : null;
      const target = route.completion ? completionService : (route.issuance ? issuanceService : service);
      const data = await target[route.operation](context, input);
      sendJson(res, 200, { ok: true, data });
      return true;
    } catch (error) {
      const response = publicError(error);
      sendJson(res, response.statusCode, response.payload);
      return true;
    }
  };
}

export async function handleContractWorkflowApiRequest(req, res, pathname, url, deps, authority) {
  return createContractWorkflowApiHandler(deps)(req, res, pathname, url, authority);
}

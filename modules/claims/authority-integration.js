import crypto from 'node:crypto';
import fs from 'node:fs';
import { createFinanceClaimsV3Pool } from './v3/postgres.js';
import { createClaimsAuthority } from '../../core/claims-authority.js';
import { createClaimsAuthorityPostgresStore } from '../../core/claims-authority-postgres.js';
import { createClaimsAuthorityRuntimeAdapter } from '../../core/claims-authority-runtime.js';
import { createClaimsAuthorityV3Adapter } from '../../core/claims-authority-v3.js';
import { createClaimsAuthorityAdminHandler } from '../../core/claims-authority-admin.js';
import { createClaimsAuthorityOutboxWorker } from '../../core/claims-authority-outbox.js';

const OPAQUE_REFERENCE = /^line-ref:v1:[0-9a-f-]{36}$/iu;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u;

function parseJson(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function timingSafeText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function targetRegistry(env) {
  const parsed = parseJson(env.HZ2_CLAIMS_AUTHORITY_TARGETS_JSON, { targets: [] });
  const targets = Array.isArray(parsed?.targets) ? parsed.targets : [];
  const result = new Map();
  for (const item of targets) {
    if (!SAFE_KEY.test(String(item?.key || '')) || !SAFE_KEY.test(String(item?.tenantKey || ''))
      || !/^[a-f0-9-]{32,36}$/iu.test(String(item?.bindingId || ''))
      || !SAFE_KEY.test(String(item?.sourceId || '')) || !SAFE_KEY.test(String(item?.formKey || ''))
      || !OPAQUE_REFERENCE.test(String(item?.groupReference || '')) || result.has(item.key)) continue;
    result.set(item.key, {
      key: item.key,
      label: String(item.label || item.key).slice(0, 120),
      tenantKey: item.tenantKey,
      bindingId: item.bindingId,
      financeScope: { sourceId: item.sourceId, formKey: item.formKey, groupReference: item.groupReference },
    });
  }
  if (result.size) return result;
  const bindings = parseJson(env.HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON, { bindings: [] });
  const scopes = parseJson(env.HZ2_FINANCE_CLAIMS_V3_GROUP_ENTRY_SCOPES_JSON, { scopes: [] });
  const groupRefs = new Map((Array.isArray(bindings?.bindings) ? bindings.bindings : [])
    .filter((item) => item?.type === 'group_binding' && OPAQUE_REFERENCE.test(String(item.identityReference || '')))
    .map((item) => [item.identityReference, item]));
  for (const item of Array.isArray(scopes?.scopes) ? scopes.scopes : []) {
    const binding = groupRefs.get(item?.groupReference);
    const uuid = String(item?.groupReference || '').replace(/^line-ref:v1:/u, '');
    if (!binding || !SAFE_KEY.test(String(item?.tenantKey || '')) || !SAFE_KEY.test(String(item?.sourceId || ''))
      || !SAFE_KEY.test(String(item?.formKey || '')) || !/^[0-9a-f-]{36}$/iu.test(uuid)) continue;
    const key = `source-${crypto.createHash('sha256').update(`${item.tenantKey}:${item.sourceId}:${item.formKey}`).digest('hex').slice(0, 16)}`;
    result.set(key, {
      key,
      label: `${item.sourceId} / ${item.formKey}`.slice(0, 120),
      tenantKey: item.tenantKey,
      bindingId: uuid,
      financeScope: { sourceId: item.sourceId, formKey: item.formKey, groupReference: item.groupReference },
    });
  }
  return result;
}

function recipientRegistry(env) {
  const parsed = parseJson(env.HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON, { bindings: [] });
  const result = new Map();
  for (const item of Array.isArray(parsed?.bindings) ? parsed.bindings : []) {
    if (item?.type === 'line_user' && String(item.target || '').startsWith('U')
      && OPAQUE_REFERENCE.test(String(item.identityReference || ''))) {
      result.set(`${item.tenantKey}:${item.target}`, item.identityReference);
    }
  }
  return result;
}

function deterministicApplicantReference(identityKey, tenantKey, userId) {
  const bytes = crypto.createHmac('sha256', identityKey).update(`applicant:${tenantKey}:${userId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `line-ref:v1:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nodeRequest(req, url, body) {
  return {
    method: req.method,
    url: url.toString(),
    headers: req.headers,
    async json() { return body; },
  };
}

function sendResponse(res, response) {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
  return true;
}

const notionPlain = (property, kind = 'rich_text') => (property?.[kind] || [])
  .map((item) => item.plain_text || item.text?.content || '')
  .join('')
  .trim();

async function listKnownLineGroups(platform, tenant) {
  const sourceId = tenant?.dataSources?.groupBindings;
  if (!sourceId || typeof platform?.notionRequest !== 'function') return [];
  const groups = [];
  let cursor = '';
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const page = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(sourceId)}/query`, {
      method: 'POST', tenantKey: tenant.key, body,
    });
    for (const item of page.results || []) {
      const groupId = notionPlain(item.properties?.['LINE 群組 ID']);
      if (!/^C[A-Za-z0-9_-]{20,100}$/u.test(groupId)) continue;
      groups.push({ groupId, storedName: notionPlain(item.properties?.['群組名稱'], 'title').slice(0, 160) });
    }
    cursor = page.has_more ? String(page.next_cursor || '') : '';
  } while (cursor);
  return [...new Map(groups.map((item) => [item.groupId, item])).values()];
}

export function createClaimsAuthorityIntegration({ env = process.env, platform, groupEntry, receiver, renderFormPreview } = {}) {
  const enabled = env.HZ2_CLAIMS_AUTHORITY_ENABLED === 'true';
  if (!enabled) return { enabled: false, ready: false };
  const identityKey = String(env.HZ2_CLAIMS_AUTHORITY_IDENTITY_KEY || '');
  const sharedDatabaseUrl = String(env.HZ2_FINANCE_CLAIMS_V3_DATABASE_URL || '');
  const urls = {
    tenant: env.HZ2_CLAIMS_AUTHORITY_TENANT_DATABASE_URL || sharedDatabaseUrl,
    discovery: env.HZ2_CLAIMS_AUTHORITY_DISCOVERY_DATABASE_URL || sharedDatabaseUrl,
    platform: env.HZ2_CLAIMS_AUTHORITY_PLATFORM_DATABASE_URL || sharedDatabaseUrl,
    worker: env.HZ2_CLAIMS_AUTHORITY_WORKER_DATABASE_URL || sharedDatabaseUrl,
  };
  if (identityKey.length < 32 || Object.values(urls).some((value) => !String(value || '').trim())) {
    throw new Error('Claims authority fixed key and four role-specific database URLs are required.');
  }
  const makePool = (url, role) => createFinanceClaimsV3Pool(url, {
    onError: (error) => platform?.logger?.warn?.(`Claims authority ${role} pool failed: ${error.message}`),
  });
  const store = createClaimsAuthorityPostgresStore({
    tenantPool: makePool(urls.tenant, 'tenant'),
    discoveryPool: makePool(urls.discovery, 'discovery'),
    platformPool: makePool(urls.platform, 'platform'),
    workerPool: makePool(urls.worker, 'worker'),
  });
  const migrationPool = makePool(sharedDatabaseUrl || urls.platform, 'migration');
  const migrationSql = fs.readFileSync(new URL('../../versions/AM-IMP-2026.0912.01/config/claims-authority-registry.sql', import.meta.url), 'utf8');
  const migrationPromise = migrationPool.query(migrationSql).then(() => true).catch((error) => {
    platform?.logger?.warn?.(`Claims authority migration failed closed: ${error.message}`);
    throw error;
  });
  const targets = targetRegistry(env);
  const recipients = recipientRegistry(env);
  const v3 = createClaimsAuthorityV3Adapter({
    groupEntry,
    async verifySource(input) {
      const match = [...targets.values()].find((item) => item.tenantKey === input.tenantKey
        && item.bindingId.replaceAll('-', '').toLowerCase() === String(input.bindingId).replaceAll('-', '').toLowerCase()
        && item.financeScope.sourceId === input.sourceId && item.financeScope.formKey === input.formKey
        && item.financeScope.groupReference === input.groupReference);
      return match ? { ok: true, sourceId: match.financeScope.sourceId } : { ok: false };
    },
    async resolveApplicantReference({ tenant, userId }) {
      return recipients.get(`${tenant.key}:${userId}`)
        || deterministicApplicantReference(identityKey, tenant.key, userId);
    },
    async syncMembership(body) {
      const result = await receiver.bridgeMembership(body);
      if (result?.status !== 200) throw new Error('Finance V3 membership bridge rejected the member.');
      return result.body;
    },
  });
  const authority = createClaimsAuthority({
    store,
    identityKey,
    financeProvisioner: v3.financeProvisioner,
    openV3Claim: v3.openV3Claim,
    identityResolver: {
      resolveGroupName: ({ groupId }) => platform.resolveGroupName(groupId),
      resolveMemberName: ({ groupId, userId }) => platform.resolveGroupMemberName(groupId, userId),
    },
  });
  const mode = ['shadow', 'enforce'].includes(env.HZ2_CLAIMS_AUTHORITY_MODE) ? env.HZ2_CLAIMS_AUTHORITY_MODE : 'enforce';
  const authorityTenant = (tenant) => ({
    ...tenant,
    config: { ...tenant.config, claims: { ...tenant.config?.claims, authorityRegistry: { mode } } },
  });
  const replyLine = async (event, message) => {
    if (event?.replyToken) return platform.replyLineMessage(event.replyToken, message);
    const target = event?.source?.groupId || event?.source?.roomId;
    if (target) return platform.pushLineMessage(target, message);
    return null;
  };
  const runtime = createClaimsAuthorityRuntimeAdapter({ authority, replyLine });
  const worker = createClaimsAuthorityOutboxWorker({
    store,
    workerId: `am-core-${process.pid}`,
    dispatcher: { async dispatch() { return true; } },
  });

  async function syncDiscovery({ tenant, actor }) {
    if (!actor?.roles?.includes('platform_owner')) throw new Error('Claims authority access denied.');
    const known = await listKnownLineGroups(platform, tenant);
    let verified = 0;
    for (const item of known) {
      const liveName = String(await platform.resolveGroupName(item.groupId) || '').trim();
      if (!liveName) continue;
      const eventKey = crypto.createHash('sha256').update(`${tenant.tenantId}:${item.groupId}`).digest('hex');
      await authority.discover({
        event: { type: 'backfill', webhookEventId: `claims-authority-backfill-${eventKey}` },
        groupId: item.groupId,
        groupDisplayName: liveName || item.storedName,
      });
      verified += 1;
    }
    return { ok: true, scanned: known.length, verified };
  }

  function actorFromAccess(access) {
    const roles = access?.isPlatformOwner ? ['platform_owner']
      : access?.isTenantAll ? ['claims_access_admin'] : ['operator'];
    return { subject: access?.actor || 'portal', roles };
  }

  async function admin(req, res, context) {
    await migrationPromise;
    let parsedBody = {};
    if (req.method === 'POST') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 64 * 1024) return sendResponse(res, { status: 413, headers: { 'content-type': 'application/json' }, body: '{"error":"Payload too large"}' });
        chunks.push(chunk);
      }
      try { parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { parsedBody = {}; }
    }
    const handler = createClaimsAuthorityAdminHandler({
      authority,
      basePath: '/claims-authority',
      resolveContext: async () => ({ tenant: authorityTenant(context.tenant), actor: actorFromAccess(context.access), csrfToken: String(env.HZ2_CLAIMS_AUTHORITY_CSRF_TOKEN || '') }),
      listTargets: async () => [...targets.values()].map(({ key, label }) => ({ key, label })),
      syncDiscovery,
      renderFormPreview,
      resolveTarget: async (key) => {
        const item = targets.get(String(key || ''));
        const tenant = context.tenants.find((candidate) => candidate.key === item?.tenantKey);
        return item && tenant ? { ...item, tenant: authorityTenant(tenant) } : null;
      },
      verifyMutation: async (request, current) => {
        const configured = String(env.HZ2_CLAIMS_AUTHORITY_CSRF_TOKEN || '');
        if (configured.length < 32 || !timingSafeText(request.headers['x-csrf-token'], configured)) throw new Error('Forbidden');
        const origin = String(request.headers.origin || '');
        const host = String(request.headers.host || '');
        if (origin && new URL(origin).host !== host) throw new Error('Forbidden');
        if (!current.actor.roles.some((role) => ['platform_owner', 'claims_access_admin'].includes(role))) throw new Error('Forbidden');
      },
    });
    return sendResponse(res, await handler(nodeRequest(req, context.url, parsedBody)));
  }

  return {
    enabled: true,
    ready: true,
    authority,
    admin,
    async handleLineEvent({ tenant, binding, event }) {
      await migrationPromise;
      const enriched = binding ? (() => {
        const target = [...targets.values()].find((item) => item.tenantKey === tenant.key
          && item.bindingId.replaceAll('-', '').toLowerCase() === String(binding.pageId || binding.id || '').replaceAll('-', '').toLowerCase());
        return target ? { ...binding, ...target.financeScope, financeSourceId: target.financeScope.sourceId, claimFormKey: target.financeScope.formKey } : binding;
      })() : null;
      return runtime.handle({ tenant: authorityTenant(tenant), binding: enriched, event });
    },
    async runOutbox() { await migrationPromise; return worker.runOnce(); },
  };
}

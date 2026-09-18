import crypto from 'node:crypto';
import fs from 'node:fs';
import { createFinanceClaimsV3Pool } from './v3/postgres.js';
import { createClaimsAuthority } from '../../core/claims-authority.js';
import { createClaimsAuthorityPostgresStore } from '../../core/claims-authority-postgres.js';
import { createClaimsAuthorityRuntimeAdapter } from '../../core/claims-authority-runtime.js';
import { createClaimsAuthorityV3Adapter } from '../../core/claims-authority-v3.js';
import { CLAIM_FORM_INVENTORY, createClaimsAuthorityAdminHandler, renderClaimsAuthorityAccessRecoveryPage } from '../../core/claims-authority-admin.js';
import { createClaimsAuthorityOutboxWorker } from '../../core/claims-authority-outbox.js';

const OPAQUE_REFERENCE = /^line-ref:v1:[0-9a-f-]{36}$/iu;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u;
const SELECTOR_TTL_MS = 10 * 60 * 1000;
const SELECTOR_COOKIE = 'am_claims_form_selector';

function requiresFinanceMembership(claimMode, formKey) {
  if (claimMode === 'external_claim_only') {
    if (!String(formKey || '').startsWith('legacy_')) throw new Error('外部廠商群組僅可使用外部請款單。');
    return false;
  }
  return true;
}

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
  const ambiguous = new Set();
  for (const item of Array.isArray(parsed?.bindings) ? parsed.bindings : []) {
    if (item?.type === 'line_user' && String(item.target || '').startsWith('U')
      && OPAQUE_REFERENCE.test(String(item.identityReference || ''))) {
      const key = `${item.tenantKey}:${item.target}`;
      if (ambiguous.has(key)) continue;
      if (result.has(key) && result.get(key) !== item.identityReference) {
        result.delete(key);
        ambiguous.add(key);
      } else result.set(key, item.identityReference);
    }
  }
  return result;
}

function selectorSessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.ceil((Number(expiresAt) - Date.now()) / 1000));
  return `${SELECTOR_COOKIE}=${encodeURIComponent(String(token || ''))}; Max-Age=${maxAge}; Path=/claims/liff; HttpOnly; Secure; SameSite=Lax`;
}

function selectorMessage(url) {
  return `HOZO 費用申請\n請先選擇這次要使用的請款單（僅限本次申請人使用）：\n${url}\n連結失效後，請回原群組重新輸入「請款」或「費用申請」。`;
}

async function deliverSelectorToOrigin(platform, input, url) {
  const message = selectorMessage(url);
  if (input.event?.replyToken) {
    try { await platform.replyLineMessage(input.event.replyToken, message); return { channel: 'reply' }; } catch { /* exact-origin push fallback below */ }
  }
  if (!input.groupId) throw new Error('無法確認請款指令的來源群組。');
  await platform.pushLineMessage(input.groupId, message, undefined, { retryKey: `claims-selector:${input.idempotencyKey}` });
  return { channel: 'push' };
}

function groupRecipientRegistry(env) {
  const bindings = parseJson(env.HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON, { bindings: [] });
  const result = new Map();
  const ambiguous = new Set();
  for (const item of Array.isArray(bindings?.bindings) ? bindings.bindings : []) {
    if (item?.type !== 'group_binding' || !SAFE_KEY.test(String(item.tenantKey || ''))
      || !/^[CR][A-Za-z0-9_-]{20,100}$/u.test(String(item.target || ''))
      || !OPAQUE_REFERENCE.test(String(item.identityReference || ''))) continue;
    const key = `${item.tenantKey}:${item.target}`;
    if (ambiguous.has(key)) continue;
    if (result.has(key)) {
      result.delete(key);
      ambiguous.add(key);
      continue;
    }
    result.set(key, String(item.identityReference));
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

export function createClaimsAuthorityIntegration({ env = process.env, platform, groupEntry, receiver, renderFormPreview, createLegacyFormLink, verifyLiffUser, claimsLiffId, listFormHistory } = {}) {
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
  const migrationSql = [
    '../../versions/AM-IMP-2026.0912.01/config/claims-authority-registry.sql',
    '../../versions/AM-IMP-2026.0914.01/config/claims-group-form-routing.sql',
    '../../versions/AM-IMP-2026.0915.02/config/claims-member-auto-onboarding.sql',
    '../../versions/AM-IMP-2026.0916.01/config/claims-group-modes.sql',
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
  const migrationPromise = migrationSql.reduce((chain, sql) => chain.then(() => migrationPool.query(sql)), Promise.resolve()).then(() => true).catch((error) => {
    platform?.logger?.warn?.(`Claims authority migration failed closed: ${error.message}`);
    throw error;
  });
  const targets = targetRegistry(env);
  const recipients = recipientRegistry(env);
  const groupRecipients = groupRecipientRegistry(env);
  const resolveApplicantReference = async ({ tenant, userId }) => recipients.get(`${tenant.key}:${userId}`)
    || deterministicApplicantReference(identityKey, tenant.key, userId);
  const v3 = createClaimsAuthorityV3Adapter({
    groupEntry,
    async verifySource(input) {
      const match = [...targets.values()].find((item) => item.tenantKey === input.tenantKey
        && item.bindingId.replaceAll('-', '').toLowerCase() === String(input.bindingId).replaceAll('-', '').toLowerCase()
        && item.financeScope.sourceId === input.sourceId && item.financeScope.formKey === input.formKey
        && item.financeScope.groupReference === input.groupReference);
      return match ? { ok: true, sourceId: match.financeScope.sourceId } : { ok: false };
    },
    resolveApplicantReference,
    async syncMembership(body) {
      const result = await receiver.bridgeMembership(body);
      if (result?.status !== 200) throw new Error('Finance V3 membership bridge rejected the member.');
      return result.body;
    },
  });
  const selectorSignature = (sessionId, expiresAt) => crypto.createHmac('sha256', identityKey)
    .update(`form-selector:v1:${sessionId}:${expiresAt}`).digest('base64url');
  const selectorToken = ({ sessionId, expiresAt }) => {
    const ms = Date.parse(expiresAt);
    return `fs1.${sessionId}.${ms}.${selectorSignature(sessionId, ms)}`;
  };
  const parseSelectorToken = (value) => {
    const match = String(value || '').match(/^fs1\.([0-9a-f-]{36})\.(\d+)\.([A-Za-z0-9_-]{43})$/iu);
    if (!match || Number(match[2]) <= Date.now() || !timingSafeText(match[3], selectorSignature(match[1], match[2]))) return null;
    return { sessionId: match[1], expiresAt: Number(match[2]) };
  };
  let authority;
  async function openClaim(input) {
    if (!input.routing?.configured) {
      const exactGroupReference = groupRecipients.get(`${input.tenant.key}:${input.groupId}`);
      if (!exactGroupReference) throw new Error('此 LINE 群組尚未設定專屬請款投遞目標，為避免送錯群組，本次未建立連結。');
      return v3.openV3Claim({ ...input, binding: { ...input.binding, groupReference: exactGroupReference } });
    }
    const session = await authority.createFormSelectionSession({
      tenant: input.tenant,
      groupLookup: input.groupLookup,
      memberLookup: input.memberLookup,
      eventKey: input.idempotencyKey,
      formKeys: input.routing.availableForms,
      ttlMs: SELECTOR_TTL_MS,
    });
    const liffId = String(claimsLiffId?.(input.tenant) || '');
    if (!liffId) throw new Error('請款 LINE LIFF 尚未設定。');
    const url = new URL(`https://liff.line.me/${encodeURIComponent(liffId)}`);
    url.searchParams.set('selector', selectorToken(session));
    await deliverSelectorToOrigin(platform, input, url.toString());
    return { queued: false, delivered: true, selector: true, eventKey: input.idempotencyKey, replayed: false };
  }
  authority = createClaimsAuthority({
    store,
    identityKey,
    financeProvisioner: v3.financeProvisioner,
    openV3Claim: openClaim,
    applicantReferenceFactory: resolveApplicantReference,
    verifiedRecipientReferenceFactory: async ({ tenant, userId }) => recipients.get(`${tenant.key}:${userId}`) || '',
    membershipSynchronizer: (body) => receiver.bridgeMembership(body),
    identityResolver: {
      resolveGroupName: ({ groupId }) => platform.resolveGroupName(groupId),
      resolveMemberName: ({ groupId, userId }) => platform.resolveGroupMemberName(groupId, userId),
    },
  });
  receiver.setIdentityReferenceResolver?.((input) => authority.resolveNotificationRecipient(input));
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
    if (!context.access?.allowed) {
      return sendResponse(res, {
        status: context.access?.user ? 403 : 401,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
        },
        body: renderClaimsAuthorityAccessRecoveryPage({ financeBaseUrl: context.tenant?.config?.claims?.rentalBaseUrl || '' }),
      });
    }
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
      listFormHistory: async (current) => listFormHistory?.(current.tenant) || { forms: [] },
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

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const selectorHtml = ({ token, session, tenant }) => {
    const forms = CLAIM_FORM_INVENTORY.filter((form) => session.formKeys.includes(form.key));
    const data = JSON.stringify({ token, liffId: claimsLiffId?.(tenant) || '' }).replace(/</gu, '\\u003c');
    const cards = forms.map((form) => `<button class="form-card" type="button" data-key="${form.key}"><span class="form-name">${escapeHtml(form.name)}</span><span class="form-description">${escapeHtml(form.description)}</span><span class="form-version">${escapeHtml(form.version)}</span></button>`).join('');
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>選擇請款單</title><style>
    :root{font-family:system-ui,"Noto Sans TC",sans-serif;color:#22302a;background:#f4f6f5}body{margin:0}main{max-width:680px;margin:auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 7px}.muted{color:#68756f;line-height:1.6;margin:0 0 18px}.forms{display:grid;gap:12px}.form-card{width:100%;display:grid;gap:5px;text-align:left;padding:17px;border:1px solid #d8e2dd;border-radius:14px;background:#fff;color:inherit;cursor:pointer}.form-card:hover,.form-card:focus{border-color:#267348;box-shadow:0 0 0 2px #dcefe4}.form-card:disabled{opacity:.6;cursor:wait}.form-name{font-size:17px;font-weight:800}.form-description{font-size:14px;color:#68756f}.form-version{font-size:12px;color:#267348;font-weight:700}.status{margin:16px 0 0;font-size:14px;line-height:1.6}.error{color:#a13d34}.hidden{display:none}</style></head><body><main><h1>選擇請款單</h1><p class="muted">來源群組：${escapeHtml(session.groupName || 'HOZO 群組')}<br>請選擇這次申請要使用的表單。</p><p id="identity" class="status">正在驗證 LINE 身分…</p><section id="forms" class="forms hidden">${cards}</section><p id="result" class="status"></p><script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
    const DATA=${data},identity=document.querySelector('#identity'),forms=document.querySelector('#forms'),result=document.querySelector('#result');let accessToken='';
    async function api(action,extra={}){const response=await fetch(location.pathname+location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,selectorToken:DATA.token,liffAccessToken:accessToken,...extra})});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'操作失敗');return body}
    async function init(){try{if(!window.liff)throw Error('LINE 身分元件載入失敗，請回群組重新開啟。');await liff.init({liffId:DATA.liffId,withLoginOnExternalBrowser:true});if(!liff.isLoggedIn()){liff.login({redirectUri:location.href});return}accessToken=liff.getAccessToken?.()||'';if(!accessToken)throw Error('未取得 LINE 登入資訊，請回群組重新開啟。');await api('identify');identity.textContent='LINE 身分已驗證';forms.classList.remove('hidden')}catch(error){identity.className='status error';identity.textContent=error.message}}
    document.querySelectorAll('[data-key]').forEach(button=>button.onclick=async()=>{document.querySelectorAll('[data-key]').forEach(item=>item.disabled=true);result.className='status';result.textContent='正在開啟正確的請款單…';try{const answer=await api('select',{formKey:button.dataset.key});location.assign(answer.url)}catch(error){result.className='status error';result.textContent=error.message;document.querySelectorAll('[data-key]').forEach(item=>item.disabled=false)}});init();
    </script></main></body></html>`;
  };

  async function handleSelector(req, res, { tenant, token }) {
    await migrationPromise;
    const parsed = parseSelectorToken(token);
    if (!parsed) return sendResponse(res, { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ error: '請款連結已失效，請回群組重新輸入「請款」。' }) });
    try {
      const session = await authority.resolveFormSelection({ tenant: authorityTenant(tenant), sessionId: parsed.sessionId });
      if (req.method === 'GET') return sendResponse(res, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': selectorSessionCookie(token, parsed.expiresAt), 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.line-scdn.net; connect-src 'self' https://api.line.me; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'x-content-type-options': 'nosniff' }, body: selectorHtml({ token, session, tenant }) });
      if (req.method !== 'POST') throw new Error('不支援的操作。');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 64 * 1024) throw new Error('資料量過大。'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!timingSafeText(body.selectorToken, token)) throw new Error('請款連結驗證失敗。');
      const actor = await verifyLiffUser?.({ tenant, accessToken: body.liffAccessToken, expectedUserId: session.userId, bindingId: session.bindingId });
      if (!actor?.ok) throw new Error('此請款連結僅限原送件人使用。');
      if (body.action === 'identify') return sendResponse(res, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: true }) });
      if (body.action !== 'select') throw new Error('不支援的操作。');
      const selected = await authority.resolveFormSelection({ tenant: authorityTenant(tenant), sessionId: parsed.sessionId, formKey: body.formKey });
      if (selected.resolvedUrl) return sendResponse(res, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: true, url: selected.resolvedUrl, replayed: true }) });
      let targetUrl = '';
      const identityReference = await resolveApplicantReference({ tenant, userId: selected.userId });
      const requestBase = `selector-${parsed.sessionId}`;
      if (requiresFinanceMembership(selected.claimMode, body.formKey)) {
        const membership = await receiver.bridgeMembership({ contractVersion: 'finance-claims-v3.am-bridge-v1', requestId: `${requestBase}-member`, tenantKey: tenant.key, sourceId: selected.sourceId, identityReference, desiredState: 'active', eventSequence: Math.max(1, Date.now()), effectiveAt: new Date().toISOString() });
        if (membership?.status !== 200 || !membership.body?.matched || membership.body?.effectiveState !== 'active') throw new Error('內部 V3 請款身分尚未啟用，請聯絡財務管理員。');
      }
      if (String(body.formKey).startsWith('legacy_')) {
        targetUrl = await createLegacyFormLink?.({ tenant, selectorSessionId: parsed.sessionId, formKey: body.formKey, sourceId: selected.sourceId, groupReference: selected.groupReference, claimMode: selected.claimMode, identityReference, bindingId: selected.bindingId, groupId: selected.groupId, groupName: selected.groupName, userId: selected.userId, userName: actor.displayName || '' });
      } else if (body.formKey === 'employee_expense') {
        const entry = await receiver.bridgeWebEntry({ contractVersion: 'finance-claims-v3.am-bridge-v1', requestId: `${requestBase}-entry`, tenantKey: tenant.key, sourceId: selected.sourceId, formKey: selected.v3FormKey, identityReference });
        if (entry?.status !== 200 || !entry.body?.url) throw new Error('V3 請款單目前無法開啟，請稍後再試。');
        targetUrl = entry.body.url;
      }
      if (!targetUrl) throw new Error('請款單入口尚未設定。');
      await authority.completeFormSelection({ tenant: authorityTenant(tenant), sessionId: parsed.sessionId, formKey: body.formKey, resolvedUrl: targetUrl });
      return sendResponse(res, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: true, url: targetUrl }) });
    } catch (error) {
      return sendResponse(res, { status: 400, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify({ error: String(error?.message || '操作失敗').slice(0, 240) }) });
    }
  }

  return {
    enabled: true,
    ready: true,
    authority,
    async resolveGroupMention(input) {
      await migrationPromise;
      return authority.resolveGroupMention({ ...input, diagnose: true });
    },
    admin,
    handleSelector,
    isSelectorToken: (value) => Boolean(parseSelectorToken(value)),
    verifyLegacySelection: ({ tenant, sessionId, formKey }) => authority.resolveFormSelection({ tenant: authorityTenant(tenant), sessionId, formKey }),
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

export const __test = { deliverSelectorToOrigin, groupRecipientRegistry, requiresFinanceMembership, selectorMessage, selectorSessionCookie };

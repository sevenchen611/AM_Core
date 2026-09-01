import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createFinanceClaimsV3Pool } from './postgres.js';

export const FINANCE_CLAIMS_V3_APPROVAL_CONTRACT = 'finance-claims-v3.approval-v1';
export const FINANCE_CLAIMS_V3_ACK_CONTRACT = 'finance-claims-v3.notification-ack-v1';
export const FINANCE_CLAIMS_V3_AM_BRIDGE_CONTRACT = 'finance-claims-v3.am-bridge-v1';
export const FINANCE_CLAIMS_V3_AM_BRIDGE_CAPABILITIES_CONTRACT = 'finance-claims-v3.am-bridge-capabilities-v1';
export const FINANCE_CLAIMS_V3_RECEIVER_CAPABILITY_CONTRACT = 'finance-claims-v3.am-receiver-capabilities-v1';
export const FINANCE_CLAIMS_V3_GROUP_ENTRY_CONTRACT = 'finance-claims-v3.group-entry-v1';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SOURCE_HINT_AGE_SECONDS = 10 * 60;
// Rental's first D1-backed membership/web-entry request can legitimately spend
// more than 10 seconds warming and ensuring its idempotent schema. This runs in
// the durable background drainer, after the LINE webhook has already been
// acknowledged, so allow the upstream operation to complete instead of
// repeatedly classifying a successful write as uncertain.
const BRIDGE_UPSTREAM_TIMEOUT_MS = 35_000;
const LEASE_SECONDS = 45;
const PROVIDER_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,239}$/;
const OPAQUE_LINE_REFERENCE = /^line-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_ACK_REFERENCE = /^line-ack:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_LINE_TARGET = /^[UCR][A-Za-z0-9_-]{20,100}$/;
const AMBIGUOUS_PROVIDER_STATUSES = new Set([408, 425, 429]);
const TEMPLATE_RULES = new Map([
  ['claim_submitted', { recipient: 'group_binding', events: new Set(['claim_submitted_group']) }],
  ['approval_pending', { recipient: 'line_user', events: new Set(['first_approval_pending', 'second_approval_pending']) }],
  ['classification_needs_attention', { recipient: 'line_user', events: new Set(['first_approval_pending']) }],
  ['second_approval_pending', { recipient: 'line_user', events: new Set(['second_approval_pending']) }],
  ['claim_finally_approved', { recipient: 'line_user', events: new Set(['claim_finally_approved']) }],
  ['claim_rejected', { recipient: 'line_user', events: new Set(['claim_rejected']) }],
  ['claim_needs_info', { recipient: 'line_user', events: new Set(['claim_needs_info']) }],
  ['payment_date_changed', { recipient: 'line_user', events: new Set(['payment_date_changed']) }],
  ['payment_exception', { recipient: 'line_user', events: new Set(['payment_date_changed']) }],
  ['claim_web_entry', { recipient: 'group_binding', events: new Set(['claim_web_entry']), contract: FINANCE_CLAIMS_V3_GROUP_ENTRY_CONTRACT }],
  ['claim_web_entry_test', { recipient: 'group_binding', events: new Set(['claim_web_entry']), contract: FINANCE_CLAIMS_V3_GROUP_ENTRY_CONTRACT }],
]);
const PAYLOAD_KEYS = new Set([
  'contractVersion', 'eventKey', 'eventType', 'claimId', 'revisionNo', 'amountTotal', 'currency',
  'approvalStages', 'stage', 'needsOwnerAttention', 'paymentScheduleMode', 'tentativeScheduledPaymentDate',
  'trustedTentativeScheduleRef', 'trustedTentativeScheduleHash', 'scheduledPaymentDate', 'paymentScheduleHash',
  'paymentDateStatus', 'reason', 'oldDate', 'newDate', 'paymentException', 'rescheduleRequired',
]);
const localServicesByEnv = new WeakMap();

export function getFinanceClaimsV3LocalService(env) {
  return env && typeof env === 'object' ? localServicesByEnv.get(env) || null : null;
}

export function createFinanceClaimsV3Receiver({
  env = process.env,
  fetchImpl = globalThis.fetch,
  store = null,
  now = () => Date.now(),
} = {}) {
  let activeStore = store;
  const trustedLocalRequests = new WeakSet();

  function receiverEnabled() {
    return env.HOZO_FINANCE_CLAIMS_V3_ENABLED === 'true';
  }

  function bridgeEnabled() {
    return receiverEnabled() && env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_ENABLED === 'true';
  }

  async function handle(req, res, pathname) {
    try {
      if (pathname === '/control/finance/claims-v3/capabilities') {
        return await handleCapabilities(req, res);
      }
      if (pathname === '/control/finance/claim-events/v3' || pathname.startsWith('/control/finance/claim-events/v3/')) {
        return await handleDelivery(req, res, pathname);
      }
      if (pathname === '/control/finance/claims-v3/bridge-capabilities' || pathname === '/control/finance/claims-v3/memberships' || pathname === '/control/finance/claims-v3/web-entry') {
        return await handleBridge(req, res, pathname);
      }
      return false;
    } catch {
      if (!res.headersSent) return sendJson(res, 503, errorBody('receiver_unavailable'));
      if (!res.writableEnded) res.end();
      return true;
    }
  }

  async function handleCapabilities(req, res) {
    if (!receiverEnabled()) return sendJson(res, 503, errorBody('receiver_disabled'));
    if (!trustedLocalRequests.has(req) && !authorized(req, env.HOZO_FINANCE_CLAIMS_V3_RECEIVER_TOKEN)) return sendJson(res, 401, errorBody('machine_auth_required'));
    if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, errorBody('method_not_allowed'));
    const bindings = readBindings(env);
    if (!bindings.valid || !String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()) return sendJson(res, 503, errorBody('receiver_readiness_unavailable'));
    if (!(await getStore())) return sendJson(res, 503, errorBody('receiver_readiness_unavailable'));
    const bridgeReady = bridgeEnabled()
      && String(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_CONTROL_TOKEN || '').length >= 32
      && String(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_MACHINE_TOKEN || '').length >= 32
      && Boolean(safeHttpsBase(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL));
    const payload = {
      contractVersion: FINANCE_CLAIMS_V3_RECEIVER_CAPABILITY_CONTRACT,
      capabilities: {
        providerAcceptedAck: true,
        replayedAck: true,
        reconcile: true,
        groupBinding: true,
        lineUser: true,
        membershipBridge: bridgeReady,
        webEntryBridge: bridgeReady,
      },
      notificationAckContract: FINANCE_CLAIMS_V3_ACK_CONTRACT,
      configuredTenantCount: bindings.tenants.size,
      configuredRecipientCount: bindings.byReference.size,
    };
    if (req.method === 'HEAD') return sendNoContent(res, 200);
    return sendJson(res, 200, payload);
  }

  async function handleDelivery(req, res, pathname) {
    if (!receiverEnabled()) return sendJson(res, 503, errorBody('receiver_disabled'));
    if (!trustedLocalRequests.has(req) && !authorized(req, env.HOZO_FINANCE_CLAIMS_V3_RECEIVER_TOKEN)) return sendJson(res, 401, errorBody('machine_auth_required'));
    const bindings = readBindings(env);
    if (!bindings.valid) return sendJson(res, 503, errorBody('recipient_bindings_unavailable'));

    if (req.method === 'POST' && pathname === '/control/finance/claim-events/v3') {
      const tenantKey = reconcileTenantKey(req, bindings.tenants);
      if (!tenantKey) return sendJson(res, 400, errorBody('invalid_tenant_scope'));
      let body;
      try { body = await readJsonBody(req); } catch (error) { return sendJson(res, error.statusCode || 400, errorBody(error.code || 'invalid_json')); }
      const parsed = parseDelivery(body, bindings, env, now());
      if (!parsed.ok) return sendJson(res, parsed.status, errorBody(parsed.code));
      if (parsed.binding.tenantKey !== tenantKey) return sendJson(res, 400, errorBody('invalid_tenant_scope'));
      // Defence in depth at the durable boundary: an opaque reference, never a
      // raw LINE target, is the only recipient identity permitted in the ledger.
      if (!safeIdentityReference(body.recipient.identityReference)
        || body.recipient.identityReference === parsed.binding.target
        || looksLikeRawLineTarget(body.recipient.identityReference)) {
        return sendJson(res, 400, errorBody('invalid_recipient'));
      }
      const ledger = await getStore();
      if (!ledger) return sendJson(res, 503, errorBody('durable_ledger_unavailable'));
      const requestJson = stableJson(body);
      const requestHash = sha256(requestJson);
      const targetHash = sha256(`${parsed.binding.tenantKey}:${parsed.binding.type}:${parsed.binding.target}`);
      const retryKey = stableRetryKey(parsed.binding.tenantKey, body.eventKey);
      const leaseToken = randomUUID();
      const messageText = renderTemplate(body.templateKey, body.payload);
      const claim = await ledger.beginDispatch({
        tenantKey: parsed.binding.tenantKey,
        eventKey: body.eventKey,
        requestHash,
        requestJson,
        recipientType: parsed.binding.type,
        recipientReference: body.recipient.identityReference,
        targetHash,
        eventType: body.eventType,
        templateKey: body.templateKey,
        retryKey,
        leaseToken,
        messageText,
        leaseSeconds: LEASE_SECONDS,
      });
      if (claim.kind === 'mismatch') return sendJson(res, 409, errorBody('idempotency_mismatch'));
      if (claim.kind === 'delivered') return sendStoredDeliveryAck(res, body.eventKey, 'replayed', claim.row);
      if (claim.kind !== 'claimed') return sendJson(res, 409, errorBody('reconciliation_required', { status: publicStatus(claim.row?.status) }));
      return dispatchClaim({ ledger, row: claim.row, binding: parsed.binding, fetchImpl, env, res, ackKind: 'providerAccepted', now });
    }

    if (req.method === 'GET' && pathname.startsWith('/control/finance/claim-events/v3/')) {
      const eventKey = decodeEventKey(pathname.slice('/control/finance/claim-events/v3/'.length));
      if (!eventKey) return sendJson(res, 400, errorBody('invalid_event_key'));
      const tenantKey = reconcileTenantKey(req, bindings.tenants);
      if (!tenantKey) return sendJson(res, 400, errorBody('invalid_tenant_scope'));
      const ledger = await getStore();
      if (!ledger) return sendJson(res, 503, errorBody('durable_ledger_unavailable'));
      const row = await ledger.getByEventKey(tenantKey, eventKey);
      if (!row) return sendJson(res, 404, errorBody('event_not_found'));
      if (row.status === 'delivered') return sendStoredDeliveryAck(res, eventKey, 'replayed', row);
      if (row.status === 'failed') return sendJson(res, 409, errorBody('delivery_failed', { status: 'failed' }));
      const createdAt = Date.parse(row.created_at);
      if (!Number.isFinite(createdAt) || Date.now() - createdAt >= PROVIDER_RETRY_WINDOW_MS) {
        return sendJson(res, 409, errorBody('manual_reconciliation_required', { status: 'uncertain' }));
      }
      const binding = bindings.byReference.get(row.recipient_reference);
      if (!binding || binding.tenantKey !== row.tenant_key || binding.type !== row.recipient_type || sha256(`${binding.tenantKey}:${binding.type}:${binding.target}`) !== row.target_hash) {
        return sendJson(res, 409, errorBody('recipient_binding_changed', { status: 'uncertain' }));
      }
      const claim = await ledger.claimReconcile(tenantKey, eventKey, LEASE_SECONDS);
      if (claim.kind === 'delivered') return sendStoredDeliveryAck(res, eventKey, 'replayed', claim.row);
      if (claim.kind !== 'claimed') return sendJson(res, 409, errorBody('reconciliation_in_progress', { status: publicStatus(claim.row?.status) }));
      return dispatchClaim({ ledger, row: claim.row, binding, fetchImpl, env, res, ackKind: 'replayed', now });
    }

    return sendJson(res, 405, errorBody('method_not_allowed'));
  }

  async function handleBridge(req, res, pathname) {
    if (!bridgeEnabled()) return sendJson(res, 503, errorBody('bridge_disabled'));
    if (!trustedLocalRequests.has(req) && !authorized(req, env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_CONTROL_TOKEN)) return sendJson(res, 401, errorBody('machine_auth_required'));
    const kind = pathname.endsWith('/bridge-capabilities') ? 'capability' : pathname.endsWith('/memberships') ? 'membership' : 'web_entry';
    if ((kind === 'capability' && req.method !== 'GET') || (kind !== 'capability' && req.method !== 'POST')) return sendJson(res, 405, errorBody('method_not_allowed'));
    const baseUrl = safeHttpsBase(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL);
    const machineToken = String(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_MACHINE_TOKEN || '');
    if (!baseUrl || machineToken.length < 32) return sendJson(res, 503, errorBody('bridge_upstream_unavailable'));
    let body = null; let upstreamBody = null;
    if (kind !== 'capability') {
      const bindings = readBindings(env);
      if (!bindings.valid) return sendJson(res, 503, errorBody('recipient_bindings_unavailable'));
      try { body = await readJsonBody(req); } catch (error) { return sendJson(res, error.statusCode || 400, errorBody(error.code || 'invalid_json')); }
      const parsed = parseBridge(body, kind, bindings);
      if (!parsed.ok) return sendJson(res, parsed.status, errorBody(parsed.code));
      upstreamBody = kind === 'membership'
        ? { contractVersion: body.contractVersion, requestId: body.requestId, tenantKey: body.tenantKey, sourceId: body.sourceId, lineUserId: parsed.binding.target, desiredState: body.desiredState, eventSequence: body.eventSequence, effectiveAt: body.effectiveAt }
        : { contractVersion: body.contractVersion, requestId: body.requestId, tenantKey: body.tenantKey, sourceId: body.sourceId, formKey: body.formKey, lineUserId: parsed.binding.target };
    }
    const upstreamPath = `/api/integrations/finance/claims-v3/am-bridge/${kind === 'capability' ? 'capabilities' : kind === 'membership' ? 'memberships' : 'web-entry'}`;
    const upstreamUrl = new URL(upstreamPath, baseUrl);
    let response;
    try {
      response = await fetchImpl(upstreamUrl, {
        method: kind === 'capability' ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${machineToken}`, ...(kind === 'capability' ? {} : { 'content-type': 'application/json', 'idempotency-key': body.requestId }) },
        body: upstreamBody ? stableJson(upstreamBody) : undefined,
        signal: AbortSignal.timeout(BRIDGE_UPSTREAM_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      return sendJson(res, 503, errorBody('bridge_upstream_uncertain'));
    }
    if (response.redirected || response.url !== upstreamUrl.toString()) {
      await response.body?.cancel().catch(() => {});
      return sendJson(res, 502, errorBody('bridge_upstream_invalid'));
    }
    if ((kind === 'capability' && response.status !== 200)
      || (kind !== 'capability' && response.status !== 200 && response.status !== 409)) {
      await response.body?.cancel().catch(() => {});
      return sendJson(res, 502, errorBody('bridge_upstream_rejected'));
    }
    let responseText;
    try { responseText = await readResponseText(response, 32 * 1024); } catch { return sendJson(res, 502, errorBody('bridge_upstream_invalid')); }
    let responseBody;
    try { responseBody = strictJsonParse(responseText); } catch { return sendJson(res, 502, errorBody('bridge_upstream_invalid')); }
    const sanitized = kind === 'capability'
      ? sanitizeBridgeCapabilities(responseBody)
      : sanitizeBridgeResponse(responseBody, {
        kind, requestId: body.requestId, desiredState: body.desiredState, baseUrl, responseStatus: response.status, nowMs: now(),
      });
    if (!sanitized) return sendJson(res, 502, errorBody('bridge_upstream_invalid'));
    return sendJson(res, response.status === 409 ? 409 : 200, sanitized);
  }

  async function getStore() {
    if (activeStore) {
      await activeStore.init?.();
      return activeStore;
    }
    const databaseUrl = String(env.DATABASE_URL || '').trim();
    if (!databaseUrl) return null;
    activeStore = createPostgresFinanceClaimsV3Store(databaseUrl);
    await activeStore.init();
    return activeStore;
  }

  async function invokeLocal({ method, pathname, tenantKey = '', body = null }) {
    const encodedBody = body == null ? '' : JSON.stringify(body);
    const req = {
      method,
      headers: tenantKey ? { 'x-finance-claim-tenant-key': tenantKey } : {},
      async *[Symbol.asyncIterator]() {
        if (encodedBody) yield Buffer.from(encodedBody, 'utf8');
      },
    };
    let status = 500;
    let responseText = '';
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead(nextStatus) {
        status = Number(nextStatus);
        this.headersSent = true;
      },
      end(value = '') {
        responseText += value == null ? '' : String(value);
        this.writableEnded = true;
      },
    };
    trustedLocalRequests.add(req);
    const handled = await handle(req, res, pathname);
    if (!handled || !res.writableEnded) return { status: 500, body: null, invalidBody: true };
    if (!responseText) return { status, body: null, invalidBody: false };
    try {
      return { status, body: strictJsonParse(responseText), invalidBody: false };
    } catch {
      return { status, body: null, invalidBody: true };
    }
  }

  const service = {
    init: async () => Boolean(await getStore()),
    handle,
    receiverEnabled,
    bridgeEnabled,
    deliverEnvelope: (body, { tenantKey } = {}) => invokeLocal({
      method: 'POST', pathname: '/control/finance/claim-events/v3', tenantKey, body,
    }),
    reconcileEvent: (eventKey, { tenantKey } = {}) => invokeLocal({
      method: 'GET', pathname: `/control/finance/claim-events/v3/${encodeURIComponent(eventKey)}`, tenantKey,
    }),
    bridgeMembership: (body) => invokeLocal({
      method: 'POST', pathname: '/control/finance/claims-v3/memberships', body,
    }),
    bridgeWebEntry: (body) => invokeLocal({
      method: 'POST', pathname: '/control/finance/claims-v3/web-entry', body,
    }),
  };
  if (env && typeof env === 'object') localServicesByEnv.set(env, service);
  return service;
}

export function createPostgresFinanceClaimsV3Store(databaseUrl, { pool: injectedPool = null } = {}) {
  const pool = injectedPool || createFinanceClaimsV3Pool(databaseUrl);
  let initialized = false;
  return {
    async init() {
      if (initialized) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS finance_claim_delivery_v3 (
          tenant_key TEXT NOT NULL,
          event_key TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          request_json JSONB NOT NULL,
          recipient_type TEXT NOT NULL CHECK (recipient_type IN ('group_binding','line_user')),
          recipient_reference TEXT NOT NULL,
          target_hash TEXT NOT NULL,
          event_type TEXT NOT NULL,
          template_key TEXT NOT NULL,
          retry_key UUID NOT NULL,
          lease_token UUID NOT NULL,
          message_text TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('dispatching','uncertain','reconciling','delivered','failed')),
          provider_reference TEXT NOT NULL DEFAULT '',
          provider_response_hash TEXT NOT NULL DEFAULT '',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          lease_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          delivered_at TIMESTAMPTZ,
          PRIMARY KEY (tenant_key,event_key)
        )
      `);
      await pool.query('ALTER TABLE finance_claim_delivery_v3 DROP CONSTRAINT IF EXISTS finance_claim_delivery_v3_event_key_key');
      await pool.query(`UPDATE finance_claim_delivery_v3 SET provider_reference='line-ack:v1:'||retry_key::text,updated_at=now()
        WHERE status='delivered' AND provider_reference<>'line-ack:v1:'||retry_key::text`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_finance_claim_delivery_v3_status ON finance_claim_delivery_v3(status,lease_until,updated_at)');
      initialized = true;
    },
    async beginDispatch(record) {
      const result = await pool.query(`
        INSERT INTO finance_claim_delivery_v3
          (tenant_key,event_key,request_hash,request_json,recipient_type,recipient_reference,target_hash,event_type,template_key,retry_key,lease_token,message_text,status,attempts,lease_until)
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,'dispatching',1,now()+($13||' seconds')::interval)
        ON CONFLICT (tenant_key,event_key) DO NOTHING RETURNING *`,
      [record.tenantKey, record.eventKey, record.requestHash, record.requestJson, record.recipientType, record.recipientReference, record.targetHash, record.eventType, record.templateKey, record.retryKey, record.leaseToken, record.messageText, String(record.leaseSeconds)]);
      if (result.rows[0]) return { kind: 'claimed', row: result.rows[0] };
      const existing = (await pool.query('SELECT * FROM finance_claim_delivery_v3 WHERE tenant_key=$1 AND event_key=$2 LIMIT 1', [record.tenantKey, record.eventKey])).rows[0];
      if (!existing || !safeEqual(existing.request_hash, record.requestHash)) return { kind: 'mismatch', row: existing };
      return { kind: existing.status === 'delivered' ? 'delivered' : 'existing', row: existing };
    },
    async getByEventKey(tenantKey, eventKey) {
      return (await pool.query('SELECT * FROM finance_claim_delivery_v3 WHERE tenant_key=$1 AND event_key=$2 LIMIT 1', [tenantKey, eventKey])).rows[0] || null;
    },
    async claimReconcile(tenantKey, eventKey, leaseSeconds) {
      const leaseToken = randomUUID();
      const result = await pool.query(`UPDATE finance_claim_delivery_v3 SET status='reconciling',attempts=attempts+1,lease_token=$4,lease_until=now()+($3||' seconds')::interval,updated_at=now()
        WHERE tenant_key=$1 AND event_key=$2 AND ((status='uncertain' AND (lease_until IS NULL OR lease_until<=now())) OR (status IN ('dispatching','reconciling') AND lease_until<=now())) RETURNING *`, [tenantKey, eventKey, String(leaseSeconds), leaseToken]);
      if (result.rows[0]) return { kind: 'claimed', row: result.rows[0] };
      const row = (await pool.query('SELECT * FROM finance_claim_delivery_v3 WHERE tenant_key=$1 AND event_key=$2 LIMIT 1', [tenantKey, eventKey])).rows[0] || null;
      return { kind: row?.status === 'delivered' ? 'delivered' : 'existing', row };
    },
    async markUncertain(row, code, retryAfterSeconds = 0) {
      const result = await pool.query(`UPDATE finance_claim_delivery_v3 SET status='uncertain',last_error=$4,
        lease_until=CASE WHEN $5::integer>0 THEN now()+($5||' seconds')::interval ELSE NULL END,updated_at=now()
        WHERE tenant_key=$1 AND event_key=$2 AND lease_token=$3 AND status IN ('dispatching','reconciling') RETURNING event_key`, [row.tenant_key, row.event_key, row.lease_token, clamp(code, 120), String(retryAfterSeconds)]);
      return Boolean(result.rows[0]);
    },
    async markFailed(row, code, responseHash = '') {
      const result = await pool.query(`UPDATE finance_claim_delivery_v3 SET status='failed',last_error=$4,provider_response_hash=$5,lease_until=NULL,updated_at=now()
        WHERE tenant_key=$1 AND event_key=$2 AND lease_token=$3 AND status IN ('dispatching','reconciling') RETURNING event_key`, [row.tenant_key, row.event_key, row.lease_token, clamp(code, 120), responseHash]);
      return Boolean(result.rows[0]);
    },
    async markDelivered(row, responseHash) {
      const result = await pool.query(`UPDATE finance_claim_delivery_v3 SET status='delivered',provider_reference='line-ack:v1:'||retry_key::text,provider_response_hash=$4,last_error='',lease_until=NULL,updated_at=now(),delivered_at=now()
        WHERE tenant_key=$1 AND event_key=$2 AND lease_token=$3 AND status IN ('dispatching','reconciling') RETURNING *`, [row.tenant_key, row.event_key, row.lease_token, responseHash]);
      return result.rows[0] || null;
    },
  };
}

async function dispatchClaim({ ledger, row, binding, fetchImpl, env, res, ackKind, now }) {
  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!token) {
    const failed = await ledger.markFailed(row, 'line_provider_unavailable');
    return sendJson(res, 503, errorBody(failed ? 'line_provider_unavailable' : 'delivery_uncertain', { status: failed ? 'failed' : 'uncertain' }));
  }
  let response;
  try {
    response = await fetchImpl(LINE_PUSH_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-line-retry-key': row.retry_key },
      body: JSON.stringify({ to: binding.target, messages: [{ type: 'text', text: row.message_text }] }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    await ledger.markUncertain(row, 'provider_uncertain');
    return sendJson(res, 503, errorBody('delivery_uncertain', { status: 'uncertain' }));
  }
  if (response.redirected || response.url !== LINE_PUSH_URL) {
    await response.body?.cancel().catch(() => {});
    await ledger.markUncertain(row, 'provider_redirect_uncertain');
    return sendJson(res, 503, errorBody('delivery_uncertain', { status: 'uncertain' }));
  }
  let text;
  try { text = await readResponseText(response, 16 * 1024); } catch {
    await ledger.markUncertain(row, 'provider_response_unreadable');
    return sendJson(res, 503, errorBody('delivery_uncertain', { status: 'uncertain' }));
  }
  const responseHash = sha256(text);
  const acceptedEvidence = safeProviderEvidence(response.headers.get('x-line-request-id'));
  const replayedEvidence = safeProviderEvidence(response.headers.get('x-line-accepted-request-id'));
  const providerAccepted = response.status === 200 ? Boolean(acceptedEvidence) : response.status === 409 ? Boolean(replayedEvidence) : false;
  if (!providerAccepted) {
    if (AMBIGUOUS_PROVIDER_STATUSES.has(response.status)) {
      const retryAfterSeconds = response.status === 429 ? parseRetryAfterSeconds(response.headers.get('retry-after'), now()) : 0;
      await ledger.markUncertain(row, `provider_ambiguous_${response.status}`, retryAfterSeconds);
      return sendJson(res, 503, errorBody('delivery_uncertain', { status: 'uncertain' }));
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 409) {
      const failed = await ledger.markFailed(row, `provider_rejected_${response.status}`, responseHash);
      return sendJson(res, failed ? 502 : 503, errorBody(failed ? 'provider_rejected' : 'delivery_uncertain', { status: failed ? 'failed' : 'uncertain' }));
    }
    await ledger.markUncertain(row, 'provider_uncertain');
    return sendJson(res, 503, errorBody('delivery_uncertain', { status: 'uncertain' }));
  }
  let delivered;
  try {
    delivered = await ledger.markDelivered(row, responseHash);
  } catch {
    // Provider acceptance is already possible. Preserve the attempt for GET
    // reconciliation; never issue an automatic second push from this POST.
    try { await ledger.markUncertain(row, 'finalize_uncertain'); } catch { /* stale lease is safely reclaimed */ }
    return sendJson(res, 503, errorBody('delivery_finalize_uncertain', { status: 'uncertain' }));
  }
  if (!delivered) {
    await ledger.markUncertain(row, 'finalize_uncertain');
    return sendJson(res, 503, errorBody('delivery_finalize_uncertain', { status: 'uncertain' }));
  }
  const providerReference = exactAckReference(delivered);
  if (!providerReference) return sendJson(res, 503, errorBody('delivery_evidence_invalid', { status: 'uncertain' }));
  const kind = response.status === 409 || ackKind === 'replayed' ? 'replayed' : 'providerAccepted';
  return sendJson(res, 200, deliveryAck(row.event_key, kind, providerReference));
}

function parseDelivery(body, bindings, env, nowMs) {
  if (!exactObject(body, ['contractVersion', 'eventKey', 'eventType', 'recipient', 'templateKey', 'payload'])) return invalid('invalid_contract');
  if (!safeId(body.eventKey) || !safeId(body.eventType) || !safeId(body.templateKey)) return invalid('invalid_contract');
  const rule = TEMPLATE_RULES.get(body.templateKey);
  const expectedContract = rule?.contract || FINANCE_CLAIMS_V3_APPROVAL_CONTRACT;
  if (!rule || body.contractVersion !== expectedContract) return invalid('invalid_contract');
  if (expectedContract === FINANCE_CLAIMS_V3_GROUP_ENTRY_CONTRACT && env.HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED !== 'true') return invalid('group_entry_disabled', 503);
  if (!exactObject(body.recipient, ['type', 'identityReference']) || !['group_binding', 'line_user'].includes(body.recipient.type) || !safeIdentityReference(body.recipient.identityReference)) return invalid('invalid_recipient');
  const binding = bindings.byReference.get(body.recipient.identityReference);
  if (!binding || binding.type !== body.recipient.type || !bindings.tenants.has(binding.tenantKey)) return invalid('recipient_not_allowlisted', 409);
  if (rule.recipient !== body.recipient.type || !rule.events.has(body.eventType)) return invalid('template_not_allowlisted', 409);
  if (!validPayload(body.payload, body.eventKey, body.eventType, expectedContract) || !validTemplatePayload(body.templateKey, body.eventType, body.payload, env, nowMs)) return invalid('invalid_payload');
  return { ok: true, binding };
}

function parseBridge(body, kind, bindings) {
  const keys = kind === 'membership'
    ? ['contractVersion', 'requestId', 'tenantKey', 'sourceId', 'identityReference', 'desiredState', 'eventSequence', 'effectiveAt']
    : ['contractVersion', 'requestId', 'tenantKey', 'sourceId', 'formKey', 'identityReference'];
  if (!exactObject(body, keys) || body.contractVersion !== FINANCE_CLAIMS_V3_AM_BRIDGE_CONTRACT || !safeId(body.requestId) || !safeId(body.tenantKey) || !safeId(body.sourceId) || !safeIdentityReference(body.identityReference)) return invalid('invalid_bridge_contract');
  if (kind === 'membership' && (!['active', 'revoked'].includes(body.desiredState) || !Number.isSafeInteger(body.eventSequence) || body.eventSequence < 1 || !Number.isFinite(Date.parse(body.effectiveAt)))) return invalid('invalid_bridge_contract');
  if (kind === 'web_entry' && !safeId(body.formKey)) return invalid('invalid_bridge_contract');
  const binding = bindings.byReference.get(body.identityReference);
  if (!binding || binding.type !== 'line_user' || binding.tenantKey !== body.tenantKey || !bindings.tenants.has(body.tenantKey)) return invalid('identity_not_allowlisted', 409);
  return { ok: true, binding };
}

function validPayload(payload, eventKey, eventType, contractVersion = FINANCE_CLAIMS_V3_APPROVAL_CONTRACT) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return false;
  if (contractVersion === FINANCE_CLAIMS_V3_GROUP_ENTRY_CONTRACT) {
    return (exactObject(payload, ['contractVersion', 'eventKey', 'eventType', 'entryUrl', 'expiresAt'])
      || exactObject(payload, ['contractVersion', 'eventKey', 'eventType', 'entryUrl', 'expiresAt', 'testMode']))
      && payload.contractVersion === contractVersion && payload.eventKey === eventKey && payload.eventType === eventType;
  }
  if (Object.keys(payload).some((key) => !PAYLOAD_KEYS.has(key))) return false;
  if (payload.contractVersion !== contractVersion || payload.eventKey !== eventKey || payload.eventType !== eventType) return false;
  if (!safeId(payload.claimId) || !Number.isSafeInteger(payload.revisionNo) || payload.revisionNo < 1 || !Number.isSafeInteger(payload.amountTotal) || payload.amountTotal < 0) return false;
  if (!/^[A-Z]{3}$/.test(String(payload.currency || ''))) return false;
  if (payload.approvalStages != null && ![1, 2].includes(payload.approvalStages)) return false;
  if (payload.stage != null && ![1, 2].includes(payload.stage)) return false;
  if (payload.needsOwnerAttention != null && typeof payload.needsOwnerAttention !== 'boolean') return false;
  if (payload.rescheduleRequired != null && typeof payload.rescheduleRequired !== 'boolean') return false;
  if (payload.paymentScheduleMode != null && !['if_approved_today', 'final_approval_date'].includes(payload.paymentScheduleMode)) return false;
  if (payload.paymentDateStatus != null && payload.paymentDateStatus !== 'not_applicable') return false;
  if (payload.paymentException != null && payload.paymentException !== 'provider_returned') return false;
  for (const key of ['oldDate', 'newDate', 'scheduledPaymentDate', 'tentativeScheduledPaymentDate']) {
    if (payload[key] != null && payload[key] !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(payload[key])) return false;
  }
  for (const key of ['reason', 'oldDate', 'newDate', 'paymentException', 'paymentScheduleMode', 'paymentDateStatus', 'scheduledPaymentDate', 'tentativeScheduledPaymentDate', 'trustedTentativeScheduleRef', 'trustedTentativeScheduleHash', 'paymentScheduleHash']) {
    if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > 500)) return false;
  }
  return true;
}

function validTemplatePayload(templateKey, eventType, payload, env, nowMs) {
  if (templateKey === 'claim_web_entry' || templateKey === 'claim_web_entry_test') {
    const production = templateKey === 'claim_web_entry';
    if (!(production ? exactObject(payload, ['contractVersion', 'eventKey', 'eventType', 'entryUrl', 'expiresAt']) : exactObject(payload, ['contractVersion', 'eventKey', 'eventType', 'entryUrl', 'expiresAt', 'testMode']))
      || (!production && payload.testMode !== true) || eventType !== 'claim_web_entry') return false;
    const base = safeHttpsBase(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL); let url;
    try { url = new URL(payload.entryUrl); } catch { return false; }
    const expires = Date.parse(payload.expiresAt);
    return Boolean(base && url.origin === base.origin && url.pathname === '/finance-claims' && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].length === 1 && url.searchParams.getAll('sourceHint').length === 1 && safeSourceHint(url.searchParams.get('sourceHint'))
      && typeof payload.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.expiresAt)
      && Number.isFinite(expires) && new Date(expires).toISOString() === payload.expiresAt && expires > nowMs && expires <= nowMs + MAX_SOURCE_HINT_AGE_SECONDS * 1000);
  }
  if (templateKey === 'claim_submitted') return [1, 2].includes(payload.approvalStages);
  if (['approval_pending', 'classification_needs_attention', 'second_approval_pending'].includes(templateKey)) {
    const expectedStage = eventType === 'second_approval_pending' ? 2 : 1;
    if (payload.stage !== expectedStage) return false;
    if (templateKey === 'classification_needs_attention' && payload.needsOwnerAttention !== true) return false;
    if (payload.paymentScheduleMode == null) return payload.tentativeScheduledPaymentDate == null && payload.trustedTentativeScheduleRef == null && payload.trustedTentativeScheduleHash == null;
    if (payload.paymentScheduleMode === 'final_approval_date') return payload.tentativeScheduledPaymentDate == null && payload.trustedTentativeScheduleRef == null && payload.trustedTentativeScheduleHash == null;
    return /^\d{4}-\d{2}-\d{2}$/.test(payload.tentativeScheduledPaymentDate || '')
      && safeId(payload.trustedTentativeScheduleRef)
      && /^[a-f0-9]{64}$/i.test(payload.trustedTentativeScheduleHash || '');
  }
  if (templateKey === 'claim_finally_approved') {
    return /^\d{4}-\d{2}-\d{2}$/.test(payload.scheduledPaymentDate || '')
      && /^[a-f0-9]{64}$/i.test(payload.paymentScheduleHash || '');
  }
  if (templateKey === 'claim_rejected' || templateKey === 'claim_needs_info') {
    return payload.paymentDateStatus === 'not_applicable' && typeof payload.reason === 'string' && payload.reason.trim().length > 0;
  }
  if (templateKey === 'payment_exception') {
    return /^\d{4}-\d{2}-\d{2}$/.test(payload.oldDate || '') && payload.newDate === ''
      && payload.paymentException === 'provider_returned' && payload.rescheduleRequired === true;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(payload.oldDate || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(payload.newDate || '')
    && typeof payload.reason === 'string' && payload.reason.trim().length > 0;
}

function renderTemplate(templateKey, payload) {
  if (templateKey === 'claim_web_entry') return `HOZO 費用申請\n請使用以下短效連結開啟申請頁（僅限本次申請人使用）：\n${payload.entryUrl}\n連結失效後，請回原群組重新輸入「請款」或「費用申請」。`;
  if (templateKey === 'claim_web_entry_test') return `【測試】HOZO 費用申請\n請使用以下短效連結開啟申請頁（僅限本次申請人使用）：\n${payload.entryUrl}\n連結失效後，請回原群組重新輸入「請款」或「費用申請」。`;
  const amount = `${payload.currency} ${Number(payload.amountTotal).toLocaleString('zh-TW')}`;
  if (templateKey === 'claim_submitted') return `HOZO 費用申請已成立\n金額：${amount}\n狀態：等待審核`;
  if (templateKey === 'approval_pending' || templateKey === 'classification_needs_attention' || templateKey === 'second_approval_pending') {
    const stage = Number(payload.stage) === 2 ? '第二層審核' : '第一層審核';
    const date = payload.tentativeScheduledPaymentDate ? `\n若今日核准，預計付款日：${clamp(payload.tentativeScheduledPaymentDate, 32)}` : '';
    const attention = payload.needsOwnerAttention ? '\n科目判斷需要人工確認。' : '';
    return `HOZO 費用申請待${stage}\n金額：${amount}${date}${attention}`;
  }
  if (templateKey === 'claim_finally_approved') return `HOZO 費用申請已核准\n金額：${amount}\n預計付款日：${clamp(payload.scheduledPaymentDate || '待確認', 32)}`;
  if (templateKey === 'claim_rejected') return `HOZO 費用申請已退回\n金額：${amount}\n預計付款日期：不適用`;
  if (templateKey === 'claim_needs_info') return `HOZO 費用申請需要補充資料\n金額：${amount}\n預計付款日期：不適用`;
  if (templateKey === 'payment_exception') return `HOZO 付款狀態需要處理\n金額：${amount}\n系統將另行確認新的付款日期。`;
  return `HOZO 預計付款日期已更新\n金額：${amount}\n新預計付款日：${clamp(payload.newDate || '待確認', 32)}`;
}

function readBindings(env) {
  const byReference = new Map();
  const targets = new Set();
  const tenants = new Set(String(env.HOZO_FINANCE_CLAIMS_V3_ALLOWED_TENANTS || '').split(',').map((value) => value.trim()).filter(safeId));
  try {
    const parsed = JSON.parse(String(env.HOZO_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON || '{}'));
    if (!exactObject(parsed, ['bindings']) || !Array.isArray(parsed.bindings) || parsed.bindings.length > 1000) return { valid: false, byReference, tenants };
    for (const item of parsed.bindings) {
      const targetKey = `${item.tenantKey}:${item.type}:${item.target}`;
      if (!exactObject(item, ['identityReference', 'tenantKey', 'type', 'target']) || !safeIdentityReference(item.identityReference) || item.identityReference === item.target || looksLikeRawLineTarget(item.identityReference) || !safeId(item.tenantKey) || !tenants.has(item.tenantKey) || !['group_binding', 'line_user'].includes(item.type) || !validLineTarget(item.target, item.type) || byReference.has(item.identityReference) || targets.has(targetKey)) return { valid: false, byReference: new Map(), tenants };
      byReference.set(item.identityReference, { tenantKey: item.tenantKey, type: item.type, target: item.target });
      targets.add(targetKey);
    }
    return { valid: tenants.size > 0 && byReference.size > 0, byReference, tenants };
  } catch {
    return { valid: false, byReference, tenants };
  }
}

function validLineTarget(value, type) {
  const target = String(value || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(target)) return false;
  return type === 'line_user' ? target.startsWith('U') : target.startsWith('C') || target.startsWith('R');
}

function safeIdentityReference(value) {
  return typeof value === 'string' && OPAQUE_LINE_REFERENCE.test(value) && !looksLikeRawLineTarget(value);
}

function looksLikeRawLineTarget(value) {
  return RAW_LINE_TARGET.test(String(value || ''));
}

function parseRetryAfterSeconds(value, nowMs) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Math.min(3600, Math.max(1, Number.parseInt(text, 10)));
  const retryAt = Date.parse(text);
  if (Number.isFinite(retryAt)) return Math.min(3600, Math.max(1, Math.ceil((retryAt - nowMs) / 1000)));
  return 60;
}

function stableRetryKey(tenantKey, eventKey) {
  const hex = sha256(`finance-claims-v3:${tenantKey}:${eventKey}`).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function authorized(req, expectedValue) {
  const expected = String(expectedValue || '');
  const header = String(req.headers.authorization || '');
  const provided = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
  if (expected.length < 32 || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function safeProviderEvidence(value) {
  const text = String(value || '').trim();
  return SAFE_ID.test(text) && text.length <= 128 && !looksLikeRawLineTarget(text) && !text.startsWith('line-ack:') ? text : '';
}

function stableAckReference(retryKey) {
  const value = `line-ack:v1:${String(retryKey || '').toLowerCase()}`;
  return LINE_ACK_REFERENCE.test(value) ? value : '';
}

function safeAckReference(value) {
  const text = String(value || '').trim().toLowerCase();
  return LINE_ACK_REFERENCE.test(text) ? text : '';
}

function exactAckReference(row) {
  const stored = safeAckReference(row?.provider_reference);
  const expected = stableAckReference(row?.retry_key);
  return stored && expected && safeEqual(stored, expected) ? stored : '';
}

function decodeEventKey(value) {
  try { const decoded = decodeURIComponent(value); return safeId(decoded) ? decoded : ''; } catch { return ''; }
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function exactObject(value, keys) {
  return Boolean(value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}

function safeHttpsBase(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return new URL(url.origin);
  } catch { return null; }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { statusCode: 413, code: 'payload_too_large' });
    chunks.push(chunk);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return strictJsonParse(text);
  } catch { throw Object.assign(new Error('invalid json'), { statusCode: 400, code: 'invalid_json' }); }
}

export async function readResponseText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('response_too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let overflow = false;
  try {
    while (size <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes + 1 - size;
      chunks.push(chunk.subarray(0, remaining));
      size += Math.min(chunk.length, remaining);
      if (chunk.length > remaining || size > maxBytes) {
        overflow = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (overflow) throw new Error('response_too_large');
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
}

export function strictJsonParse(text) {
  const source = String(text);
  let offset = 0;
  const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const whitespace = () => { while (offset < source.length && /[\x20\x09\x0a\x0d]/.test(source[offset])) offset++; };
  const parseString = () => {
    if (source[offset] !== '"') throw new SyntaxError('expected_string');
    const start = offset++;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset++;
        return JSON.parse(source.slice(start, offset));
      }
      if (code < 0x20) throw new SyntaxError('control_character');
      if (code === 0x5c) {
        offset++;
        if (offset >= source.length || !/["\\/bfnrtu]/.test(source[offset])) throw new SyntaxError('invalid_escape');
        if (source[offset] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) throw new SyntaxError('invalid_unicode_escape');
          offset += 4;
        }
      }
      offset++;
    }
    throw new SyntaxError('unterminated_string');
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) throw new SyntaxError('json_too_deep');
    whitespace();
    const marker = source[offset];
    if (marker === '"') return parseString();
    if (marker === '{') {
      offset++; whitespace();
      const result = Object.create(null); const seen = new Set();
      if (source[offset] === '}') { offset++; return result; }
      while (offset < source.length) {
        const key = parseString();
        if (forbiddenKeys.has(key) || seen.has(key)) throw new SyntaxError('unsafe_or_duplicate_key');
        seen.add(key); whitespace();
        if (source[offset++] !== ':') throw new SyntaxError('expected_colon');
        result[key] = parseValue(depth + 1); whitespace();
        if (source[offset] === '}') { offset++; return result; }
        if (source[offset++] !== ',') throw new SyntaxError('expected_comma');
        whitespace();
      }
      throw new SyntaxError('unterminated_object');
    }
    if (marker === '[') {
      offset++; whitespace();
      const result = [];
      if (source[offset] === ']') { offset++; return result; }
      while (offset < source.length) {
        result.push(parseValue(depth + 1)); whitespace();
        if (source[offset] === ']') { offset++; return result; }
        if (source[offset++] !== ',') throw new SyntaxError('expected_comma');
        whitespace();
      }
      throw new SyntaxError('unterminated_array');
    }
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return value; }
    }
    const match = source.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new SyntaxError('invalid_value');
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new SyntaxError('non_finite_number');
    return value;
  };
  const result = parseValue(); whitespace();
  if (offset !== source.length) throw new SyntaxError('trailing_content');
  return result;
}

function sanitizeBridgeResponse(value, { kind, requestId, desiredState, baseUrl, responseStatus, nowMs }) {
  if (responseStatus === 409) {
    const allowedCodes = kind === 'membership'
      ? new Set(['idempotency_mismatch', 'source_scope_unavailable', 'stale_membership_event', 'membership_sync_conflict'])
      : new Set(['idempotency_mismatch', 'entry_scope_unavailable', 'web_entry_conflict']);
    if (!exactObject(value, ['error', 'code']) || typeof value.error !== 'string' || !allowedCodes.has(value.code)) return null;
    return { contractVersion: FINANCE_CLAIMS_V3_AM_BRIDGE_CONTRACT, code: value.code };
  }
  if (responseStatus !== 200 || value?.contractVersion !== FINANCE_CLAIMS_V3_AM_BRIDGE_CONTRACT || value.requestId !== requestId || typeof value.replayed !== 'boolean') return null;
  if (kind === 'membership') {
    if (!exactObject(value, ['contractVersion', 'requestId', 'matched', 'desiredState', 'evidenceRecorded', 'effectiveState', 'replayed'])) return null;
    if (!['active', 'revoked'].includes(desiredState) || value.desiredState !== desiredState || typeof value.matched !== 'boolean' || typeof value.evidenceRecorded !== 'boolean' || !['active', 'revoked', 'pending'].includes(value.effectiveState)) return null;
    return { contractVersion: value.contractVersion, requestId, matched: value.matched, desiredState: value.desiredState, evidenceRecorded: value.evidenceRecorded, effectiveState: value.effectiveState, replayed: value.replayed };
  }
  if (!exactObject(value, ['contractVersion', 'requestId', 'url', 'expiresAt', 'replayed'])) return null;
  if (typeof value.url !== 'string' || value.url.includes('#')) return null;
  let entryUrl;
  try { entryUrl = new URL(value.url); } catch { return null; }
  const sourceHints = entryUrl.searchParams.getAll('sourceHint');
  if (typeof value.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt)) return null;
  const expiresAtMs = Date.parse(value.expiresAt);
  if (entryUrl.origin !== baseUrl.origin || entryUrl.pathname !== '/finance-claims' || entryUrl.username || entryUrl.password || entryUrl.hash
    || [...entryUrl.searchParams.keys()].length !== 1 || sourceHints.length !== 1 || !safeSourceHint(sourceHints[0])
    || !Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== value.expiresAt
    || expiresAtMs <= nowMs || expiresAtMs > nowMs + MAX_SOURCE_HINT_AGE_SECONDS * 1000) return null;
  return { contractVersion: value.contractVersion, requestId, url: entryUrl.toString(), expiresAt: value.expiresAt, replayed: value.replayed };
}

function safeSourceHint(value) {
  const hint = String(value || '');
  if (!/^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{43}$/.test(hint)) return false;
  return !/(?:^|[^A-Za-z0-9_-])[UCR][A-Za-z0-9_-]{32,99}(?:$|[^A-Za-z0-9_-])/.test(hint);
}

function reconcileTenantKey(req, allowedTenants) {
  const explicit = String(req.headers['x-finance-claim-tenant-key'] || '').trim();
  if (explicit) return safeId(explicit) && allowedTenants.has(explicit) ? explicit : '';
  return allowedTenants.size === 1 ? [...allowedTenants][0] : '';
}

function sanitizeBridgeCapabilities(value) {
  if (!exactObject(value, ['contractVersion', 'capabilities', 'notificationCapabilityContract', 'notificationAckContract', 'sourceHintMaxAgeSeconds'])
    || value.contractVersion !== FINANCE_CLAIMS_V3_AM_BRIDGE_CAPABILITIES_CONTRACT
    || !exactObject(value.capabilities, ['membershipSync', 'webEntry', 'notificationReceiverHandshake'])
    || typeof value.capabilities.membershipSync !== 'boolean' || typeof value.capabilities.webEntry !== 'boolean'
    || typeof value.capabilities.notificationReceiverHandshake !== 'boolean'
    || value.notificationCapabilityContract !== 'finance-claims-v3.notification-capability-v1'
    || value.notificationAckContract !== FINANCE_CLAIMS_V3_ACK_CONTRACT
    || !Number.isSafeInteger(value.sourceHintMaxAgeSeconds) || value.sourceHintMaxAgeSeconds < 1 || value.sourceHintMaxAgeSeconds > MAX_SOURCE_HINT_AGE_SECONDS) return null;
  return {
    contractVersion: FINANCE_CLAIMS_V3_AM_BRIDGE_CAPABILITIES_CONTRACT,
    capabilities: {
      membershipSync: value.capabilities.membershipSync,
      webEntry: value.capabilities.webEntry,
      notificationReceiverHandshake: value.capabilities.notificationReceiverHandshake,
    },
    notificationCapabilityContract: value.notificationCapabilityContract,
    notificationAckContract: value.notificationAckContract,
    sourceHintMaxAgeSeconds: value.sourceHintMaxAgeSeconds,
  };
}

function deliveryAck(eventKey, ackKind, providerReference) {
  return { contractVersion: FINANCE_CLAIMS_V3_ACK_CONTRACT, eventKey, status: 'delivered', ackKind, providerReference };
}

function sendStoredDeliveryAck(res, eventKey, ackKind, row) {
  const providerReference = exactAckReference(row);
  return providerReference
    ? sendJson(res, 200, deliveryAck(eventKey, ackKind, providerReference))
    : sendJson(res, 503, errorBody('delivery_evidence_invalid', { status: 'uncertain' }));
}

function errorBody(code, extra = {}) {
  return { contractVersion: FINANCE_CLAIMS_V3_ACK_CONTRACT, code, ...extra };
}

function invalid(code, status = 400) {
  return { ok: false, code, status };
}

function publicStatus(status) {
  return status === 'failed' ? 'failed' : status === 'delivered' ? 'delivered' : 'uncertain';
}

function clamp(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
  return true;
}

function sendNoContent(res, status) {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end();
  return true;
}

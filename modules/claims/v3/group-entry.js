import { createHash, createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createFinanceClaimsV3Receiver, getFinanceClaimsV3LocalService } from './receiver.js';

const ENTRY_CONTRACT = 'finance-claims-v3.group-entry-v1';
const BRIDGE_CONTRACT = 'finance-claims-v3.am-bridge-v1';
const ACK_CONTRACT = 'finance-claims-v3.notification-ack-v1';
const KEYWORDS = new Set(['請款', '費用申請']);
const OPAQUE_REFERENCE = /^line-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_TARGET = /^[UCR][A-Za-z0-9_-]{20,100}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,239}$/;
const ACTIVE_STATES = new Set(['pending_membership', 'membership_uncertain', 'pending_entry', 'entry_uncertain', 'pending_delivery', 'delivery_uncertain']);
const LEASE_SECONDS = 45;
const MAX_STEPS_PER_DRAIN = 20;

export function createFinanceClaimsV3GroupEntryConsumer({ env = process.env, store, client, receiver, now = () => Date.now(), autoDrain = true } = {}) {
  const config = readConfig(env);
  const activeStore = store || (config.enabled && env.DATABASE_URL ? createPostgresGroupEntryStore(env.DATABASE_URL) : null);
  const activeClient = client || createGroupEntryClient({ env, now, receiver });
  let initialized = false; let draining = false; let kickRequested = false; let retryPoller = null;

  async function init() {
    if (!config.enabled) return;
    if (!config.valid || !activeStore || !activeClient.ready) throw new Error('finance_group_entry_unavailable');
    await activeStore.init(); initialized = true;
    if (autoDrain) {
      retryPoller ||= setInterval(kick, 15_000);
      retryPoller.unref?.();
      kick();
    }
  }

  function partitionWebhook(body, originalRawBody = '') {
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!config.enabled) return { records: [], ordinaryEvents: events, ordinaryRawBody: originalRawBody || JSON.stringify({ ...body, events }), intercepted: 0 };
    const records = []; const ordinaryEvents = []; let intercepted = 0;
    for (const event of events) {
      const routed = routeEvent(event, config);
      if (!routed.intercepted) ordinaryEvents.push(event);
      else {
        intercepted++;
        records.push(...routed.records);
      }
    }
    return { records, ordinaryEvents, ordinaryRawBody: intercepted > 0 ? JSON.stringify({ ...body, events: ordinaryEvents }) : (originalRawBody || JSON.stringify({ ...body, events })), intercepted };
  }

  async function enqueue(records) {
    if (!config.enabled || !initialized) throw new Error('finance_group_entry_unavailable');
    const rows = [];
    for (const record of records) {
      const row = await activeStore.enqueue(record);
      if (row?.inserted === false && !sameDurableRecord(row, record)) throw new Error('finance_group_entry_idempotency_mismatch');
      rows.push(row);
    }
    if (rows.some((row) => row?.inserted) && autoDrain) kick();
    return rows;
  }

  async function ingestExternalEvent({ eventId, requestHash, event }) {
    if (!config.enabled || !initialized || typeof activeStore?.enqueueIngress !== 'function') throw new Error('finance_group_entry_unavailable');
    const result = await activeStore.enqueueIngress(eventId, requestHash, () => {
      const routed = routeEvent(event, config);
      return { ...routed, intercepted: routed.intercepted ? 1 : 0 };
    });
    if (result.inserted && result.queuedCount > 0 && autoDrain) kick();
    return { intercepted: result.intercepted, queuedCount: result.queuedCount, replayedCount: result.inserted ? 0 : result.queuedCount };
  }

  function kick() {
    kickRequested = true;
    setImmediate(() => drainOnce().catch(() => {}));
  }

  async function drainOnce() {
    if (!initialized || draining) return 0;
    draining = true; let processed = 0;
    try {
      while (processed < MAX_STEPS_PER_DRAIN) {
        kickRequested = false;
        const rows = await activeStore.claimBatch(Math.min(5, MAX_STEPS_PER_DRAIN - processed), LEASE_SECONDS);
        if (!rows.length) break;
        for (const row of rows) { await processRow(row); processed++; }
      }
    } finally {
      draining = false;
      if (autoDrain && (kickRequested || processed >= MAX_STEPS_PER_DRAIN)) setImmediate(() => drainOnce().catch(() => {}));
    }
    return processed;
  }

  async function processRow(row) {
    try {
      if (row.status === 'pending_membership' || row.status === 'membership_uncertain') {
        const result = await activeClient.syncMembership(row);
        if (result.kind === 'uncertain') return activeStore.finish(row, 'membership_uncertain', { error: result.code, retry: true });
        if (result.kind !== row.desired_state) return activeStore.finish(row, 'manual_review', { error: result.code || 'membership_rejected' });
        return activeStore.finish(row, row.job_kind === 'membership' ? 'completed' : 'pending_entry', {});
      }
      if (row.status === 'pending_entry' || row.status === 'entry_uncertain') {
        const result = await activeClient.createWebEntry(row);
        if (result.kind === 'uncertain') return activeStore.finish(row, 'entry_uncertain', { error: result.code, retry: true });
        if (result.kind !== 'created') return activeStore.finish(row, 'manual_review', { error: result.code || 'entry_rejected' });
        return activeStore.finish(row, 'pending_delivery', { entryUrl: result.url, entryExpiresAt: result.expiresAt });
      }
      if (row.status === 'pending_delivery') {
        if (!row.entry_expires_at || Date.parse(row.entry_expires_at) <= now()) return activeStore.finish(row, 'expired', { error: 'entry_expired_new_command_required' });
        const result = await activeClient.deliver(row);
        if (result.kind === 'uncertain') return activeStore.finish(row, 'delivery_uncertain', { error: result.code });
        if (result.kind === 'delivered') return activeStore.finish(row, 'delivered', { ackReference: result.ackReference });
        return activeStore.finish(row, 'manual_review', { error: result.code || 'delivery_rejected' });
      }
      if (row.status === 'delivery_uncertain') {
        const result = await activeClient.reconcile(row);
        if (result.kind === 'uncertain') return activeStore.finish(row, 'delivery_uncertain', { error: result.code, retry: true });
        if (result.kind === 'delivered') return activeStore.finish(row, 'delivered', { ackReference: result.ackReference });
        return activeStore.finish(row, 'manual_review', { error: result.code || 'delivery_rejected' });
      }
      return activeStore.finish(row, 'manual_review', { error: 'invalid_queue_state' });
    } catch {
      return activeStore.finish(row, row.status, { error: 'stage_uncertain', retry: true });
    }
  }

  async function stats() { return config.enabled && initialized ? activeStore.stats() : { enabled: config.enabled, initialized, ready: config.valid && Boolean(activeStore) && activeClient.ready }; }
  return { enabled: config.enabled, ready: config.valid && Boolean(activeStore) && activeClient.ready, init, partitionWebhook, enqueue, ingestExternalEvent, drainOnce, stats };
}

function sameDurableRecord(row, record) {
  const occurredAt = row?.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row?.occurred_at || '');
  return row?.event_key === record.eventKey && row?.job_kind === record.jobKind && row?.tenant_key === record.tenantKey
    && row?.source_id === record.sourceId && row?.form_key === record.formKey && row?.group_reference === record.groupReference
    && row?.applicant_reference === record.applicantReference && row?.desired_state === record.desiredState
    && String(row?.keyword || '') === record.keyword && occurredAt === record.occurredAt
    && row?.membership_request_id === record.membershipRequestId && row?.entry_request_id === record.entryRequestId
    && row?.delivery_event_key === record.deliveryEventKey;
}

function routeEvent(event, config) {
  const groupTarget = event?.source?.type === 'group' ? String(event.source.groupId || '') : '';
  const scope = config.groupsByTarget.get(groupTarget);
  if (!scope) return { intercepted: false, records: [] };
  const base = { tenantKey: scope.tenantKey, sourceId: scope.sourceId, formKey: scope.formKey, groupReference: scope.groupReference };
  if (event?.type === 'message' && event.message?.type === 'text' && KEYWORDS.has(String(event.message.text || ''))) {
    const applicant = config.usersByTarget.get(String(event.source.userId || ''));
    const applicantReference = applicant?.tenantKey === scope.tenantKey ? applicant.identityReference : '';
    return { intercepted: true, records: applicantReference ? [safeRecord(event, { ...base, applicantReference, jobKind: 'entry', desiredState: 'active', keyword: String(event.message.text) }, config.eventSecret)] : [] };
  }
  const members = event?.type === 'memberJoined' ? event.joined?.members : event?.type === 'memberLeft' ? event.left?.members : null;
  if (Array.isArray(members)) {
    return { intercepted: true, records: members.flatMap((member, index) => {
      const applicant = config.usersByTarget.get(String(member?.userId || ''));
      const applicantReference = applicant?.tenantKey === scope.tenantKey ? applicant.identityReference : '';
      return applicantReference ? [safeRecord(event, { ...base, applicantReference, jobKind: 'membership', desiredState: event.type === 'memberJoined' ? 'active' : 'revoked', keyword: '', memberIndex: index }, config.eventSecret)] : [];
    }) };
  }
  return { intercepted: false, records: [] };
}

function safeRecord(event, input, secret) {
  const sourceEvent = String(event.webhookEventId || event.message?.id || `${event.timestamp || ''}:${input.memberIndex || 0}`);
  const digest = createHmac('sha256', secret).update(`${sourceEvent}|${input.tenantKey}|${input.sourceId}|${input.applicantReference}|${input.jobKind}`).digest('hex');
  const eventKey = `group-entry:${digest}`;
  return {
    eventKey, jobKind: input.jobKind, tenantKey: input.tenantKey, sourceId: input.sourceId, formKey: input.formKey,
    groupReference: input.groupReference, applicantReference: input.applicantReference, desiredState: input.desiredState,
    keyword: input.keyword, occurredAt: new Date(Number(event.timestamp) || Date.now()).toISOString(),
    membershipRequestId: `membership-${digest.slice(0, 40)}`, entryRequestId: `entry-${digest.slice(0, 40)}`,
    deliveryEventKey: `entry-invite-${digest.slice(0, 40)}`,
  };
}

function readConfig(env) {
  const enabled = env.HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_ENABLED === 'true';
  const invalid = { enabled, valid: false, groupsByTarget: new Map(), usersByTarget: new Map(), eventSecret: '' };
  if (!enabled) return invalid;
  if (env.HOZO_FINANCE_CLAIMS_V3_ENABLED !== 'true' || env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_ENABLED !== 'true') return invalid;
  if (String(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_MACHINE_TOKEN || '').length < 32 || !safeHttpsBase(env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL) || !String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()) return invalid;
  const eventSecret = String(env.HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_EVENT_SECRET || '');
  if (eventSecret.length < 32) return invalid;
  try {
    const bindingConfig = JSON.parse(String(env.HOZO_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON || '{}'));
    const scopeConfig = JSON.parse(String(env.HOZO_FINANCE_CLAIMS_V3_GROUP_ENTRY_SCOPES_JSON || '{}'));
    if (!exactObject(bindingConfig, ['bindings']) || !Array.isArray(bindingConfig.bindings) || !exactObject(scopeConfig, ['scopes']) || !Array.isArray(scopeConfig.scopes)) return invalid;
    const allowedTenants = new Set(String(env.HOZO_FINANCE_CLAIMS_V3_ALLOWED_TENANTS || '').split(',').map((item) => item.trim()).filter(safeId));
    if (!allowedTenants.size) return invalid;
    const refs = new Map(); const usersByTarget = new Map(); const groupsByTarget = new Map();
    for (const item of bindingConfig.bindings) {
      if (!exactObject(item, ['identityReference', 'tenantKey', 'type', 'target']) || !OPAQUE_REFERENCE.test(item.identityReference) || !safeId(item.tenantKey) || !allowedTenants.has(item.tenantKey) || !['line_user', 'group_binding'].includes(item.type) || !RAW_TARGET.test(item.target) || refs.has(item.identityReference)) return invalid;
      if (item.type === 'line_user' && !item.target.startsWith('U')) return invalid;
      if (item.type === 'group_binding' && !(item.target.startsWith('C') || item.target.startsWith('R'))) return invalid;
      const value = { identityReference: item.identityReference, tenantKey: item.tenantKey, target: item.target, type: item.type };
      refs.set(item.identityReference, value);
      const reverse = item.type === 'line_user' ? usersByTarget : groupsByTarget;
      if (reverse.has(item.target)) return invalid;
      reverse.set(item.target, value);
    }
    const scopedGroups = new Map();
    for (const item of scopeConfig.scopes) {
      if (!exactObject(item, ['tenantKey', 'groupReference', 'sourceId', 'formKey']) || !safeId(item.tenantKey) || !OPAQUE_REFERENCE.test(item.groupReference) || !safeId(item.sourceId) || !safeId(item.formKey)) return invalid;
      const binding = refs.get(item.groupReference);
      if (!binding || binding.type !== 'group_binding' || !binding.target.startsWith('C') || binding.tenantKey !== item.tenantKey || scopedGroups.has(binding.target)) return invalid;
      scopedGroups.set(binding.target, { tenantKey: item.tenantKey, groupReference: item.groupReference, sourceId: item.sourceId, formKey: item.formKey });
    }
    return { enabled, valid: scopedGroups.size > 0 && usersByTarget.size > 0, groupsByTarget: scopedGroups, usersByTarget, eventSecret };
  } catch { return invalid; }
}

export function createGroupEntryClient({ env, now, receiver = null }) {
  const localReceiver = receiver
    || getFinanceClaimsV3LocalService(env)
    || createFinanceClaimsV3Receiver({ env, now });
  const ready = Boolean(
    localReceiver?.receiverEnabled?.()
    && localReceiver?.bridgeEnabled?.()
    && typeof localReceiver?.bridgeMembership === 'function'
    && typeof localReceiver?.bridgeWebEntry === 'function'
    && typeof localReceiver?.deliverEnvelope === 'function'
    && typeof localReceiver?.reconcileEvent === 'function'
  );
  return {
    ready,
    async syncMembership(row) {
      const result = await localReceiver.bridgeMembership({
        contractVersion: BRIDGE_CONTRACT, requestId: row.membership_request_id, tenantKey: row.tenant_key, sourceId: row.source_id,
        identityReference: row.applicant_reference, desiredState: row.desired_state, eventSequence: Number(row.membership_sequence), effectiveAt: row.occurred_at,
      });
      if (result.status === 200) {
        const membership = exactMembership(result.body, row);
        return membership || { kind: 'uncertain', code: 'membership_response_invalid' };
      }
      if (result.invalidBody || ambiguousStatus(result.status)) return { kind: 'uncertain', code: 'membership_uncertain' };
      return { kind: 'rejected', code: String(result.body?.code || 'membership_rejected') };
    },
    async createWebEntry(row) {
      const result = await localReceiver.bridgeWebEntry({
        contractVersion: BRIDGE_CONTRACT, requestId: row.entry_request_id, tenantKey: row.tenant_key, sourceId: row.source_id,
        formKey: row.form_key, identityReference: row.applicant_reference,
      });
      const entry = exactWebEntry(result.body, row.entry_request_id, env.HOZO_FINANCE_CLAIMS_V3_BRIDGE_BASE_URL, now());
      if (result.status === 200) return entry ? { kind: 'created', ...entry } : { kind: 'uncertain', code: 'entry_response_invalid' };
      if (result.invalidBody || ambiguousStatus(result.status)) return { kind: 'uncertain', code: 'entry_uncertain' };
      return { kind: 'rejected', code: String(result.body?.code || 'entry_rejected') };
    },
    async deliver(row) {
      const result = await localReceiver.deliverEnvelope(entryEnvelope(row), { tenantKey: row.tenant_key });
      if (result.status === 200) return safeAck(result.body, row) ? { kind: 'delivered', ackReference: result.body.providerReference } : { kind: 'uncertain', code: 'delivery_ack_invalid' };
      if (result.invalidBody || ambiguousStatus(result.status) || result.status === 409) return { kind: 'uncertain', code: 'delivery_uncertain' };
      return { kind: 'rejected', code: String(result.body?.code || 'delivery_rejected') };
    },
    async reconcile(row) {
      const result = await localReceiver.reconcileEvent(row.delivery_event_key, { tenantKey: row.tenant_key });
      if (result.status === 200) return safeAck(result.body, row) ? { kind: 'delivered', ackReference: result.body.providerReference } : { kind: 'uncertain', code: 'delivery_ack_invalid' };
      if (result.invalidBody || ambiguousStatus(result.status) || (result.status === 409 && ['reconciliation_in_progress', 'reconciliation_required'].includes(result.body?.code))) return { kind: 'uncertain', code: 'delivery_uncertain' };
      return { kind: 'rejected', code: String(result.body?.code || 'delivery_rejected') };
    },
  };
}

function entryEnvelope(row) {
  return { contractVersion: ENTRY_CONTRACT, eventKey: row.delivery_event_key, eventType: 'claim_web_entry', recipient: { type: 'line_user', identityReference: row.applicant_reference }, templateKey: 'claim_web_entry_test', payload: {
    contractVersion: ENTRY_CONTRACT, eventKey: row.delivery_event_key, eventType: 'claim_web_entry', entryUrl: row.entry_url, expiresAt: row.entry_expires_at, testMode: true,
  } };
}

function safeAck(value, row) {
  return exactObject(value, ['contractVersion', 'eventKey', 'status', 'ackKind', 'providerReference'])
    && value.contractVersion === ACK_CONTRACT && value.eventKey === row.delivery_event_key && value.status === 'delivered'
    && ['providerAccepted', 'replayed'].includes(value.ackKind)
    && /^line-ack:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value.providerReference || ''));
}
function exactMembership(value, row) {
  if (!exactObject(value, ['contractVersion', 'requestId', 'matched', 'desiredState', 'evidenceRecorded', 'effectiveState', 'replayed'])
    || value.contractVersion !== BRIDGE_CONTRACT || value.requestId !== row.membership_request_id
    || value.desiredState !== row.desired_state || !['active', 'revoked'].includes(value.desiredState)
    || typeof value.matched !== 'boolean' || value.evidenceRecorded !== true || typeof value.replayed !== 'boolean'
    || !['active', 'revoked', 'pending'].includes(value.effectiveState)) return null;
  if (value.matched === true && value.effectiveState === row.desired_state) return { kind: row.desired_state };
  if (value.matched === false && value.effectiveState === 'pending') return { kind: 'blocked', code: 'membership_identity_pending' };
  if (row.desired_state === 'revoked' && value.matched === true && value.effectiveState === 'active') return { kind: 'blocked', code: 'membership_revoke_protected' };
  return { kind: 'blocked', code: 'membership_state_not_applied' };
}
function ambiguousStatus(status) { return !status || [408, 425, 429].includes(status) || status >= 500; }
function exactWebEntry(value, expectedRequestId, baseValue, nowMs) {
  if (!exactObject(value, ['contractVersion', 'requestId', 'url', 'expiresAt', 'replayed']) || value.contractVersion !== BRIDGE_CONTRACT || value.requestId !== expectedRequestId || typeof value.replayed !== 'boolean') return null;
  const base = safeHttpsBase(baseValue); let url;
  try { url = new URL(value.url); } catch { return null; }
  const hints = url.searchParams.getAll('sourceHint'); const expires = Date.parse(value.expiresAt);
  if (!base || url.origin !== base.origin || url.pathname !== '/finance-claims' || url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 1 || hints.length !== 1 || !safeSourceHint(hints[0])) return null;
  if (typeof value.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt) || !Number.isFinite(expires) || new Date(expires).toISOString() !== value.expiresAt || expires <= nowMs || expires > nowMs + 300_000) return null;
  return { url: url.toString(), expiresAt: value.expiresAt };
}
function safeId(value) { return typeof value === 'string' && SAFE_ID.test(value); }
function safeSourceHint(value) { const hint = String(value || ''); return /^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{43}$/.test(hint) && !/(?:^|[^A-Za-z0-9_-])[UCR][A-Za-z0-9_-]{32,99}(?:$|[^A-Za-z0-9_-])/.test(hint); }
function exactObject(value, keys) { return Boolean(value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',')); }
function safeHttpsBase(value) { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? new URL(url.origin) : null; } catch { return null; } }
function stableUuid(value) { const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split(''); hex[12] = '4'; hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]; return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`; }

export function createPostgresGroupEntryStore(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, ...(!/localhost|127\.0\.0\.1/.test(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}) }); let initialized = false;
  return {
    async init() {
      if (initialized) return;
      await pool.query(`CREATE TABLE IF NOT EXISTS finance_claim_group_membership_sequences_v3(tenant_key TEXT NOT NULL,source_id TEXT NOT NULL,applicant_reference TEXT NOT NULL,last_sequence BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tenant_key,source_id,applicant_reference));
        CREATE TABLE IF NOT EXISTS finance_claim_group_entry_queue_v3(event_key TEXT PRIMARY KEY,job_kind TEXT NOT NULL CHECK(job_kind IN('entry','membership')),tenant_key TEXT NOT NULL,source_id TEXT NOT NULL,form_key TEXT NOT NULL,group_reference TEXT NOT NULL,applicant_reference TEXT NOT NULL,desired_state TEXT NOT NULL CHECK(desired_state IN('active','revoked')),keyword TEXT NOT NULL DEFAULT '',occurred_at TIMESTAMPTZ NOT NULL,membership_sequence BIGINT NOT NULL DEFAULT 0,membership_request_id TEXT NOT NULL,entry_request_id TEXT NOT NULL,delivery_event_key TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending_membership','membership_uncertain','pending_entry','entry_uncertain','pending_delivery','delivery_uncertain','completed','delivered','expired','manual_review')),entry_url TEXT NOT NULL DEFAULT '',entry_expires_at TIMESTAMPTZ,ack_reference TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',lease_token UUID,lease_until TIMESTAMPTZ,available_at TIMESTAMPTZ NOT NULL DEFAULT now(),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE INDEX IF NOT EXISTS idx_finance_claim_group_entry_claim_v3 ON finance_claim_group_entry_queue_v3(status,available_at,lease_until,created_at);
        CREATE TABLE IF NOT EXISTS finance_claim_group_entry_attempts_v3(id UUID PRIMARY KEY,event_key TEXT NOT NULL REFERENCES finance_claim_group_entry_queue_v3(event_key),attempt_no INTEGER NOT NULL,stage TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('processing','succeeded','retry','manual_review')),lease_token UUID NOT NULL,error_code TEXT NOT NULL DEFAULT '',started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ,UNIQUE(event_key,attempt_no));
        CREATE TABLE IF NOT EXISTS finance_claim_group_ingress_v3(event_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,intercepted INTEGER NOT NULL DEFAULT -1 CHECK(intercepted BETWEEN -1 AND 1),queued_count INTEGER NOT NULL DEFAULT -1 CHECK(queued_count >= -1),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
      initialized = true;
    },
    async enqueue(record) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const row = await enqueueRecordWithClient(client, record);
        await client.query('COMMIT'); return row;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async enqueueIngress(eventId, requestHash, buildRouting) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = (await client.query(`INSERT INTO finance_claim_group_ingress_v3(event_id,request_hash) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`, [eventId, requestHash])).rows[0];
        const reservation = (await client.query('SELECT * FROM finance_claim_group_ingress_v3 WHERE event_id=$1 FOR UPDATE', [eventId])).rows[0];
        if (!reservation || reservation.request_hash !== requestHash) throw new Error('finance_group_entry_idempotency_mismatch');
        if (!inserted) {
          if (reservation.intercepted < 0 || reservation.queued_count < 0) throw new Error('finance_group_entry_unavailable');
          await client.query('COMMIT');
          return { inserted: false, intercepted: Number(reservation.intercepted), queuedCount: Number(reservation.queued_count) };
        }
        const routed = buildRouting();
        const rows = [];
        for (const record of routed.records) rows.push(await enqueueRecordWithClient(client, record));
        await client.query('UPDATE finance_claim_group_ingress_v3 SET intercepted=$2,queued_count=$3,updated_at=now() WHERE event_id=$1', [eventId, routed.intercepted, rows.length]);
        await client.query('COMMIT');
        return { inserted: true, intercepted: routed.intercepted, queuedCount: rows.length };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async claimBatch(limit, leaseSeconds) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const rows = (await client.query(`SELECT * FROM finance_claim_group_entry_queue_v3 WHERE status=ANY($1) AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [[...ACTIVE_STATES], limit])).rows;
        const claimed = [];
        for (const row of rows) {
          const token = randomUUID(); const attemptNo = Number(row.attempts) + 1; const attemptId = stableUuid(`${row.event_key}:${attemptNo}`);
          if (Number(row.attempts) > 0) await client.query(`UPDATE finance_claim_group_entry_attempts_v3 SET status='retry',error_code='lease_expired',finished_at=now() WHERE event_key=$1 AND attempt_no=$2 AND status='processing'`, [row.event_key, row.attempts]);
          const updated = (await client.query(`UPDATE finance_claim_group_entry_queue_v3 SET attempts=$2,lease_token=$3,lease_until=now()+($4||' seconds')::interval,updated_at=now() WHERE event_key=$1 AND attempts=($2::integer-1) RETURNING *`, [row.event_key, attemptNo, token, String(leaseSeconds)])).rows[0];
          if (updated) { await client.query(`INSERT INTO finance_claim_group_entry_attempts_v3(id,event_key,attempt_no,stage,status,lease_token) VALUES($1,$2,$3,$4,'processing',$5)`, [attemptId, row.event_key, attemptNo, row.status, token]); claimed.push(updated); }
        }
        await client.query('COMMIT'); return claimed;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async finish(row, status, options = {}) {
      const retry = options.retry === true; const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = (await client.query(`UPDATE finance_claim_group_entry_queue_v3 SET status=$4,entry_url=CASE WHEN $5<>'' THEN $5 ELSE entry_url END,entry_expires_at=CASE WHEN $6<>'' THEN $6::timestamptz ELSE entry_expires_at END,ack_reference=CASE WHEN $7<>'' THEN $7 ELSE ack_reference END,last_error=$8,lease_token=NULL,lease_until=NULL,available_at=CASE WHEN $9 THEN now()+interval '30 seconds' ELSE now() END,updated_at=now() WHERE event_key=$1 AND lease_token=$2 AND attempts=$3 RETURNING *`, [row.event_key, row.lease_token, row.attempts, status, options.entryUrl || '', options.entryExpiresAt || '', options.ackReference || '', String(options.error || '').slice(0, 120), retry])).rows[0];
        if (!updated) throw new Error('stale_group_entry_lease');
        await client.query(`UPDATE finance_claim_group_entry_attempts_v3 SET status=$4,error_code=$5,finished_at=now() WHERE event_key=$1 AND attempt_no=$2 AND lease_token=$3 AND status='processing'`, [row.event_key, row.attempts, row.lease_token, status === 'manual_review' ? 'manual_review' : retry ? 'retry' : 'succeeded', String(options.error || '').slice(0, 120)]);
        await client.query('COMMIT'); return updated;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async stats() { const rows = (await pool.query('SELECT status,count(*)::int count FROM finance_claim_group_entry_queue_v3 GROUP BY status')).rows; return { enabled: true, initialized, ready: initialized, counts: Object.fromEntries(rows.map((row) => [row.status, row.count])) }; },
  };
}

async function enqueueRecordWithClient(client, record) {
  const inserted = (await client.query(`INSERT INTO finance_claim_group_entry_queue_v3(event_key,job_kind,tenant_key,source_id,form_key,group_reference,applicant_reference,desired_state,keyword,occurred_at,membership_request_id,entry_request_id,delivery_event_key,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_membership') ON CONFLICT(event_key) DO NOTHING RETURNING event_key`, [record.eventKey, record.jobKind, record.tenantKey, record.sourceId, record.formKey, record.groupReference, record.applicantReference, record.desiredState, record.keyword, record.occurredAt, record.membershipRequestId, record.entryRequestId, record.deliveryEventKey])).rows[0];
  if (inserted) {
    const sequence = (await client.query(`INSERT INTO finance_claim_group_membership_sequences_v3(tenant_key,source_id,applicant_reference,last_sequence) VALUES($1,$2,$3,1) ON CONFLICT(tenant_key,source_id,applicant_reference) DO UPDATE SET last_sequence=finance_claim_group_membership_sequences_v3.last_sequence+1,updated_at=now() RETURNING last_sequence`, [record.tenantKey, record.sourceId, record.applicantReference])).rows[0].last_sequence;
    await client.query('UPDATE finance_claim_group_entry_queue_v3 SET membership_sequence=$2 WHERE event_key=$1', [record.eventKey, sequence]);
  }
  const row = (await client.query('SELECT * FROM finance_claim_group_entry_queue_v3 WHERE event_key=$1', [record.eventKey])).rows[0];
  return { ...row, inserted: Boolean(inserted) };
}

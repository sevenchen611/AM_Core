import crypto from 'node:crypto';
import { sendJson } from '../util.js';
import { createLineIoStore, ioError } from './store.js';
import { lineIoDatabaseConfig } from './database.js';
import { createDirectory } from './directory.js';
import { createDirectoryStore } from './directory-store.js';

const PREFIX = '/api/v1/line';
const SCOPES = new Set(['groups:read', 'events:read', 'messages:write', 'directory:read']);
const hash = (value) => crypto.createHash('sha256').update(value).digest();

export function loadLineIoClients(env, tenants) {
  let clients;
  try { clients = JSON.parse(env.AMCORE_LINE_IO_CLIENTS_JSON || '[]'); }
  catch { throw new Error('LINE I/O clients must be valid JSON'); }
  if (!Array.isArray(clients) || !clients.length) throw new Error('LINE I/O requires scoped clients');
  const ids = new Set();
  const tokens = new Set();
  const owners = new Map();
  return clients.map((client) => {
    if (!client || typeof client !== 'object') throw new Error('Invalid LINE I/O client');
    const token = env[client.tokenEnv];
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(client.id || '') || ids.has(client.id)
      || !tenants.some((t) => t.key === client.tenantKey && t.runtimeEnabled !== false)
      || typeof token !== 'string' || token.length < 32 || tokens.has(token)
      || !Array.isArray(client.groupIds) || (!client.groupIds.length && client.directoryAllGroups !== true) || client.groupIds.length > 100
      || client.groupIds.some((id) => typeof id !== 'string' || !/^C[0-9a-f]{32}$/i.test(id))
      || (client.inputUserIds !== undefined && (!Array.isArray(client.inputUserIds) || !client.inputUserIds.length
        || client.inputUserIds.some((id) => !/^U[0-9a-f]{32}$/i.test(id))))
      || (client.notifyUserId !== undefined && !/^U[0-9a-f]{32}$/i.test(client.notifyUserId))
      || (client.transportOnly !== undefined && typeof client.transportOnly !== 'boolean')
      || (client.directoryAllGroups !== undefined && typeof client.directoryAllGroups !== 'boolean')
      || (client.directoryAllGroups === true && (client.groupIds.length !== 0
        || client.scopes?.length !== 1 || client.scopes[0] !== 'directory:read' || client.transportOnly === true))
      || !Array.isArray(client.scopes) || !client.scopes.length || client.scopes.some((s) => !SCOPES.has(s))) {
      throw new Error('Invalid LINE I/O client configuration (check id, tenant, token, groups, scopes)');
    }
    ids.add(client.id);
    tokens.add(token);
    for (const id of client.groupIds) {
      if (owners.has(id) && owners.get(id) !== client.tenantKey) throw new Error('LINE I/O group has multiple tenants');
      owners.set(id, client.tenantKey);
    }
    return { id: client.id, tenantKey: client.tenantKey, groupIds: [...new Set(client.groupIds)],
      inputUserIds: client.inputUserIds, notifyUserId: client.notifyUserId || null,
      transportOnly: client.transportOnly === true, directoryAllGroups:client.directoryAllGroups === true,
      scopes: [...client.scopes], tokenHash: hash(token) };
  });
}

export async function readLineIoBody(req, maxBytes = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw ioError(413, 'body_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function acceptLineWebhook({ rawBody, signature, line, lineIo }) {
  if (!line.isValidSignature(rawBody, signature)) throw ioError(401, 'invalid_signature');
  let body;
  try { body = JSON.parse(rawBody); } catch { throw ioError(400, 'invalid_json'); }
  if (!body || !Array.isArray(body.events) || body.events.some((event) => !event || typeof event !== 'object' || Array.isArray(event))) {
    throw ioError(400, 'invalid_events');
  }
  try { await lineIo.capture(body.events); }
  catch { throw ioError(503, 'capture_unavailable'); }
  return body.events;
}

export async function createLineIo({ env = process.env, tenants, router, line, logger = console, store: injectedStore,
  directoryStore: injectedDirectoryStore }) {
  if (env.AMCORE_LINE_IO_ENABLED !== '1') return {
    enabled: false, handle: async () => false, capture: async () => {}, owns: () => false, close: async () => {},
  };
  if (!line.configured) throw new Error('LINE I/O requires LINE channel credentials');
  const clients = loadLineIoClients(env, tenants);
  let pool;
  if (!injectedStore) {
    const { Pool } = await import('pg');
    pool = new Pool({ ...lineIoDatabaseConfig(env), max: 4,
      connectionTimeoutMillis: 5000, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
    // Migration is explicit. Never acknowledge events if durable storage is absent.
    try {
      await pool.query('SELECT seq FROM line_io.line_io_events LIMIT 0');
      await pool.query('SELECT retry_key FROM line_io.line_io_sends LIMIT 0');
      await pool.query('SELECT message_id FROM line_io.line_io_unsent LIMIT 0');
      if (env.AMCORE_LINE_DIRECTORY_ENABLED === '1') {
        await pool.query('SELECT group_id FROM line_directory.groups LIMIT 0');
        await pool.query('SELECT user_id FROM line_directory.members LIMIT 0');
      }
    } catch (error) { await pool.end(); throw error; }
  }
  const store = injectedStore || createLineIoStore(pool);
  const subscriptions = new Map();
  for (const client of clients.filter((c) => c.scopes.includes('events:read'))) {
    for (const id of client.groupIds) subscriptions.set(id, client.tenantKey);
  }

  async function resolve(tenantKey, groupId, writable = false) {
    // Revalidate assignment on each external request, including revocation.
    router.invalidate(groupId);
    const { tenant, binding } = await router.resolveGroupBinding(groupId);
    if (tenant?.key !== tenantKey || !binding || (writable && binding.status !== '啟用')) {
      throw ioError(403, 'group_unavailable');
    }
    return binding;
  }

  async function capture(events) {
    if (directory) await directory.capture(events);
    const records = [];
    for (const event of events) {
      const groupId = event?.source?.type === 'group' ? event.source.groupId : '';
      const tenantKey = subscriptions.get(groupId);
      if (!tenantKey) continue;
      if (['message', 'postback'].includes(event.type) && !clients.some((c) => c.tenantKey === tenantKey
        && c.groupIds.includes(groupId) && c.scopes.includes('events:read')
        && (!c.inputUserIds || c.inputUserIds.includes(event.source.userId)))) continue;
      if (typeof event.webhookEventId !== 'string' || !event.webhookEventId) throw ioError(400, 'event_id_required');
      // A failed lookup may be temporary. Fail the webhook so LINE can redeliver.
      const binding = await resolve(tenantKey, groupId);
      const { replyToken, ...safeEvent } = event;
      if (safeEvent.message) {
        const { quoteToken, ...message } = safeEvent.message;
        safeEvent.message = message;
      }
      records.push({ tenantKey, groupId, bindingId: binding.pageId,
        projectId: binding.projectPageId || null, event: safeEvent });
    }
    await store.append(records);
  }

  async function handle(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const token = /^Bearer ([^\s]+)$/i.exec(String(req.headers.authorization || ''))?.[1] || '';
      const digest = hash(token);
      const client = clients.find((c) => crypto.timingSafeEqual(c.tokenHash, digest));
      if (!client) throw ioError(401, 'unauthorized');
      const memberMatch = new RegExp(`^${PREFIX}/directory/groups/([^/]+)/members$`).exec(path);
      const required = { [`GET ${PREFIX}/groups`]: 'groups:read',
        [`GET ${PREFIX}/directory/groups`]: 'directory:read',
        [`GET ${PREFIX}/events`]: 'events:read', [`POST ${PREFIX}/messages`]: 'messages:write' }[`${req.method} ${path}`];
      const scope = required || (req.method === 'GET' && memberMatch ? 'directory:read' : null);
      if (!scope) throw ioError(404, 'not_found');
      if (!client.scopes.includes(scope)) throw ioError(403, 'scope_denied');

      if (scope === 'directory:read') {
        if (!directory) throw ioError(503,'directory_disabled');
        sendJson(res,200,memberMatch ? await directory.members(client,memberMatch[1],url) : await directory.groups(client,url));
      } else if (required === 'groups:read') {
        const groups = [];
        for (const groupId of client.groupIds) {
          try {
            const binding = await resolve(client.tenantKey, groupId);
            groups.push({ groupId, name: binding.groupName, bindingId: binding.pageId,
              projectId: binding.projectPageId || null, writable: binding.status === '啟用',
              inputUserIds: client.inputUserIds || null, notifyUserId: client.notifyUserId });
          } catch (error) { if (error.code !== 'group_unavailable') throw error; }
        }
        sendJson(res, 200, { tenantKey: client.tenantKey, groups });
      } else if (required === 'events:read') {
        const after = url.searchParams.get('after') || '0';
        const rawLimit = url.searchParams.get('limit') || '100';
        if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n
          || !/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw ioError(400, 'invalid_pagination');
        // Keep the configured stream stable. Do not silently advance past a
        // temporarily unavailable group; return an error and retain the cursor.
        for (const groupId of client.groupIds) await resolve(client.tenantKey, groupId);
        sendJson(res, 200, await store.list({ tenantKey: client.tenantKey, groupIds: client.groupIds,
          inputUserIds: client.inputUserIds, after, limit: Number(rawLimit) }));
      } else {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw ioError(415, 'json_required');
        const raw = await readLineIoBody(req);
        let body;
        try { body = JSON.parse(raw); } catch { throw ioError(400, 'invalid_json'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((k) => !['groupId', 'text', 'notifyUserId'].includes(k))
          || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4900) throw ioError(400, 'invalid_message');
        if (Object.hasOwn(body, 'notifyUserId') && body.notifyUserId !== null
          && (typeof body.notifyUserId !== 'string' || !/^U[0-9a-f]{32}$/i.test(body.notifyUserId))) {
          throw ioError(400, 'invalid_notify_user');
        }
        if (!client.groupIds.includes(body.groupId)) throw ioError(403, 'group_denied');
        // Omission keeps v1 defaults; explicit null sends a group report without @.
        const notifyUserId = Object.hasOwn(body, 'notifyUserId') ? body.notifyUserId : client.notifyUserId;
        const key = String(req.headers['idempotency-key'] || '');
        if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) throw ioError(400, 'idempotency_key_required');
        await resolve(client.tenantKey, body.groupId, true);
        const identity = { tenantKey: client.tenantKey, clientId: client.id, key };
        const reserved = await store.reserve({ ...identity, hash: hash(JSON.stringify([body.groupId, body.text, notifyUserId])).toString('hex') });
        if (reserved.result) {
          sendJson(res, 200, { ...reserved.result, replayed: true });
        } else {
          let delivery;
          try {
            if (notifyUserId) {
              try { await line.resolveGroupMemberName(body.groupId, notifyUserId, { timeoutMs: 5000 }); }
              catch (error) {
                throw ioError(error.lineStatus === 404 ? 403 : 503,
                  error.lineStatus === 404 ? 'notify_user_unavailable' : 'notify_lookup_unavailable');
              }
            }
            // Group authorization is unchanged. Each supplied recipient must be
            // verifiable in that group before a new push is attempted.
            const message = notifyUserId ? { type: 'textV2', text: '{who}',
              substitution: { who: { type: 'mention', mentionee: { type: 'user', userId: notifyUserId } } } } : body.text;
            delivery = await line.pushLineMessage(body.groupId, message, undefined, { retryKey: reserved.retryKey, timeoutMs: 8000,
              additionalMessages: notifyUserId ? [{ type: 'text', text: body.text }] : [] });
          } catch (error) {
            await store.finish({ ...identity, attempt: reserved.attempt, result: null });
            if (error.status) throw error;
            throw ioError(502, 'line_send_failed');
          }
          const result = { status: 'accepted', groupId: body.groupId, notifyUserId, idempotencyKey: key,
            requestId: delivery.acceptedRequestId || delivery.requestId,
            messageIds: delivery.messageIds, replayed: Boolean(delivery.replayed) };
          await store.finish({ ...identity, attempt: reserved.attempt, result });
          sendJson(res, 200, result);
        }
      }
    } catch (error) {
      const status = error.status || 503;
      if (status >= 500) logger.warn?.(`LINE I/O request failed (${error.code || 'storage_unavailable'})`);
      if (error.code === 'send_in_progress') res.setHeader('Retry-After', '30');
      sendJson(res, status, { error: error.code && error.status ? error.code : 'service_unavailable' });
    }
    return true;
  }

  const owns = (event) => event?.source?.type === 'group' && clients.some((c) =>
    c.transportOnly && c.scopes.includes('events:read') && c.groupIds.includes(event.source.groupId));
  const directory = env.AMCORE_LINE_DIRECTORY_ENABLED === '1' ? createDirectory({
    store:injectedDirectoryStore || createDirectoryStore(pool),router,line,clients,
    ioState:async (client,groupId,route,availabilityKnown) => {
      const assigned = clients.filter((c) => c.tenantKey === route?.tenantKey && c.groupIds.includes(groupId));
      const inputEnabled = Boolean(['啟用','影子記錄'].includes(route?.status) && assigned.some((c) => c.scopes.includes('events:read')));
      const outputEnabled = Boolean(route?.status === '啟用' && assigned.some((c) => c.scopes.includes('messages:write')));
      return { availabilityKnown,inputEnabled:availabilityKnown ? inputEnabled : null,
        outputEnabled:availabilityKnown ? outputEnabled : null,
        canReadInput:inputEnabled && assigned.includes(client) && client.scopes.includes('events:read'),
        canSend:outputEnabled && assigned.includes(client) && client.scopes.includes('messages:write') };
    },
  }) : null;
  return { enabled: true, directoryEnabled:Boolean(directory), capture, handle, owns, close: async () => pool?.end() };
}

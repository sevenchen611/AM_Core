import crypto from 'node:crypto';
import { sendJson } from '../util.js';
import { createLineIoStore, ioError } from './store.js';
import { lineIoDatabaseConfig } from './database.js';
import { createDirectory } from './directory.js';
import { createDirectoryStore } from './directory-store.js';
import { createBindings } from './bindings.js';
import { buildReviewCards, buildInlineResult } from './cards.js';
import { conversationId, directId, directUofInput } from './conversation.js';

const PREFIX = '/api/v1/line';
const SCOPES = new Set(['groups:read', 'events:read', 'messages:write', 'directory:read', 'bindings:write']);
const hash = (value) => crypto.createHash('sha256').update(value).digest();

// Bound provider and database fan-out while preserving configured group order.
async function mapGroups(groups,work) {
  const results=new Array(groups.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,groups.length)},async()=>{
    while(next<groups.length) {const index=next++;results[index]=await work(groups[index]);}
  }));
  return results;
}

function sealReplyToken(token, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function openReplyToken(sealed, key) {
  const bytes = Buffer.from(sealed, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

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
      || !Array.isArray(client.groupIds) || (!client.groupIds.length && client.directoryAllGroups !== true && client.allowPersonalBindings!==true && !(client.scopes?.length===1 && client.scopes[0]==='bindings:write')) || client.groupIds.length > 100
      || client.groupIds.some((id) => typeof id !== 'string' || !/^C[0-9a-f]{32}$/i.test(id))
      || (client.inputUserIds !== undefined && (!Array.isArray(client.inputUserIds) || !client.inputUserIds.length
        || client.inputUserIds.some((id) => !/^U[0-9a-f]{32}$/i.test(id))))
      || (client.notifyUserId !== undefined && !/^U[0-9a-f]{32}$/i.test(client.notifyUserId))
      || (client.transportOnly !== undefined && typeof client.transportOnly !== 'boolean')
      || (client.allowPersonalBindings !== undefined && (typeof client.allowPersonalBindings !== 'boolean' || (client.allowPersonalBindings && client.transportOnly!==true)))
      || (client.scopes?.includes('bindings:write') && (client.scopes.length!==1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(client.bindingTargetClientId || '')))
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
      allowPersonalBindings:client.allowPersonalBindings===true,bindingTargetClientId:client.bindingTargetClientId,
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
  directoryStore: injectedDirectoryStore, bindingStore: injectedBindingStore }) {
  if (env.AMCORE_LINE_IO_ENABLED !== '1') return {
    enabled: false, handle: async () => false, capture: async () => {}, owns: () => false, resolveAttachmentBinding: async () => null, close: async () => {},
  };
  if (!line.configured) throw new Error('LINE I/O requires LINE channel credentials');
  const replyEnabled = env.AMCORE_LINE_IO_REPLY_ENABLED === '1';
  if (replyEnabled && !env.LINE_CHANNEL_SECRET) throw new Error('LINE replies require the existing LINE channel secret');
  const replyKey = replyEnabled ? hash(`line-io-replies-v1:${env.LINE_CHANNEL_SECRET}`) : null;
  const clients = loadLineIoClients(env, tenants);
  for(const client of clients.filter(c=>c.scopes.includes('bindings:write'))) {
    if(!clients.some(c=>c.id===client.bindingTargetClientId && c.tenantKey===client.tenantKey && c.allowPersonalBindings && c.transportOnly
      && ['groups:read','events:read','messages:write'].every(scope=>c.scopes.includes(scope)))) throw new Error('Invalid personal binding target');
  }
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
      if(env.AMCORE_LINE_BINDINGS_ENABLED==='1') await pool.query('SELECT id FROM line_bindings.bindings LIMIT 0');
      if (env.AMCORE_LINE_DIRECTORY_ENABLED === '1') {
        await pool.query('SELECT group_id FROM line_directory.groups LIMIT 0');
        await pool.query('SELECT user_id FROM line_directory.members LIMIT 0');
      }
    } catch (error) { await pool.end(); throw error; }
  }
  const store = injectedStore || createLineIoStore(pool);
  const personal = env.AMCORE_LINE_BINDINGS_ENABLED==='1' ? await createBindings({pool,store:injectedBindingStore,line,clients,router,env}) : null;
  const subscriptions = new Map();
  for (const client of clients.filter((c) => c.scopes.includes('events:read'))) {
    for (const id of client.groupIds) subscriptions.set(id, client.tenantKey);
  }

  async function resolve(tenantKey, groupId, writable = false) {
    const person=personal?.lookup(groupId);
    if(person) {
      if(person.tenant_key!==tenantKey || person.status!=='bound') throw ioError(403,'group_unavailable');
      const current=await personal.verified(person,{fresh:writable});
      if(current?.status!=='bound') throw ioError(403,'group_unavailable');
      return {pageId:current.id,groupName:current.group_name,status:'啟用',projectPageId:null,personalBinding:current};
    }
    // Revalidate assignment on each external request, including revocation.
    router.invalidate(groupId);
    const { tenant, binding } = await router.resolveGroupBinding(groupId);
    if (tenant?.key !== tenantKey || !binding || (writable && binding.status !== '啟用')) {
      throw ioError(403, 'group_unavailable');
    }
    return binding;
  }

  async function capture(events, { excludeEvents = () => false } = {}) {
    // Both independent stores must finish successfully before any proof or
    // durable event append. In particular, membership suspension remains a
    // barrier even while directory observation runs alongside it.
    const intake=await Promise.allSettled([
      personal ? personal.capture(events) : Promise.resolve(),
      directory ? directory.capture(events) : Promise.resolve(),
    ]);
    const failed=intake.find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
    const records = [];
    for (const event of events) {
      // Core-owned attachment requests still update directory/membership above,
      // but must not give a second assistant the event/reply token.
      if (excludeEvents(event)) continue;
      const groupId = conversationId(event);
      if(event?.source?.type==='user' && !directUofInput(event)) continue;
      const person=personal?.lookup(groupId);
      if(person) {
        if(person.status!=='bound' || (['message','postback'].includes(event.type) && event.source.userId!==person.user_id)) continue;
        if(!Number.isSafeInteger(event.timestamp)||event.timestamp<Date.now()-90*86400000||event.timestamp>Date.now()+300000) continue;
        if((await personal.verified(person,{fresh:true}))?.status!=='bound') continue;
        if(typeof event.webhookEventId!=='string'||!event.webhookEventId) throw ioError(400,'event_id_required');
        const {replyToken,...safeEvent}=event;
        if(safeEvent.message) {const {quoteToken,...message}=safeEvent.message; safeEvent.message=message;}
        records.push({tenantKey:person.tenant_key,groupId,bindingId:person.id,projectId:null,event:safeEvent,
          ...(replyEnabled && ['message','postback'].includes(event.type) && event.replyToken
            ? {reply:sealReplyToken(event.replyToken,replyKey)} : {})});
        continue;
      }
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
        projectId: binding.projectPageId || null, event: safeEvent,
        ...(replyEnabled && ['message','postback'].includes(event.type) && event.replyToken
          ? {reply:sealReplyToken(event.replyToken,replyKey)} : {}) });
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
      const configuredClient = clients.find((c) => crypto.timingSafeEqual(c.tokenHash, digest));
      if (!configuredClient) throw ioError(401, 'unauthorized');
      if(path.startsWith(`${PREFIX}/bindings`)) {
        if(!personal) throw ioError(503,'bindings_disabled');
        if(!configuredClient.scopes.includes('bindings:write')) throw ioError(403,'scope_denied');
        let body;
        if(req.method!=='GET') {
          if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw ioError(415,'json_required');
          try {body=JSON.parse(await readLineIoBody(req,4096));} catch(error) {if(error.status)throw error;throw ioError(400,'invalid_json');}
        }
        sendJson(res,200,await personal.handle(configuredClient,req.method,path,url,body)); return true;
      }
      if(personal) await personal.refresh();
      const dynamic=personal?.active(configuredClient) || [];
      const client={...configuredClient,groupIds:[...configuredClient.groupIds,...dynamic.map(r=>r.group_id)]};
      const memberMatch = new RegExp(`^${PREFIX}/directory/groups/([^/]+)/members$`).exec(path);
      const required = { [`GET ${PREFIX}/groups`]: 'groups:read',
        [`GET ${PREFIX}/directory/groups`]: 'directory:read',
        [`GET ${PREFIX}/events`]: 'events:read', [`POST ${PREFIX}/messages`]: 'messages:write',
        [`POST ${PREFIX}/replies`]: 'messages:write' }[`${req.method} ${path}`];
      const scope = required || (req.method === 'GET' && memberMatch ? 'directory:read' : null);
      if (!scope) throw ioError(404, 'not_found');
      if (!client.scopes.includes(scope)) throw ioError(403, 'scope_denied');

      if (scope === 'directory:read') {
        if (!directory) throw ioError(503,'directory_disabled');
        sendJson(res,200,memberMatch ? await directory.members(client,memberMatch[1],url) : await directory.groups(client,url));
      } else if (required === 'groups:read') {
        const groups = (await mapGroups(client.groupIds,async groupId=>{
          try {
            const binding = await resolve(client.tenantKey, groupId);
            return { groupId, name: binding.groupName, bindingId: binding.pageId,
              conversationType:directId(groupId)?'user':'group',
              projectId: binding.projectPageId || null, writable: binding.status === '啟用',
              inputUserIds: binding.personalBinding ? [binding.personalBinding.user_id] : client.inputUserIds || null,
              notifyUserId: binding.personalBinding?.user_id || client.notifyUserId };
          } catch (error) { if (error.code !== 'group_unavailable') throw error; }
        })).filter(Boolean);
        sendJson(res, 200, { tenantKey: client.tenantKey, groups });
      } else if (required === 'events:read') {
        const after = url.searchParams.get('after') || '0';
        const rawLimit = url.searchParams.get('limit') || '100';
        if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n
          || !/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw ioError(400, 'invalid_pagination');
        // Keep the configured stream stable. Do not silently advance past a
        // temporarily unavailable group; return an error and retain the cursor.
        await mapGroups(client.groupIds,groupId=>resolve(client.tenantKey,groupId));
        sendJson(res, 200, await store.list({ tenantKey: client.tenantKey, groupIds: client.groupIds,
          inputUserIds: client.inputUserIds, personalBindings:dynamic.map(r=>({groupId:r.group_id,bindingId:r.id,userId:r.user_id})), after, limit: Number(rawLimit) }));
      } else if (path === `${PREFIX}/replies`) {
        if (!replyEnabled) throw ioError(503, 'replies_disabled');
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw ioError(415, 'json_required');
        let body;
        try { body = JSON.parse(await readLineIoBody(req)); } catch (error) {
          if (error.status) throw error;
          throw ioError(400, 'invalid_json');
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(k => !['eventId','groupId','notifyUserId','text','actions','cards','includeText'].includes(k))
          || typeof body.eventId !== 'string' || !body.eventId || body.eventId.length > 128
          || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 24000
          || (body.includeText !== undefined && body.includeText !== true)
          || (!body.includeText && body.text.length > 4900)
          || typeof body.notifyUserId !== 'string' || !/^U[0-9a-f]{32}$/i.test(body.notifyUserId)
          || !client.groupIds.includes(body.groupId)) throw ioError(400, 'invalid_reply');
        const person = personal?.lookup(body.groupId);
        if (person && (person.client_id !== client.id || person.user_id !== body.notifyUserId))
          throw ioError(403, 'personal_recipient_required');
        if (body.cards !== undefined && (!client.allowPersonalBindings || body.actions !== undefined))
          throw ioError(400, 'invalid_cards');
        const cardMessage = body.cards === undefined ? null : buildReviewCards(body.cards, body.text);
        if (body.includeText && !cardMessage) throw ioError(400, 'invalid_reply');
        if (body.actions !== undefined && (!client.allowPersonalBindings || !Array.isArray(body.actions)
          || body.actions.length < 1 || body.actions.length > 3
          || body.actions.some(a => !a || typeof a.label !== 'string' || !a.label.trim() || a.label.length > 20
            || typeof a.data !== 'string' || !a.data || a.data.length > 300
            || (a.inline !== undefined && typeof a.inline !== 'boolean')
            || Object.keys(a).some(k => !['label','data','inline'].includes(k)))
          || body.actions.some(a => a.inline === true) && (body.actions.length !== 1 || body.cards !== undefined)))
          throw ioError(400, 'invalid_actions');
        await resolve(client.tenantKey, body.groupId, true);
        const inlineAction = body.actions?.length === 1 && body.actions[0].inline === true ? body.actions[0] : null;
        const replyCard = inlineAction ? buildInlineResult(body.text, inlineAction)
          : body.actions ? {type:'flex',altText:'UOF 操作確認',contents:{type:'bubble',
          body:{type:'box',layout:'vertical',contents:[{type:'text',text:'請確認上方的案件清單、操作及原因。',wrap:true}]},
          footer:{type:'box',layout:'vertical',contents:body.actions.map(a=>({type:'button',
            action:{type:'postback',label:a.label,data:a.data}}))}}} : null;
        const textParts = inlineAction ? [] : body.includeText || !cardMessage
          ? body.text.match(/[\s\S]{1,4900}/g).map(text=>({type:'text',text})) : [];
        const messages = [...textParts, ...(cardMessage ? [cardMessage] : []), ...(replyCard ? [replyCard] : [])];
        if (messages.length > 5) throw ioError(400,'reply_too_long');
        const bodyHash = hash(JSON.stringify([body.groupId,body.notifyUserId,body.text,body.cards,body.actions,body.includeText])).toString('hex');
        const identity = {tenantKey:client.tenantKey,eventId:body.eventId,groupId:body.groupId,
          userId:body.notifyUserId,bodyHash};
        const claimed = await store.claimReply(identity);
        if (claimed.result) { sendJson(res,200,{...claimed.result,replayed:true}); return true; }
        try {
          await line.replyLineMessages(openReplyToken(claimed.sealedToken, replyKey), messages, {timeoutMs:8000});
          const result = {status:'accepted',method:'reply',eventId:body.eventId,replayed:false};
          await store.finishReply({...identity,status:'accepted',result});
          sendJson(res,200,result);
        } catch (error) {
          await store.finishReply({...identity,status:'uncertain',result:null});
          throw ioError(409,'reply_outcome_unknown');
        }
      } else {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw ioError(415, 'json_required');
        const raw = await readLineIoBody(req);
        let body;
        try { body = JSON.parse(raw); } catch { throw ioError(400, 'invalid_json'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((k) => !['groupId', 'text', 'notifyUserId','actions','cards'].includes(k))
          || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4900) throw ioError(400, 'invalid_message');
        if (Object.hasOwn(body, 'notifyUserId') && body.notifyUserId !== null
          && (typeof body.notifyUserId !== 'string' || !/^U[0-9a-f]{32}$/i.test(body.notifyUserId))) {
          throw ioError(400, 'invalid_notify_user');
        }
        if (!client.groupIds.includes(body.groupId)) throw ioError(403, 'group_denied');
        if (body.cards !== undefined && (!client.allowPersonalBindings || body.actions !== undefined)) throw ioError(400,'invalid_cards');
        const cardMessage = body.cards === undefined ? null : buildReviewCards(body.cards, body.text);
        if(body.actions!==undefined && (!client.allowPersonalBindings || !Array.isArray(body.actions) || body.actions.length<1 || body.actions.length>3
          ||body.actions.some(a=>!a||typeof a.label!=='string'||!a.label.trim()||a.label.length>20||typeof a.data!=='string'||!a.data||a.data.length>300
            ||(a.inline!==undefined && typeof a.inline!=='boolean')||Object.keys(a).some(k=>!['label','data','inline'].includes(k)))
          ||body.actions.some(a=>a.inline===true) && body.actions.length!==1)) throw ioError(400,'invalid_actions');
        const inlineAction = body.actions?.length===1 && body.actions[0].inline===true ? body.actions[0] : null;
        const resultMessage = inlineAction ? buildInlineResult(body.text,inlineAction) : cardMessage;
        // Omission keeps v1 defaults; explicit null sends a group report without @.
        const notifyUserId = Object.hasOwn(body, 'notifyUserId') ? body.notifyUserId : client.notifyUserId;
        const person=personal?.lookup(body.groupId);
        if(person && (person.client_id!==client.id || notifyUserId!==person.user_id)) throw ioError(403,'personal_recipient_required');
        const key = String(req.headers['idempotency-key'] || '');
        if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) throw ioError(400, 'idempotency_key_required');
        await resolve(client.tenantKey, body.groupId, true);
        const identity = { tenantKey: client.tenantKey, clientId: client.id, key };
        const payloadIdentity = body.cards !== undefined ? [body.groupId,body.text,notifyUserId,{cards:body.cards}]
          : body.actions===undefined ? [body.groupId,body.text,notifyUserId] : [body.groupId,body.text,notifyUserId,body.actions];
        const reserved = await store.reserve({ ...identity, hash: hash(JSON.stringify(payloadIdentity)).toString('hex') });
        if (reserved.result) {
          sendJson(res, 200, { ...reserved.result, replayed: true });
        } else {
          let delivery;
          try {
            // Fresh personal proof already checked this exact member in
            // parallel with the group's identity and exclusive member count.
            if (notifyUserId && !person) {
              try { await line.resolveGroupMemberName(body.groupId, notifyUserId, { timeoutMs: 5000 }); }
              catch (error) {
                throw ioError(error.lineStatus === 404 ? 403 : 503,
                  error.lineStatus === 404 ? 'notify_user_unavailable' : 'notify_lookup_unavailable');
              }
            }
            // Group authorization is unchanged. Each supplied recipient must be
            // verifiable in that group before a new push is attempted.
            // The notifyUserId on a personal binding verifies the owner and
            // their current membership. It must not also charge a mention for
            // each reply in a private, one-person group.
            const mentionUserId = notifyUserId && !person ? notifyUserId : null;
            const message = mentionUserId ? { type: 'textV2', text: '{who}',
              substitution: { who: { type: 'mention', mentionee: { type: 'user', userId: mentionUserId } } } } : (resultMessage || body.text);
            const extra=mentionUserId ? [resultMessage || {type:'text',text:body.text}] : [];
            if(body.actions && !inlineAction) extra.push({type:'flex',altText:'UOF 操作確認',contents:{type:'bubble',body:{type:'box',layout:'vertical',contents:[{type:'text',text:'請確認上方的案件清單、操作及原因。按鈕僅限本人使用，逾期請重新發起。',wrap:true}]},footer:{type:'box',layout:'vertical',contents:body.actions.map(a=>({type:'button',action:{type:'postback',label:a.label,data:a.data}}))}}});
            delivery = await line.pushLineMessage(body.groupId, message, undefined, { retryKey: reserved.retryKey, timeoutMs: 8000,
              additionalMessages:extra });
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

  const owns = (event) => personal?.owns(event) || (event?.source?.type === 'group' && clients.some((c) =>
    c.transportOnly && c.scopes.includes('events:read') && c.groupIds.includes(event.source.groupId)));
  async function resolveAttachmentBinding(event) {
    if (!owns(event)) return null;
    const groupId = event.source?.groupId;
    const person = personal?.lookup(groupId);
    if (person) {
      if (person.status !== 'bound' || person.user_id !== event.source.userId) return null;
      if ((await personal.verified(person, { fresh: true }))?.status !== 'bound') return null;
      return { tenant: tenants.find(t => t.key === person.tenant_key),
        binding: { status: '啟用' }, resolution: 'active' };
    }
    const client = clients.find(c => c.transportOnly && c.scopes.includes('events:read')
      && c.groupIds.includes(groupId) && (!c.inputUserIds || c.inputUserIds.includes(event.source.userId)));
    if (!client) return null;
    const binding = await resolve(client.tenantKey, groupId);
    return { tenant: tenants.find(t => t.key === client.tenantKey), binding, resolution: 'active' };
  }
  const directory = env.AMCORE_LINE_DIRECTORY_ENABLED === '1' ? createDirectory({
    store:injectedDirectoryStore || createDirectoryStore(pool),router,line,clients,
    ioState:async (client,groupId,route,availabilityKnown) => {
      const assigned = clients.filter((c) => c.tenantKey === route?.tenantKey && c.groupIds.includes(groupId));
      const inputEnabled = Boolean(['啟用','影子記錄'].includes(route?.status) && assigned.some((c) => c.scopes.includes('events:read')));
      const outputEnabled = Boolean(route?.status === '啟用' && assigned.some((c) => c.scopes.includes('messages:write')));
      return { availabilityKnown,inputEnabled:availabilityKnown ? inputEnabled : null,
        outputEnabled:availabilityKnown ? outputEnabled : null,
        canReadInput:inputEnabled && assigned.some(c=>c.id===client.id) && client.scopes.includes('events:read'),
        canSend:outputEnabled && assigned.some(c=>c.id===client.id) && client.scopes.includes('messages:write') };
    },
  }) : null;
  return { enabled: true, directoryEnabled:Boolean(directory),bindingsEnabled:Boolean(personal), capture, handle, owns,
    acceptsBindingEvent: event => personal?.acceptsBindingEvent(event) ?? Promise.resolve(false),
    resolveAttachmentBinding, close: async () => pool?.end() };
}

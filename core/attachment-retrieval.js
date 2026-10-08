// File requests are assistant operations, handled before task extraction/transport clients.
// Only a verified original from the requesting conversation can leave this service.
import { textItem } from './util.js';
import { createAttachmentDelivery } from './attachment-delivery.js';

export const ATTACHMENT_RETRIEVAL_CONTRACT = 'line-quoted-drive-original-v1';
export const QUOTED_ARCHIVE_CONTRACT = 'line-explicit-quoted-conversation-archive-v1';
export const QUOTED_ARCHIVE_SCOPE = Object.freeze({key:'conversation-archive',runtimeEnabled:true,dataSources:{}});
const plain = prop => (prop?.rich_text || []).map(x => x.plain_text || x.text?.content || '').join('');
const idEqual = (a, b) => Boolean(a && b && String(a).replace(/-/g, '') === String(b).replace(/-/g, ''));
const live = page => page && !page.archived && !page.in_trash;
const binary = new Set(['照片', '檔案', '影片', '音訊', '語音']);
const fail = code => Object.assign(new Error(code), { code });

export function parseAttachmentRequest(event) {
  if (event?.type !== 'message' || event.message?.type !== 'text') return null;
  let text = String(event.message.text || '').trim();
  // Remove only LINE-confirmed mentions of this bot, never mentions of colleagues.
  const mentions = (event.message.mention?.mentionees || []).filter(m => m.isSelf === true)
    .sort((a, b) => b.index - a.index);
  for (const m of mentions) text = text.slice(0, m.index) + text.slice(m.index + m.length);
  text = text.trim().replace(/^(?:葉小蝸|HOZO\s*(?:Jr\.?|AM(?:\s*2\.0)?)|AM)[，,:：\s]+/i, '');
  const match = /^(?:請|麻煩)?\s*(?:你)?\s*(?:幫我|幫忙)?\s*(?:再|重新)?\s*(提供|找一下|找|查找|重傳|傳給我|給我|傳送|傳)\s*(.*?)\s*[。！!？?]*$/.exec(text);
  if (!match) return null;
  let object = match[2].trim();
  for (let i = 0; i < 3; i++) object = object.replace(/(?:給我一下|給我|一下|的下載連結|的連結|下載連結|連結|[，,]?\s*謝謝)\s*$/, '').trim();
  const generic = /^(?:我\s*)?(?:這個|這張|這份|這一份|這|該|原本的|原始的|原)?(?:檔案|文件|附件|照片|圖片|影片|音檔|錄音)$/.test(object);
  const quoted = String(event.message.quotedMessageId || '');
  const named = /^(?:「([^」]+)」|『([^』]+)』|"([^"]+)"|([^\s「」『』"]+\.[a-zA-Z0-9]{1,12}))$/.exec(object);
  const filename = named ? (named[1] || named[2] || named[3] || named[4]).trim() : '';
  if (!generic && !filename && !(quoted && !object && ['重傳', '傳給我', '給我'].includes(match[1]))) return null;
  return { quotedMessageId: quoted, filename, ...(mentions.length?{explicitSelf:true}:{}) };
}

export function createAttachmentRetrieval({ platform, router, ownsTransport = () => false,
  resolveTransport = async () => null, logger = console, requestSpacingMs = 350 }) {
  const inFlight = new Map();
  // Reply tokens are one-use; bounded in-memory dedup also avoids repeated source writes.
  const delivered = new Map();
  let requestStart = Promise.resolve(), nextRequestAt = 0;
  async function request(tenant, path, options = {}) {
    for (let attempt = 0; ; attempt++) {
      const start = requestStart.catch(() => {}).then(async () => {
        const delay = Math.max(0, nextRequestAt - Date.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        nextRequestAt = Date.now() + requestSpacingMs;
      });
      requestStart = start;
      await start;
      try { return await platform.notionRequest(path, { ...options, tenantKey: tenant.key }); }
      catch (error) {
        if (attempt >= 3 || !/Notion API failed: 429\b/.test(String(error.message))) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }
  const query = (tenant, ds, filter, pageSize = 2) => request(tenant, `/v1/data_sources/${encodeURIComponent(ds)}/query`,
    { method: 'POST', body: { filter, page_size: pageSize } });
  const groupOf = event => String(event.source?.groupId || event.source?.roomId || '');
  async function resolve(event, command = parseAttachmentRequest(event)) {
    const groupId = groupOf(event);
    router.invalidate?.(groupId || undefined);
    if (ownsTransport(event)) return resolveTransport(event);
    if (groupId) {
      const route=await router.resolveGroupBinding(groupId);
      const archiveSource=route?.resolution==='not_found'||(route?.binding?.status==='影子記錄'&&route.tenant?.runtimeEnabled!==false);
      if(archiveSource&&command?.explicitSelf===true&&command.quotedMessageId
        &&await platform.centralArchive?.canRetrieveQuote?.(event.source)) {
        return {tenant:QUOTED_ARCHIVE_SCOPE,binding:{status:'啟用'},resolution:'quoted_archive'};
      }
      return route;
    }
    if (event.source?.type !== 'user' || !event.source.userId) return null;
    router.invalidateDirect?.(event.source.userId);
    return router.resolveDirectAttachmentBinding(event.source.userId);
  }
  const allowed = result => result?.tenant?.runtimeEnabled !== false && result?.tenant
    && result.binding?.status === '啟用';
  const delivery = createAttachmentDelivery({ platform, resolveConversation: resolve, resolveOriginal: retrieve, logger });
  async function originMatches(tenant, page, event, quotedId = '') {
    const p = page.properties || {}, group = groupOf(event);
    const originalGroup = plain(p['LINE 群組 ID']);
    if (originalGroup) return Boolean(group && originalGroup === group && plain(p['來源類型']) !== 'direct');
    if (!group) return plain(p['來源類型']) === 'direct'
      && plain(p['LINE 使用者 ID']) === String(event.source.userId || '');
    if (plain(p['來源類型']) === 'direct') return false;
    // Legacy rows may lack group identity. An exact quote requires a binary
    // source; an explicit filename can use the index's original group-context
    // relation (older indexes linked the preceding text, not the file message).
    const relation = p['訊息']?.relation || [];
    if (relation.length !== 1 || p['訊息']?.has_more || !tenant.dataSources.messages) return false;
    const source = await request(tenant, `/v1/pages/${encodeURIComponent(relation[0].id)}`, { method: 'GET' });
    return live(source) && idEqual(source.parent?.data_source_id, tenant.dataSources.messages)
      && plain(source.properties?.['LINE 群組 ID']) === group
      && (!quotedId || (binary.has(source.properties?.['訊息類型']?.select?.name)
        && plain(source.properties?.['LINE 訊息 ID']) === quotedId));
  }
  async function find(tenant, event, command) {
    const ds = tenant.dataSources.attachments;
    if (!ds) throw fail('unavailable');
    let result;
    if (command.quotedMessageId) {
      result = await query(tenant, ds, { property: 'LINE 訊息 ID', rich_text: { equals: command.quotedMessageId } });
      if (result.has_more || result.results?.length > 1) throw fail('ambiguous');
      if (!result.results?.length && !result.has_more && tenant.dataSources.messages && groupOf(event)) {
        const source = await query(tenant, tenant.dataSources.messages, { and: [
          { property: 'LINE 訊息 ID', rich_text: { equals: command.quotedMessageId } },
          { property: 'LINE 群組 ID', rich_text: { equals: groupOf(event) } },
        ] });
        if (source.has_more || source.results?.length > 1) throw fail('ambiguous');
        const message = source.results?.[0];
        if (live(message) && binary.has(message.properties?.['訊息類型']?.select?.name)
          && plain(message.properties?.['LINE 訊息 ID']) === command.quotedMessageId
          && plain(message.properties?.['LINE 群組 ID']) === groupOf(event)) {
          result = await query(tenant, ds, { property: '訊息', relation: { contains: message.id } });
        }
      }
    } else if (command.filename) {
      result = await query(tenant, ds, { property: '檔案名稱', rich_text: { equals: command.filename } }, 100);
    } else throw fail('specify');
    if (result?.has_more) throw fail('ambiguous');
    const candidates = [];
    for (const page of result?.results || []) {
      if (!live(page) || !idEqual(page.parent?.data_source_id, ds)) continue;
      const p = page.properties || {};
      if (command.filename && !command.quotedMessageId && plain(p['檔案名稱']) !== command.filename) continue;
      if (command.quotedMessageId && plain(p['LINE 訊息 ID'])
        && plain(p['LINE 訊息 ID']) !== command.quotedMessageId) continue;
      if (await originMatches(tenant, page, event, command.quotedMessageId)) candidates.push(page);
    }
    if (candidates.length > 1) throw fail('ambiguous');
    if (!candidates.length) throw fail('not_found');
    return candidates[0];
  }
  async function retrieve(tenant, event, command = parseAttachmentRequest(event)) {
    if(tenant.key===QUOTED_ARCHIVE_SCOPE.key){
      if(!command?.explicitSelf||!command.quotedMessageId||!await platform.centralArchive?.canRetrieveQuote?.(event.source))throw fail('unavailable');
      const saved=await platform.centralArchive.original(command.quotedMessageId,{groupId:groupOf(event),userId:event.source?.userId||''});
      if(!saved)throw fail('not_found');
      if(saved.missing)throw fail('missing_original');
      if(saved.pending)throw fail('pending');
      const f=saved.file, md5=String(f?.md5Checksum||'').toLowerCase();
      if(!/^[\w-]{10,200}$/.test(f?.id||'')||!/^[a-f0-9]{32}$/.test(md5)||!(Number(f.size)>0))throw fail('unavailable');
      return {filename:String(f.name||'attachment').slice(0,300),fileId:f.id,size:Number(f.size),md5,
        url:`https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`};
    }
    const page = await find(tenant, event, command);
    const p = page.properties || {}, status = p['保存狀態']?.select?.name;
    if (['需要重傳', '保存失敗'].includes(status)) throw fail('missing_original');
    if (status !== '已保存') throw fail('pending');
    const fileId = plain(p['Drive 檔案 ID']), md5 = plain(p['Drive MD5']);
    if (!tenant.driveConfigured || !tenant.driveRootFolderId || !/^[\w-]{10,200}$/.test(fileId)
      || !/^[a-f0-9]{32}$/i.test(md5) || !Number(p['檔案大小']?.number)) throw fail('unavailable');
    const central=plain(p['保存來源'])==='central-archive'&&platform.centralArchive?.original
      ?await platform.centralArchive.original(plain(p['LINE 訊息 ID']),{
        groupId:event.source?.groupId||event.source?.roomId||'',userId:event.source?.userId||''}):null;
    const file = central?.file || await platform.drive.verifyWithinRoot(fileId, tenant.driveRootFolderId, tenant.key);
    if (file.id !== fileId || Number(file.size) !== Number(p['檔案大小']?.number)
      || String(file.md5Checksum).toLowerCase() !== md5.toLowerCase()) throw fail('changed');
    // Construct the canonical Google URL from the verified ID, not editable Notion URL text.
    return { attachmentPageId: page.id, filename: plain(p['檔案名稱']).slice(0, 300),
      fileId, size: Number(file.size), md5: md5.toLowerCase(),
      url: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view` };
  }
  async function recordRequest(tenant, event, command) {
    if (!tenant.dataSources.messages) throw fail('unavailable');
    const messageId = String(event.message.id || '');
    if (!messageId) throw fail('unavailable');
    const existing = await query(tenant, tenant.dataSources.messages,
      { property: 'LINE 訊息 ID', rich_text: { equals: messageId } });
    if (existing.has_more || existing.results?.length > 1) throw fail('ambiguous');
    const found = existing.results?.[0];
    if (found) {
      if (!live(found) || plain(found.properties?.['LINE 群組 ID']) !== groupOf(event)
        || (!groupOf(event) && plain(found.properties?.['發送者']) !== String(event.source.userId || ''))) throw fail('unavailable');
      await request(tenant, `/v1/pages/${encodeURIComponent(found.id)}`, { method: 'PATCH', body: {
        properties: { '掛載狀態': { select: { name: '一般對話' } } },
      } });
      return;
    }
    const rt = value => ({ rich_text: value ? [textItem(value)] : [] });
    await request(tenant, '/v1/pages', { method: 'POST', body: {
      parent: { type: 'data_source_id', data_source_id: tenant.dataSources.messages },
      properties: { '訊息': { title: [textItem(String(event.message.text).slice(0, 60))] },
        '內容': rt(String(event.message.text).slice(0, 1900)), 'LINE 訊息 ID': rt(messageId),
        'LINE 群組 ID': rt(groupOf(event)), '發送者': rt(String(event.source.userId || '')),
        '時間': { date: { start: new Date(event.timestamp || Date.now()).toISOString() } },
        '訊息類型': { select: { name: '文字' } }, '掛載狀態': { select: { name: '一般對話' } },
      },
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [textItem(
        `附件索取操作；不建立任務。回覆原訊息 ID：${command.quotedMessageId || '無'}；指定檔名：${command.filename || '無'}`)] } }],
    } });
  }
  async function run(event, command) {
    let current;
    try { current = await resolve(event,command); }
    catch { logger.warn('[attachment-retrieval] routing unavailable'); return; }
    if (!allowed(current)) return; // Inactive/ambiguous/failed routes stay closed; explicit quotes use their own archive scope.
    const tenant = current.tenant;
    let text, messages;
    try {
      if(tenant.key===QUOTED_ARCHIVE_SCOPE.key){
        const existing=await platform.centralArchive.original(command.quotedMessageId,{groupId:groupOf(event),userId:event.source?.userId||''});
        if(!existing&&platform.centralArchive.recoverQuoted){
          await platform.centralArchive.recoverQuoted(event);
          // Give the durable archive worker a bounded opportunity to finish before the reply token expires.
          for(let attempt=0;attempt<12;attempt++){
            const saved=await platform.centralArchive.original(command.quotedMessageId,{groupId:groupOf(event),userId:event.source?.userId||''});
            if(saved&&!saved.pending)break;
            await new Promise(resolve=>setTimeout(resolve,1000));
          }
        }
      }else await recordRequest(tenant, event, command);
      const file = await retrieve(tenant, event, command);
      messages = await delivery.messages(tenant, event, command, file);
      text = messages[0].text;
    } catch (error) {
      text = {
        specify: '請用 LINE「回覆」功能回覆原檔案訊息，再說「請提供這個檔案給我」；也可以說「請幫我找『完整檔名.pdf』」。',
        ambiguous: '找到多筆可能的檔案，暫不提供連結。請回覆要取用的原檔案訊息，或補上不同的完整檔名。',
        not_found: '找不到這則原訊息在本對話的附件紀錄。請提供完整檔名，或請持有原檔的人重新上傳。',
        missing_original: '有附件紀錄，但尚未保存原檔，無法提供下載。請持有原檔的人重新上傳。',
        pending: '附件還在保存或重試中，尚無可取用的原檔。請稍後再試並保留原檔。',
        changed: 'Drive 檔案與保存時的原檔不一致，暫不提供連結。請聯絡管理者核對原檔。',
      }[error.code] || '目前無法確認原檔或存取保存空間，請稍後再試。';
      logger.warn(`[attachment-retrieval] result=${error.code || 'unavailable'} tenant=${tenant.key}`);
    }
    // Binding can change while Notion/Drive are being read. Revalidate before any reply.
    try {
      const latest = await resolve(event,command);
      if (!allowed(latest) || latest.tenant.key !== tenant.key) return;
      if (event.replyToken) {
        if (messages?.length > 1 && platform.replyLineMessages) {
          try { await platform.replyLineMessages(event.replyToken, messages); }
          catch (error) {
            if (error.lineStatus === 400) await platform.replyLineMessage(event.replyToken, text);
            else throw error;
          }
        } else await platform.replyLineMessage(event.replyToken, text);
      }
      // Never push after an uncertain/used reply token; redelivery cannot duplicate a link.
    } catch { logger.warn(`[attachment-retrieval] reply unavailable tenant=${tenant.key}`); }
  }
  async function handle(event) {
    const command = parseAttachmentRequest(event);
    if (!command) return false;
    const key = `${event.source?.type}:${groupOf(event) || event.source?.userId}:${event.webhookEventId || event.message.id}`;
    const seenAt = delivered.get(key);
    if (seenAt && Date.now() - seenAt < 24 * 60 * 60 * 1000) return true;
    if (!inFlight.has(key)) {
      const promise = run(event, command).finally(() => {
        inFlight.delete(key);
        delivered.set(key, Date.now());
        while (delivered.size > 5000) delivered.delete(delivered.keys().next().value);
      });
      inFlight.set(key, promise);
    }
    await inFlight.get(key);
    return true;
  }
  return { contract: ATTACHMENT_RETRIEVAL_CONTRACT, deliveryContract: delivery.contract,
    quotedArchiveContract: QUOTED_ARCHIVE_CONTRACT,
    archiveScope: QUOTED_ARCHIVE_SCOPE,
    deliveryReady: delivery.ready, handle, retrieve, handleDownload: delivery.handleDownload };
}

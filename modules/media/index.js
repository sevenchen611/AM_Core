// AM Platform 模組:media(圖片/檔案 → 理解 + 事件關聯)
// ─────────────────────────────────────────────────────────────────────────
// 通用媒體管線(EXTRACTION_PLAN 決策 5、規格 modules/media/SPEC.md)。
// 本版 = 階段 1:時間鄰近 + LINE 回覆的「事件關聯解析器」,尚無視覺判讀。
//
// 流程:collect 已落庫(訊息 + 附件記錄)並把 ctx.messagePageId / ctx.attachmentPageId 交棒。
//   media 在其後:找出這張照片所屬的「事件」(同群、時間窗內最相關的文字訊息)→
//     · 有事件 → 把附件接到事件訊息(日後確認事件時一併掛照片)、把孤立照片訊息移出確認佇列。
//     · 無事件 → 降級「相簿」(本版=移出佇列;空間相簿掛載屬 construction/階段 3)。
//
// 邊界:不碰音檔(meetings);不定義空間/工項(那是 construction 經 platform.classifyPhoto 提供,階段 3)。
//   模組未掛任何租戶前完全休眠(loadModules 只載租戶 modules 清單裡有的)。

import { textItem } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

const MEDIA_CFG = {
  windowMs: 10 * 60 * 1000, // 事件關聯時間窗:照片前後 ±10 分
  scoreMin: 0.4,            // 最高分低於此 → 視為孤兒(不強掛事件)
};

const MEDIA_TYPES = new Set(['image', 'file']);
const AUDIO_EXT = /\.(m4a|mp3|aac|wav|amr|ogg|mp4)$/i;
function isMeetingAudio(message) {
  return message.type === 'audio' || (message.type === 'file' && AUDIO_EXT.test(message.fileName || ''));
}

// ── 純函式:從候選事件中選出照片所屬的事件(可單元測試,dryrun 釘這裡)──
// photo:      { time:ms, quotedMessageId }
// candidates: [{ messagePageId, lineMessageId, time:ms, eventful:bool }]
export function resolveEvent({ photo, candidates = [], cfg = MEDIA_CFG }) {
  // 1) LINE 回覆:明確引用某訊息 → 直接鎖定,不看時間(最強訊號)
  if (photo.quotedMessageId) {
    const hit = candidates.find((c) => c.lineMessageId && c.lineMessageId === photo.quotedMessageId);
    if (hit) return { eventMessageId: hit.messagePageId, score: 1, reason: 'reply' };
  }
  // 2) 時間鄰近 × eventfulness(前後都看;有判定/問題反映的事件優先於閒聊)
  const W = cfg.windowMs;
  let best = null;
  for (const c of candidates) {
    const dt = Math.abs((c.time || 0) - (photo.time || 0));
    if (dt > W) continue;
    const timeProx = 1 - dt / W;             // 越近越高
    const eventful = c.eventful ? 1 : 0.3;   // 真事件加權,閒聊墊底
    const score = 0.6 * timeProx + 0.4 * eventful;
    if (!best || score > best.score) best = { eventMessageId: c.messagePageId, score, reason: 'time+eventful' };
  }
  return best && best.score >= cfg.scoreMin ? best : null;
}

// ── Notion I/O(未掛租戶前不會執行)──
const EVENTFUL_TYPES = new Set(['問題反映', '進度回報', '提問']);
const EVENTFUL_STATUS = new Set(['AI初判待確認', '已確認']);
const plainText = (rt) => (rt || []).map((x) => x.plain_text || x.text?.content || '').join('');

// 查同群、時間窗內的文字訊息當候選事件
async function queryCandidates(ctx, photoTimeMs) {
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  const ds = ctx.tenant?.dataSources?.messages;
  if (!ds || !ctx.groupId) return [];
  const from = new Date(photoTimeMs - MEDIA_CFG.windowMs).toISOString();
  const to = new Date(photoTimeMs + MEDIA_CFG.windowMs).toISOString();
  const res = await notionRequest(`/v1/data_sources/${encodeURIComponent(ds)}/query`, {
    method: 'POST',
    body: {
      filter: { and: [
        { property: '訊息類型', select: { equals: '文字' } },
        { property: 'LINE 群組 ID', rich_text: { contains: ctx.groupId } },
        { property: '時間', date: { on_or_after: from } },
        { property: '時間', date: { on_or_before: to } },
      ] },
      page_size: 50,
    },
  });
  return (res.results || []).map((p) => {
    const pr = p.properties || {};
    const status = pr['掛載狀態']?.select?.name || '';
    const aiType = pr['AI 訊息類型']?.select?.name || '';
    return {
      messagePageId: p.id,
      lineMessageId: plainText(pr['LINE 訊息 ID']?.rich_text),
      time: new Date(pr['時間']?.date?.start || 0).getTime(),
      eventful: EVENTFUL_STATUS.has(status) || EVENTFUL_TYPES.has(aiType),
    };
  }).filter((c) => c.messagePageId !== ctx.messagePageId); // 別把自己算進去
}

// 把附件接到事件訊息(讓後續「確認事件」時,archiveAttachments 一併掛照片)
async function linkAttachmentToEvent(ctx, eventMessageId) {
  if (!ctx.attachmentPageId) return;
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  await notionRequest(`/v1/pages/${encodeURIComponent(ctx.attachmentPageId)}`, {
    method: 'PATCH',
    body: { properties: { '訊息': { relation: [{ id: eventMessageId }] } } },
  }).catch((e) => console.warn(`[media] link attachment failed: ${e.message}`));
}

// 把照片訊息移出確認佇列(已由事件代表,或降級相簿)
async function archivePhotoMessage(ctx, note) {
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  await notionRequest(`/v1/pages/${encodeURIComponent(ctx.messagePageId)}`, {
    method: 'PATCH',
    body: { properties: {
      '掛載狀態': { select: { name: '一般對話' } },
      '確認者': { rich_text: [textItem(note)] },
      '確認時間': { date: { start: new Date().toISOString() } },
    } },
  }).catch((e) => console.warn(`[media] archive photo message failed: ${e.message}`));
}

async function onMessage(ctx) {
  const { message } = ctx;
  if (!MEDIA_TYPES.has(message.type) || isMeetingAudio(message)) return false; // 非圖片/檔案 or 音檔 → 不是 media 的事
  if (!ctx.messagePageId) return false; // collect 尚未落庫(理論上不會發生)

  const photoTimeMs = new Date(ctx.event?.timestamp || Date.now()).getTime();
  let candidates = [];
  try { candidates = await queryCandidates(ctx, photoTimeMs); }
  catch (e) { console.warn(`[media] candidate query failed: ${e.message}`); }

  const photo = { time: photoTimeMs, quotedMessageId: message.quotedMessageId || '' };
  const event = resolveEvent({ photo, candidates });

  if (event) {
    await linkAttachmentToEvent(ctx, event.eventMessageId);
    await archivePhotoMessage(ctx, `葉小蝸(media 關聯事件·${event.reason})`);
    console.log(`[media] tenant=${ctx.tenant?.key} photo ${ctx.messagePageId} → event ${event.eventMessageId} (${event.reason}, score=${event.score.toFixed(2)}).`);
  } else {
    await archivePhotoMessage(ctx, '葉小蝸(media 相簿降級·無關聯事件)');
    console.log(`[media] tenant=${ctx.tenant?.key} photo ${ctx.messagePageId} → orphan album.`);
  }
  return true; // media 已處理此圖片/檔案訊息
}

// ── 模組契約 ──
export default { name: 'media', init, onMessage };
export const __test = { resolveEvent, MEDIA_CFG, isMeetingAudio };

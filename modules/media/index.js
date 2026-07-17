// AM Platform 模組:media(圖片/檔案 → 理解 + 事件關聯)
// ─────────────────────────────────────────────────────────────────────────
// 通用媒體管線(EXTRACTION_PLAN 決策 5、規格 modules/media/SPEC.md)。
//   階段1:時間鄰近 + LINE 回覆的事件關聯。
//   階段2:MiniMax M3 視覺判讀(主題/標籤/說明/是否證據)→ 檔名 slug + `AI影像判讀` 欄位 +
//          語意訊號回饋給關聯解析器(照片主題 vs 事件文字)。
//   階段3:孤兒照片交領域掛鉤 `platform.classifyPhoto`(construction 提供空間相簿),無則日期相簿。
//
// 流程:collect 已落庫(訊息 + 附件)並交棒 ctx.messagePageId / ctx.attachmentPageId / ctx.media(圖片 buffer)。
//   media 於其後:視覺判讀 → 找所屬事件(同群、時間窗、語意)→ 有事件就把附件接到事件、把孤立照片訊息
//   移出佇列;無事件則交 construction 決定空間相簿、無領域則日期相簿。
//
// 邊界:不碰音檔(meetings);空間/工項詞彙一律來自 construction(classifyPhoto),media 不自帶。
//   模組未掛任何租戶前完全休眠。視覺判讀走 platform.llm(imagePaths 吃磁碟檔 → 寫暫存再清)。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { textItem } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

const MEDIA_CFG = {
  windowMs: 10 * 60 * 1000, // 事件關聯時間窗:照片前後 ±10 分
  scoreMin: 0.4,            // 最高分低於此 → 孤兒(不強掛事件)
};

const MEDIA_TYPES = new Set(['image', 'file']);
const AUDIO_EXT = /\.(m4a|mp3|aac|wav|amr|ogg|mp4)$/i;
function isMeetingAudio(message) {
  return message.type === 'audio' || (message.type === 'file' && AUDIO_EXT.test(message.fileName || ''));
}

// ── 視覺判讀 ──────────────────────────────────────────────
const VISION_SCHEMA = {
  type: 'object',
  required: ['topic', 'caption', 'tags', 'isEvidence'],
  properties: {
    topic: { type: 'string' }, caption: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }, isEvidence: { type: 'boolean' },
  },
};
const VISION_SYSTEM = '你是工地/工程照片的判讀助手。看圖回報:主題 topic(短詞)、一句說明 caption、'
  + '關鍵標籤 tags(3~6 個名詞,如「漏水」「磁磚」「配電箱」「天花板」)、是否為問題/瑕疵/證據照 isEvidence。'
  + '只描述看得見的,不臆測用途或責任。';

// ── 純函式(可單元測試,dryrun 釘這裡)────────────────────────
// 語意重疊:照片關鍵詞出現在事件文字裡的比例(對中文以子字串命中,足夠當階段2的消歧義訊號)。
export function semanticSim(terms, text) {
  if (!terms.length || !text) return 0;
  let hits = 0;
  for (const t of terms) if (t && text.includes(t)) hits += 1;
  return Math.min(1, hits / Math.min(terms.length, 3));
}

// 從候選事件中選出照片所屬的事件。
// photo:      { time:ms, quotedMessageId, topic, tags[] }
// candidates: [{ messagePageId, lineMessageId, time:ms, eventful:bool, text }]
export function resolveEvent({ photo, candidates = [], cfg = MEDIA_CFG }) {
  // 1) LINE 回覆:明確引用某訊息 → 直接鎖定(最強訊號,不看時間)
  if (photo.quotedMessageId) {
    const hit = candidates.find((c) => c.lineMessageId && c.lineMessageId === photo.quotedMessageId);
    if (hit) return { eventMessageId: hit.messagePageId, score: 1, reason: 'reply' };
  }
  // 2) 時間鄰近 × eventfulness × 語意(前後都看)
  const terms = [photo.topic, ...(photo.tags || [])].filter(Boolean);
  const W = cfg.windowMs;
  let best = null;
  for (const c of candidates) {
    const dt = Math.abs((c.time || 0) - (photo.time || 0));
    if (dt > W) continue;
    const timeProx = 1 - dt / W;
    const eventful = c.eventful ? 1 : 0.3;
    const sem = semanticSim(terms, c.text || '');
    const score = 0.4 * timeProx + 0.3 * eventful + 0.3 * sem;
    if (!best || score > best.score) best = { eventMessageId: c.messagePageId, score, reason: sem > 0 ? 'time+semantic' : 'time+eventful' };
  }
  return best && best.score >= cfg.scoreMin ? best : null;
}

// slug:去非法字元 + 長度上限
function slugify(s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 20); }
function buildSlug({ dateStr, place, topic }) {
  return [dateStr, slugify(place), slugify(topic)].filter(Boolean).join('_');
}

// 視覺判讀:寫暫存檔 → platform.llm(imagePaths)→ 清檔。任何失敗回 null(不擋關聯)。
async function visionJudge(ctx) {
  const media = ctx.media;
  const llm = platform?.llmForTenant?.(ctx.tenant) || platform?.llm;
  if (!media?.buffer || !llm?.available) return null;
  const ct = media.contentType || '';
  const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  const tmp = path.join(os.tmpdir(), `media-${crypto.randomBytes(8).toString('hex')}${ext}`);
  try {
    fs.writeFileSync(tmp, Buffer.from(media.buffer));
    const v = await llm.completeJson({
      system: VISION_SYSTEM, userContent: '判讀這張照片。', schema: VISION_SCHEMA,
      imagePaths: [tmp], profile: 'cheap', maxTokens: 800, budgetMs: 60_000,
    });
    return {
      topic: String(v.topic || '').slice(0, 40),
      caption: String(v.caption || '').slice(0, 200),
      tags: (Array.isArray(v.tags) ? v.tags : []).map(String).filter(Boolean).slice(0, 8),
      isEvidence: Boolean(v.isEvidence),
    };
  } catch (e) {
    console.warn(`[media] vision failed: ${e.message}`);
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 暫存檔清理失敗無妨 */ }
  }
}

// ── Notion I/O(未掛租戶前不會執行)──
const EVENTFUL_TYPES = new Set(['問題反映', '進度回報', '提問']);
const EVENTFUL_STATUS = new Set(['AI初判待確認', '已確認']);
const plainText = (rt) => (rt || []).map((x) => x.plain_text || x.text?.content || '').join('');

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
    return {
      messagePageId: p.id,
      lineMessageId: plainText(pr['LINE 訊息 ID']?.rich_text),
      time: new Date(pr['時間']?.date?.start || 0).getTime(),
      text: plainText(pr['內容']?.rich_text),
      eventful: EVENTFUL_STATUS.has(pr['掛載狀態']?.select?.name || '') || EVENTFUL_TYPES.has(pr['AI 訊息類型']?.select?.name || ''),
    };
  }).filter((c) => c.messagePageId !== ctx.messagePageId);
}
async function queryCandidatesSafe(ctx, t) {
  try { return await queryCandidates(ctx, t); }
  catch (e) { console.warn(`[media] candidate query failed: ${e.message}`); return []; }
}

// 判讀寫回附件:檔名 slug(一定寫)+ AI影像判讀 JSON(該欄位不存在時退回只寫 slug,不因缺欄位而整批失敗)。
async function writeVision(ctx, vision, photoTimeMs, place) {
  if (!ctx.attachmentPageId) return;
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  const dateStr = new Date(photoTimeMs + 8 * 3600 * 1000).toISOString().slice(0, 10); // 台北日
  const slug = buildSlug({ dateStr, place, topic: vision.topic });
  const nameProps = {
    '附件項目': { title: [textItem(slug || vision.topic || '照片')] },
    '檔案名稱': { rich_text: [textItem(slug)] },
  };
  const judged = { ...vision, resolvedAt: new Date().toISOString(), model: 'platform.llm' };
  const url = `/v1/pages/${encodeURIComponent(ctx.attachmentPageId)}`;
  try {
    await notionRequest(url, { method: 'PATCH', body: { properties: { ...nameProps, 'AI影像判讀': { rich_text: [textItem(JSON.stringify(judged).slice(0, 1900))] } } } });
  } catch (e) {
    // 多半是租戶附件庫還沒有「AI影像判讀」欄位 → 至少把檔名 slug 寫進去(slug 用的欄位一定存在)。
    console.warn(`[media] write vision full failed (${e.message}); slug-only fallback.`);
    await notionRequest(url, { method: 'PATCH', body: { properties: nameProps } }).catch((e2) => console.warn(`[media] write slug failed: ${e2.message}`));
  }
}

async function linkAttachmentToEvent(ctx, eventMessageId) {
  if (!ctx.attachmentPageId) return;
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  await notionRequest(`/v1/pages/${encodeURIComponent(ctx.attachmentPageId)}`, {
    method: 'PATCH',
    body: { properties: { '訊息': { relation: [{ id: eventMessageId }] } } },
  }).catch((e) => console.warn(`[media] link attachment→event failed: ${e.message}`));
}

async function linkAttachmentToSpace(ctx, spaceId) {
  if (!ctx.attachmentPageId) return;
  const notionRequest = ctx.notionRequest || platform.notionRequest;
  await notionRequest(`/v1/pages/${encodeURIComponent(ctx.attachmentPageId)}`, {
    method: 'PATCH',
    body: { properties: { '空間': { relation: [{ id: spaceId }] } } },
  }).catch((e) => console.warn(`[media] link attachment→space failed: ${e.message}`));
}

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
  if (!ctx.messagePageId) return false;

  const photoTimeMs = new Date(ctx.event?.timestamp || Date.now()).getTime();
  // 視覺判讀與候選查詢並行
  const [vision, candidates] = await Promise.all([visionJudge(ctx), queryCandidatesSafe(ctx, photoTimeMs)]);

  const photo = { time: photoTimeMs, quotedMessageId: message.quotedMessageId || '', topic: vision?.topic || '', tags: vision?.tags || [] };
  const event = resolveEvent({ photo, candidates });

  // 有事件:附件接到事件(日後確認事件一併掛照片)+ 孤立照片訊息移出佇列
  if (event) {
    if (vision) await writeVision(ctx, vision, photoTimeMs).catch((e) => console.warn(`[media] write vision: ${e.message}`));
    await linkAttachmentToEvent(ctx, event.eventMessageId);
    await archivePhotoMessage(ctx, `葉小蝸(media 關聯事件·${event.reason})`);
    console.log(`[media] tenant=${ctx.tenant?.key} photo → event ${event.eventMessageId} (${event.reason}, score=${event.score.toFixed(2)}).`);
    return true;
  }

  // 孤兒:交 construction 決定空間相簿(非工程租戶自動回 null)→ 無則通用日期相簿
  let domain = null;
  if (typeof platform.classifyPhoto === 'function') {
    try { domain = await platform.classifyPhoto({ tenant: ctx.tenant, binding: ctx.binding, photo: vision || {}, event: null }); }
    catch (e) { console.warn(`[media] classifyPhoto failed: ${e.message}`); }
  }
  const place = domain?.space?.name || '';
  if (vision) await writeVision(ctx, vision, photoTimeMs, place).catch((e) => console.warn(`[media] write vision: ${e.message}`));
  if (domain?.space?.id) {
    await linkAttachmentToSpace(ctx, domain.space.id);
    await archivePhotoMessage(ctx, `葉小蝸(media 空間相簿·${place})`);
  } else {
    await archivePhotoMessage(ctx, '葉小蝸(media 相簿降級·日期)');
  }
  console.log(`[media] tenant=${ctx.tenant?.key} photo → album (${place || 'date'}).`);
  return true;
}

// ── 模組契約 ──
export default { name: 'media', init, onMessage };
export const __test = { resolveEvent, semanticSim, MEDIA_CFG, isMeetingAudio, buildSlug };

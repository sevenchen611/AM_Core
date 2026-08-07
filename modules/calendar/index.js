import { isCalendarCommand, isCreateGuideCommand, queryKind } from './commands.js';

let platform;
const pendingCreates = new Map();
const recentLists = new Map();
const STATE_TTL_MS = 15 * 60 * 1000;

function clean(value) { return String(value || '').trim(); }
function stateKey(ctx) { return `${ctx.tenant?.key || ''}:${ctx.directUserId || ''}`; }
function eventKey(ctx, suffix) {
  const eventId = clean(ctx.event?.webhookEventId || ctx.message?.id || ctx.event?.timestamp || Date.now());
  return `calendar:${suffix}:${eventId}`;
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateAtOffset(offset = 0) {
  const parts = taipeiParts();
  const utc = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset));
  return utc.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function weekRange() {
  const today = dateAtOffset(0);
  const [year, month, day] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return { fromDate: addDays(today, mondayOffset), toDate: addDays(today, mondayOffset + 6) };
}

function queryRange(kind) {
  if (kind === 'yesterday') {
    const yesterday = dateAtOffset(-1);
    return { fromDate: yesterday, toDate: yesterday, label: '昨天未完成' };
  }
  if (kind === 'week') return { ...weekRange(), label: '這週' };
  const today = dateAtOffset(0);
  return { fromDate: today, toDate: today, label: '今天' };
}

function normalizeDateToken(token) {
  const text = clean(token);
  if (text === '今天') return dateAtOffset(0);
  if (text === '明天') return dateAtOffset(1);
  if (text === '後天') return dateAtOffset(2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slash) {
    const current = taipeiParts();
    return `${current.year}-${String(slash[1]).padStart(2, '0')}-${String(slash[2]).padStart(2, '0')}`;
  }
  return '';
}

function parseCreateCommand(value) {
  const matched = clean(value).match(/^(?:新增|安排)(?:工作|行程|待辦)?\s+([\s\S]+)$/u);
  if (!matched) return null;
  let rest = matched[1].trim();
  const dateMatch = rest.match(/(?:^|\s)(今天|明天|後天|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})(?=\s|$)/u);
  const timeMatch = rest.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/u);
  const scheduledDate = normalizeDateToken(dateMatch?.[1]);
  if (dateMatch) rest = rest.replace(dateMatch[0], ' ');
  if (timeMatch) rest = rest.replace(timeMatch[0], ' ');
  const title = rest.replace(/\s+/g, ' ').trim();
  if (!title || !scheduledDate) return { error: '請把日期一起告訴我，例如：新增工作 明天 10:00 回覆房東。' };
  const time = timeMatch ? `${String(timeMatch[1]).padStart(2, '0')}:${timeMatch[2]}` : '';
  const startAt = time ? `${scheduledDate}T${time}:00+08:00` : '';
  return { title, scheduledDate, startAt };
}

function createGuideMessage() {
  return [
    '請直接把日期和內容一起丟給我，我會先幫你整理，再等你確認才寫入。',
    '',
    '範例：',
    '新增待辦 明天 10:00 回覆房東',
    '新增工作 今天 整理請款附件',
    '安排行程 8/10 15:30 和 Bonnie 確認合約',
    '',
    '送出後回覆「確認新增」才會真正建立；回覆「取消新增」就不寫入。',
  ].join('\n');
}

function parseItemAction(value) {
  const text = clean(value);
  let matched = text.match(/^(完成|取消|刪除)\s*(\d+)$/u);
  if (matched) return { action: matched[1] === '完成' ? 'complete' : 'cancel', number: Number(matched[2]) };
  matched = text.match(/^延到明天\s*(\d+)$/u);
  if (matched) return { action: 'move', number: Number(matched[1]), scheduledDate: dateAtOffset(1) };
  matched = text.match(/^改期\s*(\d+)\s+(今天|明天|後天|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})$/u);
  if (matched) return { action: 'move', number: Number(matched[1]), scheduledDate: normalizeDateToken(matched[2]) };
  matched = text.match(/^提醒我\s*(\d+)\s+(今天|明天|後天|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\s+([01]?\d|2[0-3]):([0-5]\d)$/u);
  if (matched) {
    const date = normalizeDateToken(matched[2]);
    return { action: 'remind', number: Number(matched[1]), remindAt: `${date}T${String(matched[3]).padStart(2, '0')}:${matched[4]}:00+08:00` };
  }
  return null;
}

function activeState(map, key) {
  const state = map.get(key);
  if (!state || Date.now() - state.at > STATE_TTL_MS) { map.delete(key); return null; }
  return state;
}

function itemLabel(item, index) {
  const status = ({ planned: '待辦', in_progress: '進行中', waiting: '等待中', completed: '完成', cancelled: '取消' })[item.status] || item.status;
  const source = item.sourceSystem === 'line' ? '個人' : 'AM';
  const time = item.startAt ? new Date(item.startAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) : '整日';
  return `${index + 1}. ${time}｜${item.title}｜${status}｜${source}`;
}

async function reply(ctx, text) {
  await platform.replyLineMessage(ctx.event.replyToken, text);
}

async function handleQuery(ctx, kind) {
  const range = queryRange(kind);
  const result = await platform.calendarPersonalQuery({
    tenantKey: ctx.tenant.key,
    lineUserId: ctx.directUserId,
    fromDate: range.fromDate,
    toDate: range.toDate,
    includeClosed: false,
  });
  if (!result?.ok) {
    await reply(ctx, result?.status === 403
      ? [
        '⚠️ Rental Calendar 身分尚未綁定，暫時不能讀取你的私人行程。',
        '',
        '請先到 HOZO Rental Portal 的個人設定產生一次性 6 碼綁定碼，',
        '再回到葉小蝸一對一聊天室輸入：綁定 123456',
        '',
        '完成後再點「我的今日」或「我的行事曆」即可測試。',
      ].join('\n')
      : '⚠️ 目前無法讀取個人行程，系統已保留錯誤紀錄。');
    return true;
  }
  const items = (result.items || []).slice(0, 20);
  recentLists.set(stateKey(ctx), { at: Date.now(), items });
  if (!items.length) {
    await reply(ctx, `📅 ${range.label}沒有未完成行程。\n\n新增方式：新增工作 明天 10:00 回覆房東`);
    return true;
  }
  await reply(ctx, [`📅 ${range.label}行程`, '', ...items.map(itemLabel), '', '可回覆：完成 1／延到明天 1／改期 1 8/10／取消 1'].join('\n'));
  return true;
}

async function handleCreate(ctx) {
  const parsed = parseCreateCommand(ctx.text);
  if (!parsed) return false;
  if (parsed.error) { await reply(ctx, parsed.error); return true; }
  pendingCreates.set(stateKey(ctx), { at: Date.now(), item: parsed, requestId: eventKey(ctx, 'create') });
  await reply(ctx, [
    '請確認新增個人工作：',
    `日期：${parsed.scheduledDate}${parsed.startAt ? ` ${parsed.startAt.slice(11, 16)}` : '（整日）'}`,
    `內容：${parsed.title}`,
    '',
    '回覆「確認新增」才會寫入；回覆「取消新增」則不寫入。',
  ].join('\n'));
  return true;
}

async function handleCreateGuide(ctx) {
  if (!isCreateGuideCommand(ctx.text)) return false;
  await reply(ctx, createGuideMessage());
  return true;
}

async function handleCreateConfirmation(ctx) {
  const text = clean(ctx.text);
  if (!['確認新增', '取消新增'].includes(text)) return false;
  const key = stateKey(ctx);
  const pending = activeState(pendingCreates, key);
  if (!pending) { await reply(ctx, '這次新增確認已過期，請重新輸入新增工作指令。'); return true; }
  pendingCreates.delete(key);
  if (text === '取消新增') { await reply(ctx, '已取消，沒有寫入任何行程。'); return true; }
  const result = await platform.calendarPersonalCreate({
    tenantKey: ctx.tenant.key,
    lineUserId: ctx.directUserId,
    item: pending.item,
    idempotencyKey: pending.requestId,
  });
  if (!result?.ok) { await reply(ctx, '⚠️ 個人工作沒有新增成功，這次沒有寫入資料。'); return true; }
  await reply(ctx, `✅ 已新增：${result.item.scheduledDate}｜${result.item.title}`);
  return true;
}

async function handleItemAction(ctx) {
  const parsed = parseItemAction(ctx.text);
  if (!parsed) return false;
  const list = activeState(recentLists, stateKey(ctx));
  const item = list?.items?.[parsed.number - 1];
  if (!item) { await reply(ctx, '找不到這個編號。請先輸入「我的今天」或「這週」取得最新清單。'); return true; }
  if (item.actionPolicy !== 'personal_edit') {
    await reply(ctx, '這是 AM 來源工作，目前只能查看，不能從 Calendar 直接修改來源狀態。');
    return true;
  }
  const result = await platform.calendarPersonalUpdate({
    tenantKey: ctx.tenant.key,
    lineUserId: ctx.directUserId,
    update: { itemId: item.id, action: parsed.action, scheduledDate: parsed.scheduledDate, remindAt: parsed.remindAt },
    idempotencyKey: eventKey(ctx, `${parsed.action}:${item.id}`),
  });
  if (!result?.ok) { await reply(ctx, '⚠️ 行程沒有更新成功，這次沒有變更資料。'); return true; }
  list.items.splice(parsed.number - 1, 1);
  const actionLabel = ({ complete: '已完成', cancel: '已取消', move: `已改到 ${parsed.scheduledDate}`, remind: '已設定提醒' })[parsed.action];
  await reply(ctx, `✅ ${actionLabel}：${item.title}`);
  return true;
}

export default {
  name: 'calendar',
  init(sharedPlatform) { platform = sharedPlatform; },
  async onDirectMessage(ctx) {
    if (!isCalendarCommand(ctx.text)) return false;
    if (!ctx.event?.replyToken) return false;
    if (!platform?.calendarIntegrationConfigured) {
      await reply(ctx, '⚠️ Calendar 服務目前尚未設定完成，這次沒有寫入資料。');
      return true;
    }
    if (await handleCreateConfirmation(ctx)) return true;
    if (await handleCreateGuide(ctx)) return true;
    if (await handleCreate(ctx)) return true;
    if (await handleItemAction(ctx)) return true;
    const kind = queryKind(ctx.text);
    return kind ? handleQuery(ctx, kind) : false;
  },
  routes: [],
};

export { createGuideMessage, dateAtOffset, parseCreateCommand, parseItemAction, queryRange };

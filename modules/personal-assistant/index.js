// 葉小蝸一對一私人助理。
// 私人待辦以 AM Platform tasks 資料源為唯一寫入目標；Rental Calendar 只保留為外部投影/檢視能力。

let platform;

const STATE_TTL_MS = 20 * 60 * 1000;
const pendingCreates = new Map();
const recentLists = new Map();
const DELEGATED_COMMANDS = new Set(['請款', '我要請款', '請款按鈕', '開啟請款', '#請款']);

function clean(value) {
  return String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function isDelegatedCommand(value) {
  const text = clean(value);
  return DELEGATED_COMMANDS.has(text) || /^#請款\s+[\s\S]+$/u.test(text);
}

function identityLabel(ctx) {
  return ctx.personalBinding?.displayName || ctx.senderName || '夥伴';
}

function stateKey(ctx) {
  return `${ctx.tenant?.key || ''}:${ctx.directUserId || ''}`;
}

function activeState(map, key) {
  const state = map.get(key);
  if (!state || Date.now() - state.at > STATE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return state;
}

function taipeiDate(offset = 0, base = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(base);
  const obj = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const utc = new Date(Date.UTC(Number(obj.year), Number(obj.month) - 1, Number(obj.day) + offset));
  return utc.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const [year, month, day] = String(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function weekRange() {
  const today = taipeiDate();
  const [year, month, day] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return { fromDate: addDays(today, mondayOffset), toDate: addDays(today, mondayOffset + 6), label: '本週' };
}

function queryRange(kind) {
  if (kind === 'yesterday') {
    const date = taipeiDate(-1);
    return { fromDate: date, toDate: date, label: '昨日未完成' };
  }
  if (kind === 'week') return weekRange();
  const today = taipeiDate();
  return { fromDate: today, toDate: today, label: '今天' };
}

function normalizeDateToken(token) {
  const text = clean(token);
  if (!text || /^(今天|今日)$/u.test(text)) return taipeiDate();
  if (/^明天$/u.test(text)) return taipeiDate(1);
  if (/^後天$/u.test(text)) return taipeiDate(2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slash) {
    const year = taipeiDate().slice(0, 4);
    return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }
  return '';
}

function normalizeTimeToken(token, meridiem = '') {
  const match = clean(token).match(/^([0-2]?\d)(?::([0-5]\d))?$/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = match[2] || '00';
  const label = clean(meridiem);
  if (/下午|晚上|晚間|中午/u.test(label) && hour < 12) hour += 12;
  if (/凌晨|早上|上午/u.test(label) && hour === 12) hour = 0;
  if (hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function normalizeDue(item, fallbackDate = taipeiDate()) {
  const date = normalizeDateToken(item.date || item.dueDate || '') || fallbackDate;
  const time = normalizeTimeToken(item.time || '', item.meridiem || '');
  return time ? `${date} ${time}` : date;
}

function stripCreatePrefix(text) {
  return clean(text).replace(/^(?:新增|安排)(?:我的)?(?:工作|行程|待辦|任務)?\s*[:：]?\s*/u, '').trim();
}

function parseLineItem(line) {
  let text = clean(line).replace(/^\d+[.、)]\s*/u, '').replace(/^[-*•]\s*/u, '').trim();
  if (!text) return null;
  const dateMatch = text.match(/(今天|今日|明天|後天|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})/u);
  const timeMatch = text.match(/(上午|早上|下午|晚上|晚間|中午|凌晨)?\s*([0-2]?\d(?::[0-5]\d)?)/u);
  let date = dateMatch ? normalizeDateToken(dateMatch[1]) : '';
  let time = '';
  if (timeMatch && /[:：]|上午|早上|下午|晚上|晚間|中午|凌晨/u.test(timeMatch[0])) {
    time = normalizeTimeToken(timeMatch[2].replace('：', ':'), timeMatch[1] || '');
  }
  if (dateMatch) text = text.replace(dateMatch[0], ' ');
  if (timeMatch && time) text = text.replace(timeMatch[0], ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { content: text, date, time };
}

function parseTasksFallback(text) {
  const body = stripCreatePrefix(text);
  if (!body) return [];
  const lines = body.split(/\n+/).map(parseLineItem).filter(Boolean);
  const candidates = lines.length > 1 ? lines : [parseLineItem(body)].filter(Boolean);
  return candidates.map((item) => ({
    content: item.content,
    due: item.time ? `${item.date || taipeiDate()} ${item.time}` : (item.date || taipeiDate()),
  }));
}

function looksLikeCreate(text) {
  return /^(?:新增|安排)(?:我的)?(?:工作|行程|待辦|任務)?\s*[:：]?/u.test(clean(text));
}

function queryKind(value) {
  const text = clean(value);
  if (/^(?:昨天|昨日)未完(?:成)?[？?]?$/u.test(text)) return 'yesterday';
  if (/^(?:我的)?(?:行事曆|這週|本週)(?:行程|工作|待辦)?[？?]?$/u.test(text)) return 'week';
  if (/^(?:我的)?(?:今天|今日)(?:行程|工作|待辦)?[？?]?$/u.test(text)) return 'today';
  if (/待辦.*(?:安排|好了|有沒有|嗎)|(?:查|看|列出).*(?:待辦|行程)/u.test(text)) return 'today';
  return '';
}

function parseItemAction(value) {
  const text = clean(value);
  const matched = text.match(/^(完成|取消|刪除|進行中)\s*(\d+)$/u);
  if (!matched) return null;
  return {
    status: matched[1] === '完成' ? '完成' : matched[1] === '進行中' ? '進行中' : '取消',
    number: Number(matched[2]),
  };
}

function sourceEvidence(ctx) {
  const timestamp = ctx.event?.timestamp ? new Date(ctx.event.timestamp).toISOString() : new Date().toISOString();
  return [
    'LINE 一對一私人助理',
    `租戶：${ctx.tenant?.displayName || ctx.tenant?.key || ''}`,
    `送出者：${identityLabel(ctx)}`,
    `時間：${timestamp}`,
    `原文：${clean(ctx.text)}`,
  ].join('\n');
}

function eventKey(ctx, suffix) {
  const eventId = clean(ctx.event?.webhookEventId || ctx.message?.id || ctx.event?.timestamp || Date.now());
  return `personal-task:${suffix}:${eventId}`;
}

function formatTask(item, index) {
  const due = item.due || '未排日期';
  return `${index + 1}. ${due}｜${item.content}`;
}

function taskRow(task) {
  if (typeof platform?.tasks?.taskRow === 'function') return platform.tasks.taskRow(task);
  const p = task.properties || {};
  const plain = (prop, kind) => (prop?.[kind] || []).map((t) => t.plain_text).join('');
  const due = p['期限']?.date?.start || '';
  return {
    id: task.id,
    content: plain(p['內容'], 'title'),
    owner: plain(p['負責人'], 'rich_text'),
    due: due.includes('T') ? `${due.slice(0, 10)} ${due.slice(11, 16)}` : due.slice(0, 10),
    status: p['狀態']?.select?.name || '',
    source: p['來源']?.select?.name || '',
  };
}

async function reply(ctx, text) {
  if (ctx.event?.replyToken) await platform.replyLineMessage(ctx.event.replyToken, text);
}

async function parseTasksWithLlm(ctx) {
  const fallback = parseTasksFallback(ctx.text);
  const llm = platform.llmForTenant?.(ctx.tenant) || platform.llm;
  if (!llm?.available) return fallback;
  const schema = {
    type: 'object',
    required: ['intent', 'tasks'],
    properties: {
      intent: { type: 'string', enum: ['create_tasks', 'query_tasks', 'update_tasks', 'unknown'] },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string' },
            meridiem: { type: 'string' },
          },
        },
      },
    },
  };
  try {
    const result = await llm.completeJson({
      profile: 'cheap',
      maxTokens: 1200,
      timeoutMs: 45_000,
      budgetMs: 90_000,
      system: [
        '你是 HOZO AM 2.0 的私人待辦解析器。',
        '只判斷使用者是否要新增私人待辦；若是，拆成多筆 task。',
        '使用繁體中文。不要把「我的今天、確認新增、取消新增、完成 1」這類操作指令當成待辦。',
        '沒有日期但使用者明確在新增待辦時，date 留空，系統會用今天。',
      ].join('\n'),
      userContent: [
        `今天日期：${taipeiDate()}`,
        `使用者：${identityLabel(ctx)}`,
        `訊息：${clean(ctx.text)}`,
      ].join('\n'),
      schema,
    });
    if (result?.intent !== 'create_tasks') return [];
    const tasks = (result.tasks || [])
      .map((item) => ({
        content: clean(item.content),
        due: normalizeDue(item),
      }))
      .filter((item) => item.content);
    return tasks.length ? tasks.slice(0, 20) : fallback;
  } catch (error) {
    platform.logger?.warn?.(`personal assistant LLM parse failed: ${error.message}`);
    return fallback;
  }
}

async function handleCreateGuide(ctx) {
  const text = clean(ctx.text);
  if (!/^(?:新增|安排)(?:工作|行程|待辦|任務)?[？?]?$/u.test(text)) return false;
  await reply(ctx, [
    '可以，直接把日期和內容一起丟給我；一次多筆也可以。',
    '',
    '例如：',
    '新增待辦：',
    '1. 10:00 回臺北',
    '2. 下午1:00 帶家人去吃飯',
    '3. 晚上19:00 回家',
    '',
    '我會先整理成清單，等你回「確認新增」才寫入 AM 任務。'
  ].join('\n'));
  return true;
}

async function handleCreate(ctx) {
  if (!looksLikeCreate(ctx.text)) return false;
  const tasks = await parseTasksWithLlm(ctx);
  if (!tasks.length) {
    await reply(ctx, '我有收到「新增待辦」的意圖，但還沒抓到可寫入的內容。請把每一件事分行列出，或直接寫「新增待辦 明天 10:00 回覆房東」。');
    return true;
  }
  const pending = {
    at: Date.now(),
    tasks,
    evidence: sourceEvidence(ctx),
    requestId: eventKey(ctx, 'create'),
  };
  pendingCreates.set(stateKey(ctx), pending);
  await reply(ctx, [
    `我整理成 ${tasks.length} 筆待辦，先讓你確認：`,
    '',
    ...tasks.map(formatTask),
    '',
    '回覆「確認新增」後，我會寫入 AM 任務；回覆「取消新增」就不寫入。'
  ].join('\n'));
  return true;
}

async function handleCreateConfirmation(ctx) {
  const text = clean(ctx.text);
  if (!['確認新增', '取消新增'].includes(text)) return false;
  const key = stateKey(ctx);
  const pending = activeState(pendingCreates, key);
  if (!pending) {
    await reply(ctx, '這次新增確認已過期或不存在，請重新輸入新的新增待辦內容。');
    return true;
  }
  pendingCreates.delete(key);
  if (text === '取消新增') {
    await reply(ctx, '已取消，沒有寫入任何待辦。');
    return true;
  }
  if (typeof platform.tasks?.createTask !== 'function') {
    await reply(ctx, 'AM 任務服務尚未就緒，這次沒有寫入任何待辦。');
    return true;
  }
  const owner = identityLabel(ctx);
  const created = [];
  for (const task of pending.tasks) {
    try {
      const id = await platform.tasks.createTask(ctx, {
        content: task.content,
        owner,
        ownerLineUserId: ctx.directUserId,
        due: task.due,
        source: '手動',
        status: '待辦',
        sourceEvidence: pending.evidence,
      });
      created.push({ ...task, id, status: '待辦' });
    } catch (error) {
      platform.logger?.warn?.(`personal task create failed: ${error.message}`);
    }
  }
  recentLists.set(key, { at: Date.now(), items: created.map((item) => ({ id: item.id, ...item })) });
  await reply(ctx, created.length
    ? [`已新增 ${created.length} 筆 AM 待辦：`, '', ...created.map(formatTask)].join('\n')
    : '這次沒有成功寫入待辦，請稍後再試或通知管理者。');
  return true;
}

async function handleQuery(ctx, kind) {
  const range = queryRange(kind);
  const owner = identityLabel(ctx);
  const rows = typeof platform.tasks?.listByOwner === 'function'
    ? await platform.tasks.listByOwner(ctx, { owner, fromDate: range.fromDate, toDate: range.toDate, includeClosed: false, limit: 20 })
    : [];
  const items = rows.map(taskRow);
  recentLists.set(stateKey(ctx), { at: Date.now(), items });
  if (!items.length) {
    await reply(ctx, `${range.label}目前沒有未完成待辦。\n\n要新增可以直接說：「新增待辦 明天 10:00 回覆房東」。`);
    return true;
  }
  await reply(ctx, [
    `${range.label}未完成待辦：`,
    '',
    ...items.map((item, index) => `${index + 1}. ${item.due || '未排日期'}｜${item.content}（${item.status || '待辦'}）`),
    '',
    '可回覆「完成 1」、「進行中 1」或「取消 1」。'
  ].join('\n'));
  return true;
}

async function handleItemAction(ctx) {
  const parsed = parseItemAction(ctx.text);
  if (!parsed) return false;
  const list = activeState(recentLists, stateKey(ctx));
  const item = list?.items?.[parsed.number - 1];
  if (!item?.id) {
    await reply(ctx, '我找不到這個編號。請先輸入「我的今天」或「我的行事曆」重新列出清單。');
    return true;
  }
  await platform.tasks.setStatus(ctx, item.id, parsed.status);
  item.status = parsed.status;
  await reply(ctx, `已更新：${item.content} → ${parsed.status}`);
  return true;
}

function responseFor(ctx) {
  const name = identityLabel(ctx);
  const tenant = ctx.tenant?.displayName || 'HOZO AM';
  const text = clean(ctx.text);
  if (/^(?:我的)?(?:身分|身份|綁定狀態|我是誰)(?:設定)?[？?]?$/u.test(text)) {
    return [
      `✅ ${name}，你的 LINE 已綁定並用 ${tenant} 身分進入葉小蝸私人助理。`,
      '身分來源：已啟用工作群組的 LINE user ID。',
      '',
      '私人待辦會直接寫入 AM 任務，不再要求 Rental Portal Calendar 綁定。',
      '通知設定與安靜時段尚未開放。'
    ].join('\n');
  }
  return [
    '我目前可以處理私人待辦、今天清單、行事曆清單、昨日未完成和請款入口。',
    '',
    '你可以直接說：',
    '新增待辦 明天 10:00 回覆房東',
    '我的今天',
    '昨日未完成',
  ].join('\n');
}

export default {
  name: 'personal-assistant',
  init(sharedPlatform) {
    platform = sharedPlatform;
  },
  async onDirectMessage(ctx) {
    if (ctx.tenant?.config?.personalAssistant?.enabled !== true) return false;
    if (isDelegatedCommand(ctx.text)) return false;
    if (!ctx.event?.replyToken) return false;
    if (ctx.message?.type && ctx.message.type !== 'text') return false;
    if (await handleCreateConfirmation(ctx)) return true;
    if (await handleCreateGuide(ctx)) return true;
    if (await handleCreate(ctx)) return true;
    if (await handleItemAction(ctx)) return true;
    const kind = queryKind(ctx.text);
    if (kind) return handleQuery(ctx, kind);
    await reply(ctx, responseFor(ctx));
    return true;
  },
  routes: [],
};

// 舊測試仍會引用這些名稱；綁定流程已不再由私人助理消費。
function parseBindingCommand(text) {
  const matched = clean(text).match(/^(?:綁定(?:碼)?\s*[:：]?\s*)?(\d{6})[？?]?$/u);
  return matched ? { code: matched[1] } : null;
}
function isRevokeBindingCommand(text) {
  return /^(?:解除|撤銷)(?:LINE)?(?:身分|綁定)[？?]?$/u.test(clean(text));
}
function bindingFailureMessage() {
  return 'Rental Calendar 綁定已不再作為私人待辦前置流程。';
}
function bindingSuccessMessage() {
  return '私人待辦已改由 AM 任務流程處理。';
}

export {
  bindingFailureMessage,
  bindingSuccessMessage,
  isDelegatedCommand,
  isRevokeBindingCommand,
  parseBindingCommand,
  responseFor,
};

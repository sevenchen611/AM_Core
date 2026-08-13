// LINE task-control: interactive task list, completion, progress capture, and search.
// Every read/write is tenant scoped and every task must belong to the current binding.

let platform = null;
const PENDING_TTL_MS = 15 * 60 * 1000;
const pendingInputs = new Map();
const taskLocks = new Map();
const schemaCache = new Map();
const OPEN = new Set(['待辦', '進行中']);
const COMPLETE = '完成';
const SENSITIVE = /付款|匯款|發票|報價|合約|契約|薪資|人事|勞健保|稅|法律|客訴|賠償|解約/;
const REQUIRED_FIELDS = ['目前進度', '下一步', '阻礙', '關鍵字', '最近更新'];

function init(injected) { platform = injected; }

function key(ctx) {
  return `${ctx.tenant.key}:${ctx.groupId || ''}:${ctx.event?.source?.userId || ''}`;
}

function taskAction(action, taskId) {
  return `am-task-1:${action}:${taskId}`;
}

function richText(value) {
  const text = String(value || '').trim().slice(0, 1900);
  return text ? [{ type: 'text', text: { content: text } }] : [];
}

function plain(property) {
  if (!property) return '';
  if (property.type === 'title') return (property.title || []).map((item) => item.plain_text || item.text?.content || '').join('');
  if (property.type === 'rich_text') return (property.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('');
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'multi_select') return (property.multi_select || []).map((item) => item.name).join('、');
  if (property.type === 'date') return property.date?.start || '';
  return '';
}

function row(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    title: plain(p['內容']) || '未命名任務',
    status: plain(p['狀態']),
    owner: plain(p['負責人']),
    due: plain(p['期限']),
    progress: plain(p['目前進度']),
    nextStep: plain(p['下一步']),
    blocker: plain(p['阻礙']),
    keywords: plain(p['關鍵字']),
  };
}

function dayTaipei(offset = 0) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function weekEndTaipei() {
  const date = new Date(`${dayTaipei()}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}

function stampTaipei() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function truncate(value, limit = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function bindingId(ctx) {
  return String(ctx.binding?.pageId || '');
}

function sameId(left, right) {
  const normalize = (value) => String(value || '').replace(/-/g, '').toLowerCase();
  return Boolean(normalize(left)) && normalize(left) === normalize(right);
}

function taskBelongsToBinding(page, ctx) {
  const id = bindingId(ctx);
  if (!id) return false;
  return (page.properties?.['負責群組']?.relation || []).some((item) => sameId(item.id, id));
}

async function schemaFor(ctx) {
  const cacheKey = ctx.tenant.key;
  const cached = schemaCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.schema;
  const schema = await ctx.notionRequest(`/v1/data_sources/${encodeURIComponent(ctx.tenant.dataSources.tasks)}`, { method: 'GET' });
  schemaCache.set(cacheKey, { schema, expires: Date.now() + 60 * 1000 });
  return schema;
}

async function schemaReady(ctx) {
  const schema = await schemaFor(ctx);
  return REQUIRED_FIELDS.every((name) => schema.properties?.[name]);
}

async function requireSchema(ctx) {
  if (await schemaReady(ctx)) return true;
  await reply(ctx, { type: 'text', text: '任務互動欄位尚未完成安裝，已暫停操作；請由管理者執行本租戶的 schema installer。' });
  return false;
}

async function loadTask(ctx, id) {
  const task = await ctx.notionRequest(`/v1/pages/${encodeURIComponent(id)}`, { method: 'GET' });
  if (!sameId(task.parent?.data_source_id, ctx.tenant.dataSources.tasks) || !taskBelongsToBinding(task, ctx)) {
    const error = new Error('這筆任務不屬於目前群組，無法操作。');
    error.code = 'TASK_SCOPE_DENIED';
    throw error;
  }
  return task;
}

async function listPages(ctx) {
  if (!bindingId(ctx)) return [];
  const pages = [];
  let cursor = '';
  do {
    const body = {
      filter: { property: '負責群組', relation: { contains: bindingId(ctx) } },
      page_size: 100,
      sorts: [{ property: '期限', direction: 'ascending' }],
    };
    if (cursor) body.start_cursor = cursor;
    const result = await ctx.notionRequest(`/v1/data_sources/${encodeURIComponent(ctx.tenant.dataSources.tasks)}/query`, {
      method: 'POST',
      body,
    });
    pages.push(...(result.results || []));
    cursor = result.has_more ? String(result.next_cursor || '') : '';
  } while (cursor && pages.length < 500);
  return pages;
}

async function appendEvent(ctx, task, kind, detail) {
  const actor = String(ctx.senderName || 'LINE 使用者');
  const source = `LINE 群組=${ctx.groupId || '-'}；使用者=${ctx.event?.source?.userId || '-'}；事件=${ctx.event?.webhookEventId || ctx.event?.timestamp || '-'}`;
  const content = [`[任務操作｜${kind}] ${stampTaipei()}`, `操作者：${actor}`, `內容：${detail}`, `來源證據：${source}`].join('\n');
  await ctx.notionRequest(`/v1/blocks/${encodeURIComponent(task.id)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(content) } }] },
  });
}

async function updateTask(ctx, task, properties, kind, detail) {
  const schema = await schemaFor(ctx);
  const safeProperties = {};
  for (const [name, value] of Object.entries(properties)) {
    if (schema.properties?.[name]) safeProperties[name] = value;
  }
  if (Object.keys(safeProperties).length) {
    await ctx.notionRequest(`/v1/pages/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { properties: safeProperties } });
  }
  await appendEvent(ctx, task, kind, detail);
}

async function withTaskLock(taskId, work) {
  const previous = taskLocks.get(taskId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const held = previous.then(() => current);
  taskLocks.set(taskId, held);
  try {
    await previous;
    return await work();
  } finally {
    release();
    if (taskLocks.get(taskId) === held) taskLocks.delete(taskId);
  }
}

function textComponent(value, options = {}) {
  return { type: 'text', text: truncate(value, options.limit || 80), size: options.size || 'sm', color: options.color || '#555555', wrap: true, ...options };
}

function taskBubble(task, { detail = false } = {}) {
  const completed = task.status === COMPLETE;
  const contents = [
    {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: completed ? '☑' : '☐', size: 'xl', color: completed ? '#3d8b5f' : '#9aa4a0', flex: 0 },
        {
          ...textComponent(task.title, { size: 'md', weight: 'bold', color: '#1f3027', flex: 1, limit: 120 }),
          action: { type: 'postback', label: '任務詳情', data: taskAction('detail', task.id) },
        },
      ],
    },
    textComponent(`狀態：${task.status || '待辦'}${task.due ? `　期限：${task.due.slice(0, 10)}` : ''}`, { size: 'xs', color: '#6b776f' }),
  ];
  if (task.progress) contents.push(textComponent(`進度：${task.progress}`, { size: 'xs', limit: 100 }));
  if (task.nextStep) contents.push(textComponent(`下一步：${task.nextStep}`, { size: 'xs', limit: 100 }));
  if (task.keywords) contents.push(textComponent(`關鍵字：${task.keywords}`, { size: 'xs', color: '#59705f', limit: 100 }));
  const footer = completed
    ? [{ type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '查看紀錄', data: taskAction('detail', task.id) } }]
    : [
      { type: 'button', style: 'primary', color: '#3d8b5f', height: 'sm', action: { type: 'postback', label: '☐ 完成', data: taskAction('complete', task.id) } },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '更新進度', data: taskAction('progress', task.id) } },
    ];
  if (detail) {
    footer.length = 0;
    if (!completed) footer.push({ type: 'button', style: 'primary', color: '#3d8b5f', height: 'sm', action: { type: 'postback', label: '☐ 完成任務', data: taskAction('complete', task.id) } });
    footer.push(
      { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '新增進度', data: taskAction('progress', task.id) } },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '記錄阻礙', data: taskAction('blocker', task.id) } },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '修改下一步', data: taskAction('next', task.id) } },
      { type: 'button', style: 'link', height: 'sm', action: { type: 'postback', label: '加關鍵字', data: taskAction('keywords', task.id) } },
    );
  }
  return { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer } };
}

function flexList(title, tasks, empty) {
  if (!tasks.length) return { type: 'text', text: empty || `${title}目前沒有任務。` };
  return {
    type: 'flex',
    altText: `${title}｜${tasks.length} 件`,
    contents: {
      type: 'carousel',
      contents: tasks.slice(0, 10).map((task) => taskBubble(task)),
    },
  };
}

async function reply(ctx, messages) {
  if (!ctx.event?.replyToken) return;
  const items = Array.isArray(messages) ? messages : [messages];
  if (typeof platform.replyLineMessages === 'function') return platform.replyLineMessages(ctx.event.replyToken, items);
  const fallback = items.find((item) => item.type === 'text')?.text || '任務已更新。';
  return platform.replyLineMessage(ctx.event.replyToken, fallback);
}

function parseCommand(value) {
  const text = String(value || '').trim();
  if (/^(今天|今日)(的)?待辦$/.test(text)) return { type: 'list', range: 'today' };
  if (/^(本週|這週|本周|這周)(的)?待辦$/.test(text)) return { type: 'list', range: 'week' };
  if (/^(已完成|完成)(的)?待辦$/.test(text)) return { type: 'list', range: 'completed' };
  const search = text.match(/^(?:搜尋|查找|找)(?:待辦|任務)?[：:\s]+(.+)$/);
  return search ? { type: 'search', query: search[1].trim() } : null;
}

function inRange(task, range) {
  const due = task.due.slice(0, 10);
  if (range === 'completed') return task.status === COMPLETE;
  if (!OPEN.has(task.status)) return false;
  if (range === 'today') return !due || due <= dayTaipei();
  return !due || due <= weekEndTaipei();
}

function matches(task, query) {
  const terms = String(query || '').toLocaleLowerCase('zh-Hant').split(/\s+/).filter(Boolean);
  const haystack = [task.title, task.status, task.owner, task.progress, task.nextStep, task.blocker, task.keywords].join('\n').toLocaleLowerCase('zh-Hant');
  return terms.every((term) => haystack.includes(term));
}

async function replyList(ctx, range) {
  const tasks = (await listPages(ctx)).map(row).filter((item) => inRange(item, range));
  const labels = { today: '今日待辦', week: '本週待辦', completed: '已完成待辦' };
  await reply(ctx, flexList(labels[range], tasks, `${labels[range]}目前沒有項目。`));
}

async function replySearch(ctx, query) {
  const tasks = (await listPages(ctx)).map(row).filter((item) => matches(item, query));
  await reply(ctx, flexList(`搜尋：${truncate(query, 40)}`, tasks, `找不到「${truncate(query, 50)}」相關任務。`));
}

function inputPrompt(mode, task) {
  const labels = { progress: '最新進度', blocker: '目前阻礙', next: '下一步', keywords: '關鍵字' };
  const examples = {
    progress: '例如：已收到廠商初稿，預計明天下午確認。',
    blocker: '例如：等待營運提供預算區間。',
    next: '例如：8/14 前與現場確認施工時間。',
    keywords: '請用逗號分隔，例如：招募、開幕、人力配置。',
  };
  return `請直接輸入「${task.title}」的${labels[mode]}。\n${examples[mode]}`;
}

function setPending(ctx, task, mode) {
  pendingInputs.set(key(ctx), { taskId: task.id, taskTitle: row(task).title, mode, expires: Date.now() + PENDING_TTL_MS });
}

async function captureInput(ctx, pending) {
  if (pending.expires <= Date.now()) {
    pendingInputs.delete(key(ctx));
    await reply(ctx, { type: 'text', text: '剛才的任務更新已逾時，請重新點選任務操作。' });
    return true;
  }
  const value = String(ctx.text || '').trim();
  if (!value) return true;
  const task = await loadTask(ctx, pending.taskId);
  const taskInfo = row(task);
  const properties = { '最近更新': { date: { start: new Date().toISOString() } } };
  let kind;
  let detail;
  if (pending.mode === 'keywords') {
    const keywords = [...new Set([
      ...taskInfo.keywords.split('、'),
      ...value.split(/[，,、\n]/),
    ].map((item) => item.trim()).filter(Boolean))].slice(0, 20);
    properties['關鍵字'] = { multi_select: keywords.map((name) => ({ name })) };
    kind = '更新關鍵字';
    detail = `關鍵字：${keywords.join('、')}`;
  } else {
    const property = { progress: '目前進度', blocker: '阻礙', next: '下一步' }[pending.mode];
    properties[property] = { rich_text: richText(value) };
    kind = { progress: '新增進度', blocker: '記錄阻礙', next: '修改下一步' }[pending.mode];
    detail = `${kind}：${value}`;
  }
  await updateTask(ctx, task, properties, kind, detail);
  pendingInputs.delete(key(ctx));
  const fresh = row(await loadTask(ctx, task.id));
  await reply(ctx, [{ type: 'text', text: `已記錄「${taskInfo.title}」的${kind}。` }, { type: 'flex', altText: `任務詳情：${fresh.title}`, contents: taskBubble(fresh, { detail: true }) }]);
  return true;
}

async function completeTask(ctx, id) {
  return withTaskLock(id, async () => {
    const task = await loadTask(ctx, id);
    const info = row(task);
    if (info.status === COMPLETE) {
      await reply(ctx, { type: 'text', text: `「${info.title}」已經是完成狀態。` });
      return;
    }
    await updateTask(ctx, task, {
      '狀態': { select: { name: COMPLETE } },
      '最近更新': { date: { start: new Date().toISOString() } },
    }, 'LINE checkbox 完成', '使用者點選任務 checkbox，狀態由「' + (info.status || '待辦') + '」更新為「完成」。');
    const fresh = row(await loadTask(ctx, id));
    await reply(ctx, [{ type: 'text', text: `已完成：${fresh.title}` }, { type: 'flex', altText: `已完成：${fresh.title}`, contents: taskBubble(fresh, { detail: true }) }]);
  });
}

async function onMessage(ctx) {
  if (!ctx.text || !bindingId(ctx)) return false;
  const pending = pendingInputs.get(key(ctx));
  if (pending) {
    if (!await requireSchema(ctx)) return true;
    return captureInput(ctx, pending);
  }
  const command = parseCommand(ctx.text);
  if (!command) return false;
  if (!await requireSchema(ctx)) return true;
  if (command.type === 'search') await replySearch(ctx, command.query);
  else await replyList(ctx, command.range);
  return true;
}

async function onPostback(ctx) {
  const data = String(ctx.postback?.data || '');
  const match = data.match(/^am-task-1:(detail|complete|confirm-complete|progress|blocker|next|keywords):([0-9a-f-]{8,})$/i);
  if (!match || !bindingId(ctx)) return false;
  if (!await requireSchema(ctx)) return true;
  const [, action, taskId] = match;
  let task;
  try {
    task = await loadTask(ctx, taskId);
  } catch (error) {
    if (error.code === 'TASK_SCOPE_DENIED') {
      await reply(ctx, { type: 'text', text: error.message });
      return true;
    }
    throw error;
  }
  const info = row(task);
  if (action === 'detail') {
    await reply(ctx, { type: 'flex', altText: `任務詳情：${info.title}`, contents: taskBubble(info, { detail: true }) });
    return true;
  }
  if (action === 'complete') {
    if (SENSITIVE.test([info.title, info.progress, info.nextStep, info.keywords].join('\n'))) {
      await reply(ctx, {
        type: 'flex', altText: `確認完成：${info.title}`,
        contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [textComponent('此任務可能涉及敏感或外部承諾，請確認完成。', { weight: 'bold', color: '#8d5c22' }), textComponent(info.title)] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#a56a28', action: { type: 'postback', label: '確認完成', data: taskAction('confirm-complete', taskId) } }, { type: 'button', style: 'link', action: { type: 'postback', label: '返回任務', data: taskAction('detail', taskId) } }] } },
      });
      return true;
    }
    await completeTask(ctx, taskId);
    return true;
  }
  if (action === 'confirm-complete') {
    await completeTask(ctx, taskId);
    return true;
  }
  setPending(ctx, task, action);
  await reply(ctx, { type: 'text', text: inputPrompt(action, info) });
  return true;
}

export default { name: 'task-control', init, onMessage, onPostback };

export const __test = { parseCommand, inRange, matches, taskAction, taskBelongsToBinding, row, sameId, weekEndTaipei, REQUIRED_FIELDS };

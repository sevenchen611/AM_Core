// AM Platform 模組:tasks(待辦任務 — 建立 / 展開 / 狀態 的共用讀寫)
// ─────────────────────────────────────────────────────────────────────────
// 「待辦任務」資料庫的共用 CRUD:讓 meetings、construction(回饋單/單據)、reminders
//   共用同一套「建立/展開/改狀態/查未完成」,而非各寫各的(原本散在 meetings.publishMeeting
//   與 BuildAM src/server.js 的 openTasks/markTaskReminded)。
//
// 對外服務(meetings、construction 單據呼叫):
//   platform.tasks.createTask(ctx, task)  — 建一筆待辦,回 pageId
//   platform.tasks.expandTasks(ctx, todos, common) — 一次展開多筆(會議/回饋單用)
//   platform.tasks.setStatus(ctx, taskOrId, status) — 狀態機(待辦/進行中/完成/取消)
//   init(platform) 時把上述服務掛到 platform.tasks,供其它模組(不改 core)直接呼叫。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(notionRequest / pushLineMessage / logger…),所有租戶共用一份。
//   - 每次呼叫由 ctx.tenant 帶租戶特定的 Notion 資料源(ctx.tenant.dataSources.tasks 等)。
//   - 寫 Notion 一律經 platform.notionRequest;目標庫 id 只取自 ctx.tenant,結構上碰不到別租戶。
//   - 模組內任何狀態一律以「(租戶, 群組)」為鍵(見 pkey()),不同租戶不互相污染。
//
// 領域欄位邊界:通用欄位(內容/負責人/期限/來源/狀態)恆存;領域關聯(專案/會議記錄/回饋單/負責群組)
//   由呼叫端以選填 id 帶入 —— 有給才寫,沒給就不送,故同一份模組可服務不同租戶的 tasks schema。

let platform = null;

function init(injected) {
  platform = injected;
  // 把服務掛到共用 platform 物件:其它模組於自己 init 捕捉的同一個 platform 即可
  //   呼叫 platform.tasks.createTask(...)。載入期全部 init 完才會有訊息進來,故執行期必在。
  platform.tasks = { createTask, expandTasks, setStatus, listOpen, markReminded, reminderRecord, lastTask };
}

// ── 純工具 ────────────────────────────────────────────────
const text = (c) => ({ type: 'text', text: { content: String(c).slice(0, 1900) } });

const STATUSES = ['待辦', '進行中', '完成', '取消'];
const SOURCES = ['會議', '回饋單', '手動'];
const normStatus = (s) => (STATUSES.includes(s) ? s : '待辦');
const normSource = (s) => (SOURCES.includes(s) ? s : '手動');

// 期限可帶時刻(= 行程)。回傳 Notion date 值,或 null(無期限)。
//   純日期  YYYY-MM-DD               → { start: '2026-07-10' }        (整日待辦)
//   含時刻  YYYY-MM-DD HH:MM 或 …THH:MM → { start: '2026-07-10T14:30:00+08:00' }(行程,台灣時區)
function toNotionDate(due) {
  const s = String(due || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { start: s };
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return { start: `${m[1]}T${m[2]}:${m[3] || '00'}+08:00` };
  const d = s.match(/\d{4}-\d{2}-\d{2}/); // 從自由文字裡搶救出日期
  return d ? { start: d[0] } : null;
}

// 取「租戶鎖定」的 notionRequest:優先用 dispatcher 給的 ctx.notionRequest(已鎖 tenantKey);
//   服務由別模組直呼(只帶 ctx.tenant)時,補上 tenantKey 走嚴格綁定,確保碰不到別租戶。
function reqFor(ctx) {
  if (typeof ctx.notionRequest === 'function') return ctx.notionRequest;
  const key = ctx.tenant?.key;
  return (pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: key });
}

// ── (租戶, 群組) 鍵的模組狀態 ───────────────────────────────
// tasks 本身是無狀態 CRUD;唯一需要記憶的是「這個群最近建了哪一筆」,供未來對話式改狀態
//   (「把剛剛那筆標完成」)取一個錨點。鍵一律 (租戶,群組),不跨租戶污染。
const lastCreated = new Map();
const pkey = (tenant, groupId) => `${(tenant && tenant.key) || 'default'}::${groupId || ''}`;
function rememberLast(tenant, groupId, id, content) {
  if (!groupId) return;
  lastCreated.set(pkey(tenant, groupId), { id, content: String(content || ''), at: Date.now() });
}
function lastTask(tenant, groupId) {
  return lastCreated.get(pkey(tenant, groupId)) || null;
}

// ── 建立一筆待辦 ───────────────────────────────────────────
// ctx : { tenant, notionRequest?, groupId? }        ← 租戶脈絡(tenant.dataSources.tasks 為目標庫)
// task: { content, owner?, due?, source?, status?,  ← 通用欄位
//         projectPageId?, meetingId?, feedbackId?, groupBindingId? }  ← 領域關聯(有才寫)
// 回傳建立的 pageId。
async function createTask(ctx, task = {}) {
  const tenant = ctx.tenant;
  const tasksDs = tenant?.dataSources?.tasks;
  if (!tasksDs) throw new Error(`tenant "${tenant?.key || '?'}" 未設定 tasks 資料源`);

  const properties = {
    '內容': { title: [text(task.content || '')] },
    '來源': { select: { name: normSource(task.source) } },
    '狀態': { select: { name: normStatus(task.status) } },
  };
  if (task.owner) properties['負責人'] = { rich_text: [text(task.owner)] };
  const due = toNotionDate(task.due);
  if (due) properties['期限'] = { date: due };
  if (task.projectPageId) properties['專案'] = { relation: [{ id: task.projectPageId }] };
  if (task.meetingId) properties['會議記錄'] = { relation: [{ id: task.meetingId }] };
  if (task.feedbackId) properties['回饋單'] = { relation: [{ id: task.feedbackId }] };
  if (task.groupBindingId) properties['負責群組'] = { relation: [{ id: task.groupBindingId }] };

  const page = await reqFor(ctx)('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: tasksDs }, properties },
  });
  rememberLast(tenant, ctx.groupId, page.id, task.content);
  return page.id;
}

// ── 展開多筆(會議摘要待辦、回饋單一次開多項)────────────────
// todos : [{ content, owner?, due? }, ...]
// common: { source, status?, projectPageId?, meetingId?, feedbackId?, groupBindingId?, limit? }
// 逐筆建立;單筆失敗只記警告不中斷(比照原 meetings 的 .catch),回傳成功建立的 pageId 陣列。
async function expandTasks(ctx, todos = [], common = {}) {
  const ids = [];
  for (const t of (todos || []).slice(0, common.limit || 30)) {
    try {
      ids.push(await createTask(ctx, {
        content: t.content,
        owner: t.owner,
        due: t.due,
        source: common.source,
        status: common.status,
        projectPageId: common.projectPageId,
        meetingId: common.meetingId,
        feedbackId: common.feedbackId,
        groupBindingId: common.groupBindingId,
      }));
    } catch (e) {
      (platform?.logger || console).warn(`todo create failed: ${e.message}`);
    }
  }
  return ids;
}

// ── 狀態機:待辦 → 進行中 → 完成 / 取消 ─────────────────────
// taskOrId:pageId 字串,或帶 .id 的 task 頁物件。回傳實際寫入的狀態名。
async function setStatus(ctx, taskOrId, status) {
  const id = typeof taskOrId === 'string' ? taskOrId : taskOrId?.id;
  if (!id) throw new Error('setStatus 需要 task id');
  const name = normStatus(status);
  await reqFor(ctx)(`/v1/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { properties: { '狀態': { select: { name } } } },
  });
  return name;
}

// ── 查未完成待辦(狀態=待辦/進行中,且有期限)──────────────
// reminders 巡邏用;等同 BuildAM src/server.js openTasks()。
async function listOpen(ctx) {
  const tasksDs = ctx.tenant?.dataSources?.tasks;
  if (!tasksDs) return [];
  const result = await reqFor(ctx)(`/v1/data_sources/${encodeURIComponent(tasksDs)}/query`, {
    method: 'POST',
    body: {
      filter: {
        and: [
          { or: [
            { property: '狀態', select: { equals: '待辦' } },
            { property: '狀態', select: { equals: '進行中' } },
          ] },
          { property: '期限', date: { is_not_empty: true } },
        ],
      },
      page_size: 100,
    },
  });
  return result.results || [];
}

// ── 提醒記錄(JSON 存在「提醒記錄」rich_text)────────────────
// reminders 記「哪些提醒已發過」;等同 BuildAM markTaskReminded / taskReminderRecord。
function reminderRecord(task) {
  try {
    return JSON.parse((task.properties?.['提醒記錄']?.rich_text || []).map((t) => t.plain_text).join('')) || {};
  } catch {
    return {};
  }
}
async function markReminded(ctx, task, key, value) {
  const record = reminderRecord(task);
  record[key] = value;
  await reqFor(ctx)(`/v1/pages/${encodeURIComponent(task.id)}`, {
    method: 'PATCH',
    body: { properties: { '提醒記錄': { rich_text: [text(JSON.stringify(record).slice(0, 1900))] } } },
  });
  return record;
}

// ── 待辦頁(web route,選用)────────────────────────────────
// 唯讀清單:portal 登入後看某租戶的未完成待辦。?tenant=<key> 指定租戶(否則預設本 route 擁有租戶)。
const plain = (prop, kind) => (prop?.[kind] || []).map((t) => t.plain_text).join('');
function taskRow(task) {
  const p = task.properties || {};
  const due = p['期限']?.date?.start || '';
  return {
    content: plain(p['內容'], 'title'),
    owner: plain(p['負責人'], 'rich_text'),
    due: due.includes('T') ? `${due.slice(0, 10)} ${due.slice(11, 16)}` : due.slice(0, 10),
    status: p['狀態']?.select?.name || '',
    source: p['來源']?.select?.name || '',
  };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function tasksPage(req, res, rctx) {
  const { tenant, portal } = rctx;
  const pin = Boolean(portal?.pinAuthed?.(req, tenant));
  const user = pin ? null : await portal?.userAuthed?.(req);
  const authed = pin || Boolean(user && (typeof portal?.tenantAuthorized === 'function'
    ? portal.tenantAuthorized(user, tenant)
    : true));
  if (!authed) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('需要登入(Portal PIN 或 hozo_session)。');
  }
  if (!tenant?.dataSources?.tasks) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('此租戶未設定 tasks 資料源。');
  }
  const rows = (await listOpen({ tenant })).map(taskRow);
  const body = [
    `<!doctype html><meta charset="utf-8"><title>待辦｜${esc(tenant.displayName)}</title>`,
    '<style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse;width:100%}',
    'th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}th{background:#f5f5f5}</style>',
    `<h2>待辦任務 · ${esc(tenant.displayName)}(未完成 ${rows.length} 筆)</h2>`,
    '<table><tr><th>內容</th><th>負責人</th><th>期限</th><th>狀態</th><th>來源</th></tr>',
    ...rows.map((r) => `<tr><td>${esc(r.content)}</td><td>${esc(r.owner)}</td><td>${esc(r.due)}</td><td>${esc(r.status)}</td><td>${esc(r.source)}</td></tr>`),
    '</table>',
  ].join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

const routes = [
  { prefix: '/tasks', method: 'GET', handler: tasksPage },
];

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'tasks',
  init,
  createTask,      // (ctx, task) → pageId          建立一筆待辦
  expandTasks,     // (ctx, todos[], common) → ids   一次展開多筆(會議/回饋單)
  setStatus,       // (ctx, taskOrId, status) → name 狀態機(待辦/進行中/完成/取消)
  listOpen,        // (ctx) → task[]                 未完成且有期限(reminders 用)
  markReminded,    // (ctx, task, key, value)        記已發提醒
  reminderRecord,  // (task) → obj                   讀提醒記錄
  lastTask,        // (tenant, groupId) → { id, content, at } | null
  routes,          // 待辦頁(唯讀,portal 守衛)
};

// 測試用內部匯出(不影響正式流程)
export const __test = { toNotionDate, normStatus, normSource, taskRow };

// 進度儀表板(SPEC F4)+ 照片瀏覽(SPEC F3)——抽自 BuildAM src/dashboard.js,改為多租戶。
// /dashboard — 專案卡片 → 專案頁(未銷項清單/空間×工種矩陣/空間照片時間軸/甘特/SOP/會議/待辦/行事曆)。
// 授權/scope 由 index.js 的 webRoute(走 core.portal)重算並注入 URL(不信任前端原始參數);
// deps 由 index.js 依 ctx.tenant + platform 每次組出(notionRequest 已鎖定 tenantKey;dataSources 為該租戶自己的庫)。
// 另需 deps.getLineQuota(推播配額)與 deps.calendars(專案代碼 → Google 行事曆 id),由 index.fullDeps 補上。
// SOP 階段定義由 sop.js 單一來源提供(construction 內共用)。

import { plain, sameId, queryAll, pageName, sendJson, readJsonBody, parseScope, assertProjectInScope } from './common.js';
import { SOP_STAGES } from './sop.js';

// 沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps);budget/contract/scope 由 webRoute 注入 URL。
export async function handleDashboardRequest(req, res, pathname, url, deps) {
  const canBudget = url.searchParams.get('budget') === '1';
  const canContract = url.searchParams.get('contract') === '1';
  const scope = parseScope(url);
  const tenantKey = deps.tenantKey;
  try {
    if (req.method === 'GET' && pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderDashboardPage(tenantKey, canBudget, canContract));
    }
    if (req.method === 'GET' && pathname === '/dashboard/api/summary') {
      const summary = await buildSummary(deps);
      if (scope) summary.cards = summary.cards.filter((c) => scope.has(c.code));
      return sendJson(res, 200, summary);
    }
    if (req.method === 'GET' && pathname === '/dashboard/api/project') {
      const projectId = url.searchParams.get('project');
      await assertProjectInScope(deps, scope, projectId);
      return sendJson(res, 200, await buildProjectDetail(deps, projectId));
    }
    if (req.method === 'GET' && pathname === '/dashboard/api/photos') {
      return sendJson(res, 200, await buildSpacePhotos(deps, url.searchParams.get('space')));
    }
    if (req.method === 'GET' && pathname === '/dashboard/api/doc') {
      return sendJson(res, 200, await buildDoc(deps, url.searchParams.get('page'), canBudget));
    }
    if (req.method === 'GET' && pathname === '/dashboard/api/gantt') {
      const projectId = url.searchParams.get('project');
      await assertProjectInScope(deps, scope, projectId);
      return sendJson(res, 200, await buildGantt(deps, projectId));
    }
    if (req.method === 'POST' && pathname === '/dashboard/api/doc-edit') {
      return sendJson(res, 200, await editDocField(deps, await readJsonBody(req), canBudget));
    }
    if (req.method === 'POST' && pathname === '/dashboard/api/todo-toggle') {
      const { block, checked } = await readJsonBody(req);
      await deps.notionRequest(`/v1/blocks/${encodeURIComponent(block)}`, { method: 'PATCH', body: { to_do: { checked: Boolean(checked) } } });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/dashboard/api/sop-check') {
      const { project, itemId, checked } = await readJsonBody(req);
      if (!project || !itemId) throw new Error('project/itemId required');
      const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(project)}`, { method: 'GET' });
      let state = {};
      try { state = JSON.parse(plain(page.properties['SOP檢核']?.rich_text)) || {}; } catch {}
      state[itemId] = Boolean(checked);
      await deps.notionRequest(`/v1/pages/${encodeURIComponent(project)}`, {
        method: 'PATCH',
        body: { properties: { 'SOP檢核': { rich_text: [{ type: 'text', text: { content: JSON.stringify(state).slice(0, 1900) } }] } } },
      });
      return sendJson(res, 200, { ok: true, state });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Dashboard error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

async function buildSummary(deps) {
  let quota = null;
  try { quota = deps.getLineQuota ? await deps.getLineQuota() : null; } catch {}
  const projects = await queryAll(deps, deps.dataSources.projects);
  const cards = [];
  for (const page of projects) {
    const p = page.properties;
    const projectId = page.id;
    const tickets = await queryAll(deps, deps.dataSources.feedbackTickets, { property: '專案', relation: { contains: projectId } });
    const openTickets = tickets.filter((t) => ['開立', '回覆中', '擱置(待時機)'].includes(t.properties['狀態']?.select?.name));
    const cos = await queryAll(deps, deps.dataSources.changeOrders, { and: [
      { property: '專案', relation: { contains: projectId } },
      { property: '核准狀態', select: { equals: '待核准' } },
    ] });
    cards.push({
      id: projectId,
      name: plain(p['專案名稱']?.title),
      code: plain(p['館別代碼']?.rich_text),
      status: p['狀態']?.select?.name || '',
      startDate: (p['目標動工日']?.date?.start || '').slice(0, 10),
      openCount: openTickets.length,
      aOpenCount: openTickets.filter((t) => (t.properties['影響等級']?.select?.name || '').startsWith('A')).length,
      overdueCount: openTickets.filter((t) => Boolean(t.properties['逾期']?.checkbox)).length,
      parkedCount: openTickets.filter((t) => t.properties['狀態']?.select?.name === '擱置(待時機)').length,
      pendingCoCount: cos.length,
    });
  }
  return { cards, quota };
}

async function buildProjectDetail(deps, projectId) {
  if (!projectId) throw new Error('project required');
  // 未銷項清單
  const tickets = (await queryAll(deps, deps.dataSources.feedbackTickets, { property: '專案', relation: { contains: projectId } }))
    .filter((t) => ['開立', '回覆中', '擱置(待時機)'].includes(t.properties['狀態']?.select?.name));
  const openTickets = [];
  for (const t of tickets) {
    const p = t.properties;
    openTickets.push({
      id: t.id,
      number: plain(p['編號']?.title),
      status: p['狀態']?.select?.name || '',
      level: p['影響等級']?.select?.name || '',
      description: plain(p['問題描述']?.rich_text).slice(0, 60),
      deadline: (p['回覆期限']?.date?.start || '').slice(0, 10),
      overdue: Boolean(p['逾期']?.checkbox),
      notionUrl: t.url,
    });
  }
  openTickets.sort((a, b) => (b.overdue - a.overdue) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));

  // 空間×工種狀態矩陣(只列有工項的空間)
  const workItems = await queryAll(deps, deps.dataSources.workItems, { property: '專案', relation: { contains: projectId } });
  const matrix = [];
  for (const w of workItems) {
    const p = w.properties;
    const spaceId = p['空間']?.relation?.[0]?.id;
    matrix.push({
      space: spaceId ? await pageName(deps, spaceId) : '(未分空間)',
      trade: p['工種']?.select?.name || '其他',
      status: p['狀態']?.select?.name || '未開始',
      name: plain(p['工項']?.title),
    });
  }

  // 空間清單(照片瀏覽入口:列出有照片的空間)
  const attachments = await queryAll(deps, deps.dataSources.attachments, { property: '專案', relation: { contains: projectId } });
  const spaceCounts = new Map();
  for (const a of attachments) {
    const spaceId = a.properties['空間']?.relation?.[0]?.id;
    const label = spaceId ? await pageName(deps, spaceId) : '(未歸空間)';
    const keyId = spaceId || 'none';
    if (!spaceCounts.has(keyId)) spaceCounts.set(keyId, { id: spaceId, name: label, count: 0 });
    spaceCounts.get(keyId).count++;
  }
  // SOP 階段檢核狀態
  const projectPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  let sopState = {};
  try { sopState = JSON.parse(plain(projectPage.properties['SOP檢核']?.rich_text)) || {}; } catch {}

  // 待辦任務(未完成,依期限排序)
  const tasksRaw = await queryAll(deps, deps.dataSources.tasks, { and: [
    { property: '專案', relation: { contains: projectId } },
    { or: [
      { property: '狀態', select: { equals: '待辦' } },
      { property: '狀態', select: { equals: '進行中' } },
    ] },
  ] });
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const tasks = tasksRaw.map((t) => {
    const p = t.properties;
    const due = (p['期限']?.date?.start || '').slice(0, 10);
    return {
      id: t.id,
      content: plain(p['內容']?.title),
      owner: plain(p['負責人']?.rich_text),
      due,
      overdue: Boolean(due && due < today),
      status: p['狀態']?.select?.name || '',
      source: p['來源']?.select?.name || '',
    };
  }).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));

  // 會議記錄(最新在前)
  const meetingsRaw = await queryAll(deps, deps.dataSources.meetings, { property: '專案', relation: { contains: projectId } });
  const meetings = meetingsRaw.map((m) => ({
    id: m.id,
    title: plain(m.properties['會議']?.title),
    type: m.properties['類型']?.select?.name || '',
    date: (m.properties['日期']?.date?.start || '').slice(0, 10),
    notionUrl: m.url,
  })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const projectCode = plain(projectPage.properties['館別代碼']?.rich_text);
  const calendarId = (deps.calendars || {})[projectCode] || '';
  return { openTickets, matrix, meetings, tasks, calendarId, photoSpaces: [...spaceCounts.values()].sort((a, b) => b.count - a.count), sopStages: SOP_STAGES, sopState };
}

async function buildSpacePhotos(deps, spaceId) {
  if (!spaceId) throw new Error('space required');
  const attachments = await queryAll(deps, deps.dataSources.attachments, { property: '空間', relation: { contains: spaceId } });
  const photos = [];
  for (const a of attachments) {
    const p = a.properties;
    const driveUrl = p['Drive 連結']?.url || '';
    const fileId = ((driveUrl.match(/\/file\/d\/([^/]+)/) || [])[1]) || '';
    if (!fileId) continue;
    const workItemId = p['工項']?.relation?.[0]?.id;
    photos.push({
      fileId,
      url: driveUrl,
      date: (p['日期']?.date?.start || '').slice(0, 10),
      workItem: workItemId ? await pageName(deps, workItemId) : '',
      name: plain(p['檔案名稱']?.rich_text),
    });
  }
  photos.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { photos };
}

// 預算頁面已獨立為 /budget(budget.js);這裡只留「預算頁面的 Notion 列不給沒授權的人開」的防護
function assertBudgetPageAllowed(deps, page, canBudget) {
  if (!canBudget && sameId(page.parent?.data_source_id, deps.dataSources.budgets)) {
    throw new Error('無預算檢視權限');
  }
}

// 單據/會議記錄的網頁詳情(取代進 Notion)
async function buildDoc(deps, pageId, canBudget) {
  if (!pageId) throw new Error('page required');
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  assertBudgetPageAllowed(deps, page, canBudget);
  let title = '';
  const fields = [];
  // 取欄位 schema(select 選項清單),供彈窗就地編輯
  let schema = {};
  try {
    const dsId = page.parent?.data_source_id;
    if (dsId) schema = (await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(dsId)}`, { method: 'GET' })).properties || {};
  } catch {}
  for (const [name, v] of Object.entries(page.properties || {})) {
    if (v.type === 'title') { title = plain(v.title); continue; }
    let value = '';
    if (v.type === 'rich_text') value = plain(v.rich_text);
    else if (v.type === 'select') value = v.select?.name || '';
    else if (v.type === 'date') value = (v.date?.start || '').slice(0, 10);
    else if (v.type === 'number') value = v.number != null ? String(v.number) : '';
    else if (v.type === 'checkbox') value = v.checkbox ? '✓' : '';
    else if (v.type === 'url') value = v.url || '';
    const editable = ['rich_text', 'select', 'date', 'number'].includes(v.type);
    if (value || editable) {
      fields.push({
        name, value: String(value).slice(0, 300), type: v.type, editable,
        options: v.type === 'select' ? (schema[name]?.select?.options || []).map((o) => o.name) : undefined,
      });
    }
  }
  // 取頂層區塊;可展開區段(toggle heading,如摘要/筆記/逐字稿)的內容是巢狀的,往下多抓一層攤平顯示
  const topRes = await deps.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100`, { method: 'GET' });
  const flat = [];
  for (const b of topRes.results || []) {
    flat.push(b);
    if (b.has_children && /heading_\d/.test(b.type)) {
      try {
        const kids = await deps.notionRequest(`/v1/blocks/${encodeURIComponent(b.id)}/children?page_size=100`, { method: 'GET' });
        flat.push(...(kids.results || []));
      } catch {}
    }
  }
  const blocks = flat.map((b) => {
    if (b.type === 'child_page') return { id: b.id, type: 'child_page', title: b.child_page?.title || '(子頁)', spans: [] };
    const t = b[b.type];
    if (!t?.rich_text) return null;
    return {
      id: b.id,
      type: b.type,
      checked: Boolean(t.checked),
      spans: t.rich_text.map((r) => ({ text: r.plain_text || '', color: r.annotations?.color || 'default', link: r.href || null })),
    };
  }).filter(Boolean);
  return { title, fields, blocks, notionUrl: page.url };
}

// 彈窗就地編輯:寫回欄位並留編輯記錄
async function editDocField(deps, { page, prop, type, value, operator }, canBudget) {
  if (!page || !prop || !type) throw new Error('page/prop/type required');
  const target = await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, { method: 'GET' });
  assertBudgetPageAllowed(deps, target, canBudget);
  const v = String(value ?? '').trim();
  let patch;
  if (type === 'rich_text') patch = { rich_text: v ? [{ type: 'text', text: { content: v.slice(0, 1900) } }] : [] };
  else if (type === 'select') patch = { select: v ? { name: v } : null };
  else if (type === 'date') patch = { date: v ? { start: v } : null };
  else if (type === 'number') patch = { number: v === '' ? null : Number(v) };
  else throw new Error(`type ${type} not editable`);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, { method: 'PATCH', body: { properties: { [prop]: patch } } });
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(page)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `[編輯] ${stamp} ${operator || '網頁'}:${prop} → ${v || '(清空)'}` } }] } }] },
  }).catch(() => {});
  return { ok: true };
}

// 網頁版甘特圖資料
async function buildGantt(deps, projectId) {
  if (!projectId) throw new Error('project required');
  const items = await queryAll(deps, deps.dataSources.workItems, { property: '專案', relation: { contains: projectId } });
  const rows = [];
  for (const w of items) {
    const p = w.properties;
    const start = (p['預計開始']?.date?.start || '').slice(0, 10);
    const end = (p['預計完成']?.date?.start || '').slice(0, 10);
    if (!start || !end) continue;
    rows.push({
      name: plain(p['工項']?.title),
      trade: p['工種']?.select?.name || '',
      status: p['狀態']?.select?.name || '未開始',
      start, end,
      actualStart: (p['實際開始']?.date?.start || '').slice(0, 10),
      actualEnd: (p['實際完成']?.date?.start || '').slice(0, 10),
      fee: p['預估費用']?.number || 0,
    });
  }
  rows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { rows };
}

function renderDashboardPage(tenantKey, canBudget, canContract) {
  const t = encodeURIComponent(tenantKey);
  const headerLinks = [
    ...(canBudget ? [`<a href="/budget?tenant=${t}">→ 💰 預算控制</a>`] : []),
    ...(canContract ? [`<a href="/contracts?tenant=${t}">→ 📑 合約發包</a>`] : []),
    `<a href="/tickets?tenant=${t}">→ 回饋單／變更單</a>`,
    `<a href="/queue?tenant=${t}">→ 確認佇列</a>`,
  ].map((a, i) => (i === 0 ? a : a.replace('<a ', '<a style="margin-left:14px" '))).join('');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>葉小蝸工程儀表板</title>
<style>
  :root { --green:#2e7d52; --bg:#f5f7f6; --card:#fff; --line:#e0e6e3; --dim:#6b7a72; --red:#a03e33; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif; background:var(--bg); color:#22302a; padding-bottom:50px; }
  header { background:var(--green); color:#fff; padding:12px 16px; display:flex; align-items:center; gap:10px; position:sticky; top:0; z-index:5; }
  header h1 { font-size:17px; }
  header a { margin-left:auto; color:#dff0e7; font-size:13px; text-decoration:none; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; padding:12px; }
  .pcard { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; flex:1 1 280px; cursor:pointer; }
  .pcard.active { border-color:var(--green); box-shadow:0 0 0 2px #2e7d5233; }
  .pcard h2 { font-size:16px; display:flex; gap:8px; align-items:center; }
  .pcard .chip { border-radius:20px; padding:2px 9px; font-size:12px; background:#eef2f0; }
  .stats { display:flex; gap:14px; margin-top:10px; flex-wrap:wrap; }
  .stat { text-align:center; min-width:56px; }
  .stat b { font-size:22px; display:block; }
  .stat span { font-size:11px; color:var(--dim); }
  .stat.red b { color:var(--red); }
  .section { margin:6px 12px 14px; }
  .section h3 { font-size:14px; color:var(--dim); margin:14px 2px 8px; }
  .tcard { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px; font-size:13px; }
  .tcard b { color:var(--green); }
  .tcard .red { color:var(--red); font-weight:700; }
  table { border-collapse:collapse; background:var(--card); font-size:12px; width:100%; }
  .matrix-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  th,td { border:1px solid var(--line); padding:6px 8px; text-align:center; white-space:nowrap; }
  th { background:#eef2f0; position:sticky; left:auto; }
  td.s-未開始 { color:#98a5a0; }
  td.s-進行中 { background:#fdf3dc; color:#8a6d1a; font-weight:600; }
  td.s-待複驗 { background:#e8eefc; color:#3a5db0; font-weight:600; }
  td.s-完成 { background:#e3efe8; color:#1d6b41; font-weight:600; }
  .spaces { display:flex; flex-wrap:wrap; gap:8px; }
  .spacebtn { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:7px 14px; font-size:13px; }
  .spacebtn.active { background:var(--green); color:#fff; border-color:var(--green); }
  .photos { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .photos figure { width:110px; }
  .photos img { width:110px; height:110px; object-fit:cover; border-radius:10px; border:1px solid var(--line); background:#eee; }
  .photos figcaption { font-size:11px; color:var(--dim); margin-top:2px; line-height:1.3; }
  .empty { color:var(--dim); padding:24px; text-align:center; font-size:13px; }
  #modalBg { display:none; position:fixed; inset:0; background:rgba(20,30,25,.5); z-index:20; }
  #modal { display:none; position:fixed; z-index:21; left:50%; top:50%; transform:translate(-50%,-50%); width:min(560px,94vw); max-height:86vh; overflow-y:auto; background:#fff; border-radius:16px; padding:18px; }
  #modal h2 { font-size:16px; color:var(--green); margin:0 24px 10px 0; }
  #modal .close { position:absolute; top:10px; right:12px; border:none; background:#eef2f0; border-radius:8px; padding:6px 10px; font-size:14px; }
  #modal .fld { font-size:13px; padding:4px 0; border-bottom:1px dashed var(--line); display:flex; }
  #modal .fld b { width:96px; color:var(--dim); font-weight:600; flex:none; }
  #modal .blk { font-size:13px; line-height:1.6; margin-top:8px; white-space:pre-wrap; word-break:break-word; }
  #modal .blk.todo::before { content:'☐ '; }
  #modal .blk.todo.done::before { content:'☑ '; }
  #modal .c-blue { color:#2455b0; }
  #modal a { color:var(--green); }
  .gantt { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; overflow-x:auto; }
  .gmonths { position:relative; height:18px; font-size:11px; color:var(--dim); min-width:560px; }
  .gmonths span { position:absolute; border-left:1px solid var(--line); padding-left:3px; }
  .grow { display:flex; align-items:center; min-width:560px; }
  .glabel { width:150px; flex:none; font-size:12px; padding:3px 6px 3px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .gtrack { position:relative; flex:1; height:20px; border-left:1px solid var(--line); }
  .gbar { position:absolute; top:3px; height:14px; border-radius:7px; background:#c9d8d0; }
  .gbar.b-進行中 { background:#e3b93f; }
  .gbar.b-待複驗 { background:#7c9bd6; }
  .gbar.b-完成 { background:#2e7d52; }
</style>
</head>
<body>
<header><h1>🐌 葉小蝸工程儀表板</h1>${headerLinks}</header>
<div class="cards" id="cards"><div class="empty">載入中…</div></div>
<div class="section" id="detail"></div>
<div id="modalBg" onclick="closeDoc()"></div>
<div id="modal"><button class="close" onclick="closeDoc()">✕</button><div id="modalBody"></div></div>
<script>
const TENANT = ${JSON.stringify(tenantKey)};
async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/dashboard/api/' + path + sep + 'tenant=' + encodeURIComponent(TENANT));
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function daysTo(d) {
  if (!d) return null;
  return Math.round((new Date(d) - new Date(new Date().toISOString().slice(0,10))) / 86400000);
}
let summary = [];
async function loadSummary() {
  const data = await api('summary');
  summary = data.cards;
  if (data.quota) {
    document.querySelector('header h1').insertAdjacentHTML('afterend',
      '<span style="font-size:12px;color:#dff0e7">推播 ' + data.quota.used + (data.quota.limit ? '/' + data.quota.limit : '') + ' 則/月</span>');
  }
  document.getElementById('cards').innerHTML = summary.map(c => {
    const dd = daysTo(c.startDate);
    return \`<div class="pcard" id="pc-\${c.id}" onclick="openProject('\${c.id}')">
      <h2>\${esc(c.name)} <span class="chip">\${esc(c.code)}</span><span class="chip">\${esc(c.status)}</span></h2>
      <div style="font-size:12px;color:var(--dim);margin-top:4px">\${c.startDate ? '目標動工 ' + c.startDate + (dd!==null ? '(' + (dd>=0?'還有 '+dd+' 天':'已過 '+(-dd)+' 天') + ')' : '') : '未設目標動工日'}</div>
      <div class="stats">
        <div class="stat\${c.openCount?'':''}"><b>\${c.openCount}</b><span>未銷項</span></div>
        <div class="stat\${c.aOpenCount?' red':''}"><b>\${c.aOpenCount}</b><span>A級未銷項</span></div>
        <div class="stat\${c.overdueCount?' red':''}"><b>\${c.overdueCount}</b><span>逾期</span></div>
        <div class="stat"><b>\${c.parkedCount}</b><span>擱置</span></div>
        <div class="stat\${c.pendingCoCount?' red':''}"><b>\${c.pendingCoCount}</b><span>待核准變更</span></div>
      </div>
    </div>\`;
  }).join('');
  if (summary.length) openProject(summary[0].id);
}
async function openProject(id) {
  summary.forEach(c => document.getElementById('pc-' + c.id)?.classList.toggle('active', c.id === id));
  const el = document.getElementById('detail');
  el.innerHTML = '<div class="empty">載入專案明細…</div>';
  const d = await api('project?project=' + id);
  const tickets = d.openTickets.length ? d.openTickets.map(t => \`
    <div class="tcard"><b>\${esc(t.number)}</b> \${t.level?'['+esc(t.level.slice(0,1))+'級]':''} \${esc(t.status)}
      \${t.overdue?'<span class="red">逾期</span>':''} ・ 期限 \${esc(t.deadline||'未設')}
      ・ <a href="#" onclick="openDoc('\${t.id||''}');return false" style="color:var(--green)">開單據</a><br>\${esc(t.description)}</div>\`).join('')
    : '<div class="empty">沒有未銷項單據 🎉</div>';

  const trades = [...new Set(d.matrix.map(m => m.trade))];
  const spaces = [...new Set(d.matrix.map(m => m.space))];
  const matrix = spaces.length ? \`<div class="matrix-wrap"><table>
      <tr><th>空間\\\\工種</th>\${trades.map(t => '<th>' + esc(t) + '</th>').join('')}</tr>
      \${spaces.map(s => '<tr><th>' + esc(s) + '</th>' + trades.map(t => {
        const cell = d.matrix.find(m => m.space === s && m.trade === t);
        return cell ? '<td class="s-' + esc(cell.status) + '" title="' + esc(cell.name) + '">' + esc(cell.status) + '</td>' : '<td></td>';
      }).join('') + '</tr>').join('')}
    </table></div>\` : '<div class="empty">尚無工項(建立工項後這裡會長出矩陣)</div>';

  const spacesBtns = d.photoSpaces.length ? d.photoSpaces.map(s =>
    \`<button class="spacebtn" id="sb-\${s.id||'none'}" \${s.id?'onclick="loadPhotos(\\'' + s.id + '\\')"':''}>\${esc(s.name)}(\${s.count})</button>\`
  ).join('') : '<div class="empty">尚無照片</div>';

  const sop = d.sopStages.map(stage => {
    const done = stage.items.filter(it => d.sopState[it.id]).length;
    return \`<div class="tcard"><b>\${esc(stage.title)}</b> <span style="color:var(--dim)">\${done}/\${stage.items.length}</span>
      \${stage.items.map(it => \`<label style="display:block;margin-top:6px;font-size:13px">
        <input type="checkbox" \${d.sopState[it.id]?'checked':''} onchange="sopCheck('\${id}','\${it.id}',this.checked)"> \${esc(it.text)}
      </label>\`).join('')}</div>\`;
  }).join('');

  const meetings = d.meetings.length ? d.meetings.map(m => \`
    <div class="tcard">📋 <b>\${esc(m.title)}</b> <span class="chip">\${esc(m.type)}</span>
      ・ <a href="#" onclick="openDoc('\${m.id}');return false" style="color:var(--green)">開會議記錄</a></div>\`).join('')
    : '<div class="empty">尚無會議記錄(傳會議錄音到群組即自動產生)</div>';

  const tasks = d.tasks.length ? d.tasks.map(t => \`
    <div class="tcard">\${t.overdue ? '<span class="red">⚠ 逾期</span> ' : ''}☐ <b onclick="openDoc('\${t.id}')" style="cursor:pointer;color:var(--green)">\${esc(t.content)}</b>
      <span style="color:var(--ink-soft);font-size:12px"> ・ \${esc(t.owner || '未指派')} ・ 期限 \${esc(t.due || '未設')} ・ \${esc(t.status)}(\${esc(t.source)})</span></div>\`).join('')
    : '<div class="empty">沒有未完成的待辦 🎉</div>';

  const calendar = d.calendarId
    ? \`<div style="background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden"><iframe src="https://calendar.google.com/calendar/embed?src=\${encodeURIComponent(d.calendarId)}&ctz=Asia%2FTaipei&mode=MONTH&showTitle=0&showPrint=0&showTz=0" style="border:0;width:100%;height:480px"></iframe></div>\`
    : '<div class="empty">此專案尚未建立行事曆</div>';

  el.innerHTML = \`
    <h3>專案行事曆(會議與行程,可訂閱同步手機)</h3>\${calendar}
    <h3>甘特圖(預計時程,依會議修正)</h3><div id="ganttArea"><div class="empty">載入中…</div></div>
    <h3>待辦任務(\${d.tasks.length})</h3>\${tasks}
    <h3>SOP-01 階段檢核(完成定義,PM 勾核)</h3>\${sop}
    <h3>會議記錄(\${d.meetings.length})</h3>\${meetings}
    <h3>未銷項清單(\${d.openTickets.length})</h3>\${tickets}
    <h3>空間 × 工種狀態矩陣</h3>\${matrix}
    <h3>照片瀏覽(選空間看時間軸)</h3><div class="spaces">\${spacesBtns}</div>
    <div class="photos" id="photoArea"></div>\`;
  loadGantt(id).catch(() => {});
}
async function openDoc(pageId) {
  document.getElementById('modalBg').style.display = 'block';
  const m = document.getElementById('modal');
  m.style.display = 'block';
  const body = document.getElementById('modalBody');
  body.innerHTML = '<div class="empty">載入中…</div>';
  try {
    const d = await api('doc?page=' + pageId);
    window._docFields = d.fields; window._docPage = pageId;
    body.innerHTML = '<h2>' + esc(d.title) + '</h2>'
      + d.fields.map((f, i) => '<div class="fld" id="fld-' + i + '"><b>' + esc(f.name) + '</b><span>' + esc(f.value)
          + (f.editable ? ' <a href="#" onclick="editFld(' + i + ');return false" style="text-decoration:none">✏️</a>' : '') + '</span></div>').join('')
      + d.blocks.map(b => {
          // 子頁面 tab(摘要/筆記/逐字稿)→ 點入在彈窗載入該分頁
          if (b.type === 'child_page') {
            return '<div class="blk"><a href="#" onclick="openDoc(\\'' + b.id + '\\');return false" style="color:var(--green);font-weight:600">📑 ' + esc(b.title) + ' ▸</a></div>';
          }
          const inner = b.spans.map(s => {
            const sp = '<span class="' + (s.color !== 'default' ? 'c-' + esc(s.color) : '') + '">' + esc(s.text) + '</span>';
            if (!s.link) return sp;
            // Notion 頁面連結 → 改開彈窗(一路都留在網頁裡);外部連結(Drive 等)照常開新頁
            const nm = s.link.match(/notion\\.(?:so|com)\\/[^\\s]*?([0-9a-f]{32})/);
            return nm
              ? '<a href="#" onclick="openDoc(\\'' + nm[1] + '\\');return false">' + sp + ' ▸</a>'
              : '<a href="' + esc(s.link) + '" target="_blank">' + sp + '</a>';
          }).join('');
          if (b.type === 'to_do') {
            return '<div class="blk"><label><input type="checkbox" ' + (b.checked ? 'checked' : '')
              + ' onchange="toggleTodo(\\'' + b.id + '\\',this.checked)"> ' + inner + '</label></div>';
          }
          return '<div class="blk">' + inner + '</div>';
        }).join('')
      + '<div style="margin-top:12px;font-size:12px"><a href="' + esc(d.notionUrl) + '" target="_blank">在 Notion 中開啟 ↗</a></div>';
  } catch (e) { body.innerHTML = '<div class="empty">載入失敗:' + esc(e.message) + '</div>'; }
}
async function editFld(i) {
  const f = window._docFields[i];
  const row = document.getElementById('fld-' + i);
  let input;
  if (f.type === 'select') {
    input = '<select id="fin-' + i + '"><option value="">(清空)</option>' + (f.options || []).map(o =>
      '<option ' + (o === f.value ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  } else if (f.type === 'date') {
    input = '<input id="fin-' + i + '" type="date" value="' + esc(f.value) + '">';
  } else if (f.type === 'number') {
    input = '<input id="fin-' + i + '" type="number" value="' + esc(f.value) + '" style="width:120px">';
  } else {
    input = '<input id="fin-' + i + '" value="' + esc(f.value) + '" style="width:100%">';
  }
  row.innerHTML = '<b>' + esc(f.name) + '</b><span style="flex:1">' + input
    + ' <button onclick="saveFld(' + i + ')" style="background:var(--green);color:#fff;border:none;border-radius:6px;padding:4px 10px">存</button></span>';
}
async function saveFld(i) {
  const f = window._docFields[i];
  const value = document.getElementById('fin-' + i).value;
  try {
    await fetch('/dashboard/api/doc-edit?tenant=' + encodeURIComponent(TENANT), {
      method: 'POST',
      body: JSON.stringify({ page: window._docPage, prop: f.name, type: f.type, value, operator: localStorage.getItem('queueOperator') || '網頁' }),
    }).then(r => { if (!r.ok) throw new Error('儲存失敗'); });
    openDoc(window._docPage);
  } catch (e) { alert(e.message); }
}
async function toggleTodo(blockId, checked) {
  await fetch('/dashboard/api/todo-toggle?tenant=' + encodeURIComponent(TENANT), {
    method: 'POST', body: JSON.stringify({ block: blockId, checked }),
  }).catch(() => {});
}
function closeDoc() {
  document.getElementById('modalBg').style.display = 'none';
  document.getElementById('modal').style.display = 'none';
}
async function loadGantt(projectId) {
  const el = document.getElementById('ganttArea');
  const d = await api('gantt?project=' + projectId);
  if (!d.rows.length) { el.innerHTML = '<div class="empty">工項尚無時程(填入預計開始/完成後顯示)</div>'; return; }
  const t0 = new Date(d.rows.reduce((a, r) => r.start < a ? r.start : a, d.rows[0].start)).getTime();
  const t1 = new Date(d.rows.reduce((a, r) => r.end > a ? r.end : a, d.rows[0].end)).getTime() + 86400000;
  const pct = (x) => (new Date(x).getTime() - t0) / (t1 - t0) * 100;
  const months = [];
  const cur = new Date(t0); cur.setUTCDate(1);
  while (cur.getTime() < t1) {
    if (cur.getTime() >= t0) months.push('<span style="left:' + pct(cur.toISOString().slice(0,10)).toFixed(1) + '%">' + (cur.getUTCMonth() + 1) + '月</span>');
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  el.innerHTML = '<div class="gantt"><div class="gmonths" style="margin-left:150px">' + months.join('') + '</div>'
    + d.rows.map(r => {
        const l = pct(r.start);
        const w = Math.max(pct(r.end) - l + (86400000 / (t1 - t0) * 100), 1.5);
        return '<div class="grow"><div class="glabel" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="gtrack">'
          + '<div class="gbar b-' + esc(r.status) + '" style="left:' + l.toFixed(1) + '%;width:' + w.toFixed(1) + '%" title="' + r.start + '→' + r.end + (r.fee ? ' ' + (r.fee / 10000) + '萬' : '') + ' [' + r.status + ']"></div>'
          + '</div></div>';
      }).join('')
    + '<div style="font-size:11px;color:var(--dim);margin-top:6px">灰=未開始 黃=進行中 藍=待複驗 綠=完成;點長條看日期與預算</div></div>';
}
async function sopCheck(projectId, itemId, checked) {
  try {
    const r = await fetch('/dashboard/api/sop-check?tenant=' + encodeURIComponent(TENANT), {
      method: 'POST', body: JSON.stringify({ project: projectId, itemId, checked }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
  } catch (e) { alert('勾核儲存失敗:' + e.message); }
}
async function loadPhotos(spaceId) {
  document.querySelectorAll('.spacebtn').forEach(b => b.classList.toggle('active', b.id === 'sb-' + spaceId));
  const area = document.getElementById('photoArea');
  area.innerHTML = '<div class="empty">載入照片…</div>';
  const d = await api('photos?space=' + spaceId);
  area.innerHTML = d.photos.length ? d.photos.map(ph => \`
    <figure>
      <a href="\${esc(ph.url)}" target="_blank"><img loading="lazy" src="/queue/api/photo?file=\${encodeURIComponent(ph.fileId)}&tenant=\${encodeURIComponent(TENANT)}"></a>
      <figcaption>\${esc(ph.date)}\${ph.workItem?'<br>'+esc(ph.workItem):''}</figcaption>
    </figure>\`).join('') : '<div class="empty">此空間尚無已歸檔照片</div>';
}
loadSummary();
</script>
</body>
</html>`;
}

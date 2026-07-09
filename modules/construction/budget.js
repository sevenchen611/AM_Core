// 預算控制(/budget)——抽自 BuildAM src/budget.js,改為多租戶。
// 授權/scope 由 index.js 的 webRoute(走 core.portal)算好並注入 URL(不信任前端原始參數);
// 權限鍵 per-tenant:am-<tenant>-budget。deps 逐呼叫傳入(index.fullDeps),不用模組級全域。
// 資料存該租戶「預算控制」資料庫;合約回寫的已發包金額由 contracts.js 維護。

import { plain, sameId, textFrag, queryAll, readJsonBody, sendJson, parseScope, assertProjectInScope } from './common.js';
import { listKnownTrades } from './trades.js';

const TRADES = ['拆除', '水電', '弱電', '防水', '泥作', '木作', '鐵工', '油漆', '設備', '收尾', '其他'];
const STATUSES = ['未發包', '部分發包', '已發包'];

// 確認頁面屬於「本租戶」的預算控制資料庫(防止拿別的頁面 ID 來改;兼顧跨租戶隔離)
async function assertBudgetPage(deps, pageId) {
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, deps.dataSources.budgets)) {
    throw new Error('不是預算控制的資料列');
  }
  return page;
}

// 沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps);authed/key/budget/scope 由 index.webRoute 注入 URL。
// 授權已在 webRoute(core.portal)完成;此處只讀 webRoute 重算後的 budget/contract/scope,不再自檢 key。
export async function handleBudgetRequest(req, res, pathname, url, deps) {
  const key = url.searchParams.get('key') || '';
  const canBudget = url.searchParams.get('budget') === '1';
  const canContract = url.searchParams.get('contract') === '1';
  const scope = parseScope(url);
  try {
    if (req.method === 'GET' && pathname === '/budget') {
      res.writeHead(canBudget ? 200 : 403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(canBudget ? renderBudgetPage(deps.tenantKey, key, canContract) : renderDeniedPage());
    }
    if (!canBudget) return sendJson(res, 403, { error: '無預算檢視權限' });

    if (req.method === 'GET' && pathname === '/budget/api/overview') {
      return sendJson(res, 200, await buildOverview(deps, scope));
    }
    if (req.method === 'POST' && pathname === '/budget/api/create') {
      return sendJson(res, 200, await createRow(deps, await readJsonBody(req), scope));
    }
    if (req.method === 'POST' && pathname === '/budget/api/edit') {
      return sendJson(res, 200, await editRow(deps, await readJsonBody(req)));
    }
    if (req.method === 'POST' && pathname === '/budget/api/archive') {
      return sendJson(res, 200, await archiveRow(deps, await readJsonBody(req)));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Budget error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

async function buildOverview(deps, scope) {
  if (!deps.dataSources.budgets) throw new Error('預算控制資料庫尚未設定(<PREFIX>_BUDGETS_DATA_SOURCE_ID)');
  const projectPages = await queryAll(deps, deps.dataSources.projects);
  const projects = [];
  for (const page of projectPages) {
    const p = page.properties;
    const code = plain(p['館別代碼']?.rich_text);
    if (scope && !scope.has(code)) continue;
    projects.push({ id: page.id, name: plain(p['專案名稱']?.title), code, status: p['狀態']?.select?.name || '' });
  }
  for (const project of projects) {
    const pages = await queryAll(deps, deps.dataSources.budgets, { property: '專案', relation: { contains: project.id } });
    let total = 0;
    let totalRowId = null;
    const rows = [];
    const subsByParent = new Map();
    for (const page of pages) {
      const p = page.properties;
      const amount = p['預算金額']?.number || 0;
      const category = p['類別']?.select?.name || '';
      if (category === '總預算') {
        total += amount;
        if (!totalRowId) totalRowId = page.id;
        continue;
      }
      const item = {
        id: page.id,
        name: plain(p['預算項目']?.title),
        trade: p['工種']?.select?.name || '',
        budget: amount,
        unitPrice: p['單價']?.number ?? null,
        qty: p['數量']?.number ?? null,
        committed: p['已發包金額']?.number || 0,
        vendor: plain(p['發包對象']?.rich_text),
        date: (p['發包日期']?.date?.start || '').slice(0, 10),
        status: p['狀態']?.select?.name || '未發包',
        note: plain(p['備註']?.rich_text),
      };
      const parentId = p['上層項目']?.relation?.[0]?.id;
      if (category === '小項' && parentId) {
        if (!subsByParent.has(parentId)) subsByParent.set(parentId, []);
        subsByParent.get(parentId).push(item);
        continue;
      }
      rows.push(item);
    }
    rows.sort((a, b) => b.budget - a.budget);
    for (const r of rows) {
      r.children = (subsByParent.get(r.id) || []).sort((a, b) => b.budget - a.budget);
      r.childSum = r.children.reduce((sum, c) => sum + c.budget, 0);
      subsByParent.delete(r.id);
    }
    for (const orphans of subsByParent.values()) {
      rows.push(...orphans.map((o) => ({ ...o, children: [], childSum: 0, orphan: true })));
    }
    project.total = total;
    project.totalRowId = totalRowId;
    project.allocated = rows.reduce((sum, r) => sum + r.budget, 0);
    project.committed = rows.reduce((sum, r) => sum + r.committed, 0);
    project.rows = rows;
  }
  const trades = await listKnownTrades(deps).catch(() => TRADES);
  return { projects, trades, statuses: STATUSES };
}

function rowProperties(fields) {
  const props = {};
  if (fields.name !== undefined) props['預算項目'] = { title: textFrag(fields.name || '(未命名)') };
  if (fields.trade !== undefined) props['工種'] = { select: fields.trade ? { name: fields.trade } : null };
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (fields.unitPrice !== undefined) props['單價'] = { number: num(fields.unitPrice) };
  if (fields.qty !== undefined) props['數量'] = { number: num(fields.qty) };
  const hasUnitQty = num(fields.unitPrice) != null && num(fields.qty) != null;
  if (hasUnitQty) props['預算金額'] = { number: Number(fields.unitPrice) * Number(fields.qty) };
  else if (fields.budget !== undefined) props['預算金額'] = { number: num(fields.budget) };
  if (fields.committed !== undefined) props['已發包金額'] = { number: num(fields.committed) };
  if (fields.vendor !== undefined) props['發包對象'] = { rich_text: textFrag(fields.vendor) };
  if (fields.date !== undefined) props['發包日期'] = { date: fields.date ? { start: fields.date } : null };
  if (fields.status !== undefined) props['狀態'] = { select: fields.status ? { name: fields.status } : null };
  if (fields.note !== undefined) props['備註'] = { rich_text: textFrag(fields.note) };
  return props;
}

async function appendLog(deps, pageId, action, operator, detail) {
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: textFrag(`[${action}] ${stamp} ${operator || '預算頁'}:${detail}`) } }] },
  }).catch(() => {});
}

async function createRow(deps, { project, category, parent, operator, ...fields }, scope) {
  if (!project) throw new Error('project required');
  if (!['總預算', '工程預算', '小項'].includes(category)) throw new Error('category 須為 總預算/工程預算/小項');
  await assertProjectInScope(deps, scope, project);
  if (category === '小項' && !parent) throw new Error('小項需要指定上層工程預算');
  const props = rowProperties({ name: category === '總預算' ? '總預算' : '', ...fields });
  props['專案'] = { relation: [{ id: project }] };
  props['類別'] = { select: { name: category } };
  if (parent) {
    await assertBudgetPage(deps, parent);
    props['上層項目'] = { relation: [{ id: parent }] };
  }
  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: deps.dataSources.budgets }, properties: props },
  });
  await appendLog(deps, created.id, '新增', operator, `${category} 預算 ${fields.budget || 0}`);
  return { ok: true, id: created.id };
}

async function editRow(deps, { page, operator, ...fields }) {
  if (!page) throw new Error('page required');
  await assertBudgetPage(deps, page);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, {
    method: 'PATCH',
    body: { properties: rowProperties(fields) },
  });
  const detail = Object.entries(fields).map(([k, v]) => `${k}=${v === '' ? '(清空)' : v}`).join(' ');
  await appendLog(deps, page, '編輯', operator, detail);
  return { ok: true };
}

async function archiveRow(deps, { page, operator }) {
  if (!page) throw new Error('page required');
  const target = await assertBudgetPage(deps, page);
  const name = plain(Object.values(target.properties).find((v) => v.type === 'title')?.title);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, { method: 'PATCH', body: { archived: true } });
  console.log(`Budget row archived by ${operator || '預算頁'}: ${name} (${page})`);
  return { ok: true };
}

function renderDeniedPage() {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>預算控制</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;background:#f5f7f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#22302a}
div{background:#fff;border:1px solid #e0e6e3;border-radius:16px;padding:28px;text-align:center;max-width:320px}
h1{font-size:17px;color:#2e7d52;margin:0 0 10px}p{font-size:13px;color:#6b7a72;line-height:1.7;margin:0}a{color:#2e7d52}</style></head>
<body><div><h1>💰 預算控制</h1><p>這個頁面的權限與專案檢視分開,需要另外授權。<br>請洽 Seven 在 AM Portal 帳號管理勾選「預算控制表」。<br><br><a href="/dashboard">← 回儀表板</a></p></div></body></html>`;
}

function renderBudgetPage(tenantKey, key, canContract) {
  const qs = (extra) => `?tenant=${encodeURIComponent(tenantKey)}&key=${encodeURIComponent(key)}${extra || ''}`;
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>預算控制</title>
<style>
  :root { --green:#2e7d52; --bg:#f5f7f6; --card:#fff; --line:#e0e6e3; --dim:#6b7a72; --red:#a03e33; --amber:#8a6d1a; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif; background:var(--bg); color:#22302a; padding-bottom:60px; }
  header { background:var(--green); color:#fff; padding:12px 16px; display:flex; align-items:center; gap:14px; position:sticky; top:0; z-index:5; }
  header h1 { font-size:17px; }
  header a { margin-left:auto; color:#dff0e7; font-size:13px; text-decoration:none; }
  .tabs { display:flex; flex-wrap:wrap; gap:8px; padding:12px 12px 0; }
  .tab { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:8px 16px; font-size:14px; cursor:pointer; }
  .tab.active { background:var(--green); color:#fff; border-color:var(--green); }
  .section { margin:12px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; }
  .pcard { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; flex:1 1 260px; cursor:pointer; }
  .pcard h2 { font-size:15px; display:flex; gap:8px; align-items:center; }
  .pcard .chip { border-radius:20px; padding:2px 9px; font-size:12px; background:#eef2f0; }
  .stats { display:flex; gap:16px; margin-top:10px; flex-wrap:wrap; }
  .stat b { font-size:19px; display:block; font-variant-numeric:tabular-nums; }
  .stat span { font-size:11px; color:var(--dim); }
  .stat.red b { color:var(--red); }
  .bar { height:10px; background:#e8ede9; border-radius:5px; overflow:hidden; margin-top:10px; }
  .bar div { height:100%; background:var(--green); }
  .bar div.over { background:var(--red); }
  .barnote { font-size:11px; color:var(--dim); margin-top:4px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:12px; }
  .panel h3 { font-size:14px; color:var(--dim); margin-bottom:10px; }
  .btn { background:var(--green); color:#fff; border:none; border-radius:8px; padding:7px 14px; font-size:13px; cursor:pointer; }
  .btn.ghost { background:#eef2f0; color:#22302a; }
  .btn.danger { background:#fbeae7; color:var(--red); }
  .twrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  table { border-collapse:collapse; background:var(--card); font-size:13px; width:100%; min-width:760px; }
  th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; white-space:nowrap; }
  th { background:#eef2f0; font-size:12px; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  td .red { color:var(--red); font-weight:600; }
  .st-未發包 { color:#98a5a0; }
  .st-部分發包 { color:var(--amber); font-weight:600; }
  .st-已發包 { color:#1d6b41; font-weight:600; }
  tr.sub td { background:#f7faf8; font-size:12.5px; }
  tr.subsum td { background:#eef4f0; font-size:12px; color:var(--dim); }
  tr.subsum td b { color:#22302a; }
  .subname { padding-left:24px; }
  .caret { border:none; background:none; cursor:pointer; font-size:12px; padding:0 4px 0 0; color:var(--green); }
  .warn { color:var(--red); font-weight:600; }
  .dim { color:var(--dim); font-size:11px; font-weight:normal; }
  .rowbtn { border:none; background:#eef2f0; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer; margin-left:4px; }
  input,select { border:1px solid var(--line); border-radius:6px; padding:6px 8px; font-size:13px; font-family:inherit; }
  input.money { width:130px; text-align:right; }
  .form { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
  .empty { color:var(--dim); padding:20px; text-align:center; font-size:13px; }
  .grand { background:#eaf3ee; border-color:#cfe3d7; }
</style>
</head>
<body>
<header><h1>💰 預算控制</h1>${canContract ? `<a href="/contracts${qs()}">→ 📑 合約發包</a>` : ''}<a href="/dashboard${qs()}" style="${canContract ? 'margin-left:14px' : ''}">→ 儀表板</a><a href="/queue${qs()}" style="margin-left:14px">→ 確認佇列</a></header>
<div class="tabs" id="tabs"></div>
<div class="section" id="main"><div class="empty">載入中…</div></div>
<script>
const TENANT = ${JSON.stringify(tenantKey)};
const KEY = ${JSON.stringify(key)};
let DATA = null;      // overview 回傳
let CURRENT = 'all';  // 'all' 或 projectId
const EXPANDED = new Set();  // 展開小項的工程預算列 id
const OPERATOR = () => localStorage.getItem('queueOperator') || '預算頁';
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function money(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
function fmtNum(v) { const d = String(v ?? '').replace(/[^0-9]/g, ''); return d ? Number(d).toLocaleString('en-US') : ''; }
function unfmt(v) { return String(v || '').replace(/,/g, ''); }
const MONEY_ATTRS = 'type="text" inputmode="numeric" oninput="this.value=fmtNum(this.value)"';
async function api(path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/budget/api/' + path + sep + 'tenant=' + encodeURIComponent(TENANT) + '&key=' + encodeURIComponent(KEY),
    body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
async function load(keepCurrent) {
  DATA = await api('overview');
  if (!keepCurrent) CURRENT = DATA.projects.length === 1 ? DATA.projects[0].id : 'all';
  render();
}
function render() {
  const tabs = document.getElementById('tabs');
  tabs.innerHTML = '<button class="tab' + (CURRENT === 'all' ? ' active' : '') + '" onclick="pick(\\'all\\')">全部專案</button>'
    + DATA.projects.map(p => '<button class="tab' + (CURRENT === p.id ? ' active' : '') + '" onclick="pick(\\'' + p.id + '\\')">' + esc(p.name) + '</button>').join('');
  const main = document.getElementById('main');
  main.innerHTML = CURRENT === 'all' ? renderAll() : renderProject(DATA.projects.find(p => p.id === CURRENT));
}
function pick(id) { CURRENT = id; render(); }
function statsHtml(total, allocated, committed) {
  const remaining = total - committed;
  const unallocated = total - allocated;
  const pc = total ? Math.min(100, Math.round(committed / total * 100)) : 0;
  const over = total && committed > total;
  return '<div class="stats">'
    + '<div class="stat"><b>' + money(total) + '</b><span>總預算</span></div>'
    + '<div class="stat"><b>' + money(committed) + '</b><span>已發包</span></div>'
    + '<div class="stat' + (remaining < 0 ? ' red' : '') + '"><b>' + money(remaining) + '</b><span>未發包餘額</span></div>'
    + '<div class="stat"><b>' + money(allocated) + '</b><span>已拆分給工程</span></div>'
    + '<div class="stat' + (unallocated < 0 ? ' red' : '') + '"><b>' + money(unallocated) + '</b><span>未拆分</span></div>'
    + '</div><div class="bar"><div class="' + (over ? 'over' : '') + '" style="width:' + pc + '%"></div></div>'
    + '<div class="barnote">總預算已發包 ' + pc + '%' + (over ? '(已超支!)' : '') + '</div>';
}
function renderAll() {
  const gt = DATA.projects.reduce((a, p) => ({ total: a.total + p.total, allocated: a.allocated + p.allocated, committed: a.committed + p.committed }), { total: 0, allocated: 0, committed: 0 });
  return '<div class="panel grand"><h3>全部專案合計</h3>' + statsHtml(gt.total, gt.allocated, gt.committed) + '</div>'
    + '<div class="cards">' + DATA.projects.map(p => '<div class="pcard" onclick="pick(\\'' + p.id + '\\')">'
      + '<h2>' + esc(p.name) + ' <span class="chip">' + esc(p.code) + '</span><span class="chip">' + esc(p.status) + '</span></h2>'
      + statsHtml(p.total, p.allocated, p.committed) + '</div>').join('')
    + (DATA.projects.length ? '' : '<div class="empty">沒有可看的專案</div>') + '</div>';
}
function renderProject(p) {
  if (!p) return '<div class="empty">找不到專案</div>';
  const totalPanel = '<div class="panel"><h3>' + esc(p.name) + ':總預算</h3>' + statsHtml(p.total, p.allocated, p.committed)
    + '<div class="form">'
    + (p.totalRowId
      ? '<span style="font-size:13px">總預算金額</span><input class="money" id="total-input" ' + MONEY_ATTRS + ' value="' + fmtNum(p.total) + '"><button class="btn" onclick="saveTotal(\\'' + p.totalRowId + '\\')">更新總預算</button>'
      : '<span style="font-size:13px">尚未設定總預算 →</span><input class="money" id="total-input" ' + MONEY_ATTRS + ' placeholder="金額"><button class="btn" onclick="createTotal(\\'' + p.id + '\\')">設定總預算</button>')
    + '</div></div>';
  const rowsHtml = p.rows.map(r => rowHtml(r) + childrenHtml(r)).join('');
  const datalist = '<datalist id="tradeList">' + DATA.trades.map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>';
  const table = datalist + '<div class="panel"><h3>工程預算(由總預算拆分;點 ▸ 展開小項,小項可用單價×數量)</h3>'
    + '<div class="twrap"><table><tr><th>工程項目</th><th>工種</th><th class="num">單價</th><th class="num">數量</th><th class="num">預算金額</th><th class="num">已發包</th><th class="num">餘額</th><th>狀態</th><th>發包對象</th><th>發包日期</th><th>備註</th><th></th></tr>'
    + '<tr id="new-row"><td colspan="12" style="text-align:center"><button class="btn ghost" onclick="showNewForm()">＋ 新增工程預算</button></td></tr>'
    + rowsHtml + '</table></div>'
    + (p.rows.length ? '' : '<div class="empty">尚未拆分工程預算,點上方「＋ 新增工程預算」開始</div>') + '</div>';
  return totalPanel + table;
}
function unitCells(r) {
  return '<td class="num">' + (r.unitPrice != null ? money(r.unitPrice) : '') + '</td>'
    + '<td class="num">' + (r.qty != null ? r.qty.toLocaleString('en-US') : '') + '</td>';
}
function rowHtml(r) {
  const left = r.budget - r.committed;
  const caret = r.children.length
    ? '<button class="caret" onclick="toggleSub(\\'' + r.id + '\\')">' + (EXPANDED.has(r.id) ? '▾' : '▸') + ' ' + r.children.length + '</button>'
    : '';
  const remainder = r.budget - r.childSum;
  const hint = r.children.length && remainder !== 0
    ? (remainder < 0 ? ' <span class="warn">超出 ' + money(-remainder) + '</span>' : ' <span class="dim">未分配 ' + money(remainder) + '</span>')
    : '';
  return '<tr id="row-' + r.id + '">'
    + '<td>' + caret + esc(r.name) + hint + (r.orphan ? ' <span class="warn" title="原本的母項已封存">孤兒小項</span>' : '') + '</td><td>' + esc(r.trade) + '</td>'
    + unitCells(r)
    + '<td class="num">' + money(r.budget) + '</td><td class="num">' + money(r.committed) + '</td>'
    + '<td class="num">' + (left < 0 ? '<span class="red">' + money(left) + '</span>' : money(left)) + '</td>'
    + '<td class="st-' + esc(r.status) + '">' + esc(r.status) + '</td>'
    + '<td>' + esc(r.vendor) + '</td><td>' + esc(r.date) + '</td><td style="white-space:normal;min-width:120px">' + esc(r.note) + '</td>'
    + '<td><button class="rowbtn" onclick="editForm(\\'' + r.id + '\\')">✏️ 編輯</button>'
    + (r.orphan ? '' : '<button class="rowbtn" onclick="openSubForm(\\'' + r.id + '\\')">＋小項</button>')
    + '<button class="rowbtn" onclick="archiveRow(\\'' + r.id + '\\', \\'' + esc(r.name) + '\\')">🗄 封存</button></td>'
    + '</tr>';
}
function childrenHtml(r) {
  if (!EXPANDED.has(r.id)) return '';
  const kids = r.children.map(c => {
    const left = c.budget - c.committed;
    return '<tr class="sub" id="row-' + c.id + '">'
      + '<td class="subname">└ ' + esc(c.name) + '</td><td>' + esc(c.trade) + '</td>'
      + unitCells(c)
      + '<td class="num">' + money(c.budget) + '</td><td class="num">' + money(c.committed) + '</td>'
      + '<td class="num">' + (left < 0 ? '<span class="red">' + money(left) + '</span>' : money(left)) + '</td>'
      + '<td class="st-' + esc(c.status) + '">' + esc(c.status) + '</td>'
      + '<td>' + esc(c.vendor) + '</td><td>' + esc(c.date) + '</td><td style="white-space:normal;min-width:120px">' + esc(c.note) + '</td>'
      + '<td><button class="rowbtn" onclick="editForm(\\'' + c.id + '\\')">✏️</button><button class="rowbtn" onclick="archiveRow(\\'' + c.id + '\\', \\'' + esc(c.name) + '\\')">🗄</button></td>'
      + '</tr>';
  }).join('');
  const remainder = r.budget - r.childSum;
  const unalloc = '<tr class="subsum"><td class="subname">未分配(自動)</td><td colspan="3"></td>'
    + '<td class="num">' + (remainder < 0 ? '<b class="warn">' + money(remainder) + '</b>' : '<b>' + money(remainder) + '</b>') + '</td>'
    + '<td colspan="6">'
    + (remainder === 0 ? '已分配完畢 ✓'
      : remainder < 0 ? '<span class="warn">小項合計超出母項預算 ' + money(-remainder) + ',請調整母項或小項</span>'
      : '小項小計 ' + money(r.childSum) + ' ＋ 未分配 ' + money(remainder) + ' ＝ 母項 ' + money(r.budget))
    + '</td><td></td></tr>';
  return kids + unalloc + '<tr class="sub" id="subnew-' + r.id + '"><td colspan="12" class="subname"><button class="btn ghost" style="padding:4px 10px;font-size:12px" onclick="showSubForm(\\'' + r.id + '\\')">＋ 新增小項</button></td></tr>';
}
function selectHtml(id, options, value, blank) {
  return '<select id="' + id + '">' + (blank ? '<option value="">-</option>' : '')
    + options.map(o => '<option ' + (o === value ? 'selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
}
function formCells(r) {
  return '<td><input id="f-name" value="' + esc(r.name || '') + '" style="width:120px" placeholder="例:大鋁窗"></td>'
    + '<td><input id="f-trade" list="tradeList" value="' + esc(r.trade || '') + '" style="width:82px" placeholder="工種(可打新的)"></td>'
    + '<td class="num"><input id="f-unit" class="money" style="width:100px" type="text" inputmode="numeric" oninput="this.value=fmtNum(this.value);recalcAmt()" value="' + fmtNum(r.unitPrice ?? '') + '" placeholder="單價"></td>'
    + '<td class="num"><input id="f-qty" style="width:56px;text-align:right" type="text" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,\\'\\');recalcAmt()" value="' + (r.qty ?? '') + '" placeholder="數量"></td>'
    + '<td class="num"><input id="f-budget" class="money" style="width:110px" ' + MONEY_ATTRS + ' value="' + fmtNum(r.budget ?? '') + '"></td>'
    + '<td class="num"><input id="f-committed" class="money" style="width:110px" ' + MONEY_ATTRS + ' value="' + fmtNum(r.committed ?? '') + '"></td>'
    + '<td class="num" style="color:var(--dim)">自動</td>'
    + '<td>' + selectHtml('f-status', DATA.statuses, r.status || '未發包') + '</td>'
    + '<td><input id="f-vendor" value="' + esc(r.vendor || '') + '" style="width:100px"></td>'
    + '<td><input id="f-date" type="date" value="' + esc(r.date || '') + '"></td>'
    + '<td><input id="f-note" value="' + esc(r.note || '') + '" style="width:110px"></td>';
}
function recalcAmt() {
  const u = unfmt(document.getElementById('f-unit').value);
  const q = document.getElementById('f-qty').value;
  const b = document.getElementById('f-budget');
  if (u !== '' && q !== '') b.value = fmtNum(Math.round(Number(u) * Number(q)));
}
function readForm() {
  return {
    name: document.getElementById('f-name').value.trim(),
    trade: document.getElementById('f-trade').value,
    unitPrice: unfmt(document.getElementById('f-unit').value),
    qty: document.getElementById('f-qty').value,
    budget: unfmt(document.getElementById('f-budget').value),
    committed: unfmt(document.getElementById('f-committed').value),
    status: document.getElementById('f-status').value,
    vendor: document.getElementById('f-vendor').value.trim(),
    date: document.getElementById('f-date').value,
    note: document.getElementById('f-note').value.trim(),
    operator: OPERATOR(),
  };
}
function findRow(id) {
  const rows = DATA.projects.find(p => p.id === CURRENT).rows;
  for (const r of rows) {
    if (r.id === id) return r;
    const c = (r.children || []).find(x => x.id === id);
    if (c) return c;
  }
  return null;
}
function showNewForm() {
  document.getElementById('new-row').innerHTML = formCells({})
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="createWork()">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
function editForm(id) {
  const r = findRow(id);
  document.getElementById('row-' + id).innerHTML = formCells(r)
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="saveRow(\\'' + id + '\\')">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
function toggleSub(id) { EXPANDED.has(id) ? EXPANDED.delete(id) : EXPANDED.add(id); render(); }
function openSubForm(id) { EXPANDED.add(id); render(); showSubForm(id); }
function showSubForm(parentId) {
  document.getElementById('subnew-' + parentId).innerHTML = formCells({})
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="createSub(\\'' + parentId + '\\')">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
async function run(fn) { try { await fn(); await load(true); } catch (e) { alert(e.message); } }
async function createWork() { const f = readForm(); if (!f.name) return alert('請填工程項目名稱'); await run(() => api('create', { project: CURRENT, category: '工程預算', ...f })); }
async function createSub(parentId) { const f = readForm(); if (!f.name) return alert('請填小項名稱'); await run(() => api('create', { project: CURRENT, category: '小項', parent: parentId, ...f })); }
async function saveRow(id) { await run(() => api('edit', { page: id, ...readForm() })); }
async function createTotal(projectId) {
  const v = unfmt(document.getElementById('total-input').value);
  if (v === '') return alert('請填總預算金額');
  await run(() => api('create', { project: projectId, category: '總預算', budget: v, operator: OPERATOR() }));
}
async function saveTotal(rowId) {
  const v = unfmt(document.getElementById('total-input').value);
  if (v === '') return alert('請填總預算金額');
  await run(() => api('edit', { page: rowId, budget: v, operator: OPERATOR() }));
}
async function archiveRow(id, name) {
  if (!confirm('確定封存「' + name + '」?封存後從表中消失(可在 Notion 垃圾桶找回)。')) return;
  await run(() => api('archive', { page: id, operator: OPERATOR() }));
}
load();
</script>
</body>
</html>`;
}

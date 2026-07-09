// 合約發包管理(/contracts)——抽自 BuildAM src/contracts.js,改為多租戶。
// 授權/scope 由 index.js 的 webRoute(走 core.portal)注入 URL(不信任前端原始參數);權限鍵 per-tenant:am-<tenant>-contract。
// 合約簽約/金額異動會自動回寫該租戶「預算控制」的已發包金額/對象/日期/狀態。

import { plain, sameId, textFrag, queryAll, readJsonBody, sendJson, parseScope, assertProjectInScope } from './common.js';

const STATUSES = ['洽談中', '報價中', '已簽約', '施工中', '已完工', '結案', '作廢'];
// 這些狀態的合約金額計入「已發包」
const COMMITTED_STATUSES = new Set(['已簽約', '施工中', '已完工', '結案']);

async function assertContractPage(deps, pageId) {
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, deps.dataSources.contracts)) {
    throw new Error('不是發包合約的資料列');
  }
  return page;
}

async function appendLog(deps, pageId, action, operator, detail) {
  const stamp = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: textFrag(`[${action}] ${stamp} ${operator || '合約頁'}:${detail}`) } }] },
  }).catch(() => {});
}

// 沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps);authed/key/contract/scope 由 index.webRoute 注入 URL。
// 授權已在 webRoute(core.portal)完成;此處只讀 webRoute 重算後的 budget/contract/scope,不再自檢 key。
export async function handleContractsRequest(req, res, pathname, url, deps) {
  const key = url.searchParams.get('key') || '';
  const canContract = url.searchParams.get('contract') === '1';
  const canBudget = url.searchParams.get('budget') === '1';
  const scope = parseScope(url);
  try {
    if (req.method === 'GET' && pathname === '/contracts') {
      res.writeHead(canContract ? 200 : 403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(canContract ? renderContractsPage(deps.tenantKey, key, canBudget) : renderDeniedPage());
    }
    if (!canContract) return sendJson(res, 403, { error: '無合約發包檢視權限' });

    if (req.method === 'GET' && pathname === '/contracts/api/overview') {
      return sendJson(res, 200, await buildOverview(deps, scope));
    }
    if (req.method === 'POST' && pathname === '/contracts/api/create') {
      return sendJson(res, 200, await createContract(deps, await readJsonBody(req), scope));
    }
    if (req.method === 'POST' && pathname === '/contracts/api/edit') {
      return sendJson(res, 200, await editContract(deps, await readJsonBody(req)));
    }
    if (req.method === 'POST' && pathname === '/contracts/api/archive') {
      return sendJson(res, 200, await archiveContract(deps, await readJsonBody(req)));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Contracts error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

async function buildOverview(deps, scope) {
  if (!deps.dataSources.contracts) throw new Error('發包合約資料庫尚未設定(<PREFIX>_CONTRACTS_DATA_SOURCE_ID)');
  const projectPages = await queryAll(deps, deps.dataSources.projects);
  const projects = [];
  for (const page of projectPages) {
    const p = page.properties;
    const code = plain(p['館別代碼']?.rich_text);
    if (scope && !scope.has(code)) continue;
    projects.push({ id: page.id, name: plain(p['專案名稱']?.title), code, status: p['狀態']?.select?.name || '' });
  }
  for (const project of projects) {
    // 可掛的預算項目(工程預算列;小項與總預算不列)
    const budgetItems = [];
    if (deps.dataSources.budgets) {
      const budgetPages = await queryAll(deps, deps.dataSources.budgets, { property: '專案', relation: { contains: project.id } });
      for (const b of budgetPages) {
        const bp = b.properties;
        if ((bp['類別']?.select?.name || '') !== '工程預算') continue;
        budgetItems.push({ id: b.id, name: plain(bp['預算項目']?.title), budget: bp['預算金額']?.number || 0 });
      }
    }
    const budgetNameById = new Map(budgetItems.map((b) => [b.id.replace(/-/g, ''), b.name]));
    // 群組(發包對象所在的 LINE 群組,討論記錄都在該群組的訊息裡)
    const groups = [];
    if (deps.dataSources.groupBindings) {
      const groupPages = await queryAll(deps, deps.dataSources.groupBindings, { property: '專案', relation: { contains: project.id } });
      for (const g of groupPages) {
        groups.push({ id: g.id, name: plain(g.properties['群組名稱']?.title) });
      }
    }
    const groupNameById = new Map(groups.map((g) => [g.id.replace(/-/g, ''), g.name]));

    const contractPages = await queryAll(deps, deps.dataSources.contracts, { property: '專案', relation: { contains: project.id } });
    const rows = [];
    for (const page of contractPages) {
      const p = page.properties;
      const budgetItemId = p['預算項目']?.relation?.[0]?.id || '';
      const groupId = p['負責群組']?.relation?.[0]?.id || '';
      rows.push({
        id: page.id,
        number: plain(p['編號']?.title),
        name: plain(p['合約名稱']?.rich_text),
        vendor: plain(p['承攬對象']?.rich_text),
        amount: p['合約金額']?.number || 0,
        status: p['狀態']?.select?.name || '洽談中',
        signDate: (p['簽約日期']?.date?.start || '').slice(0, 10),
        budgetItemId,
        budgetItemName: budgetItemId ? (budgetNameById.get(budgetItemId.replace(/-/g, '')) || '(已封存的預算項)') : '',
        groupId,
        groupName: groupId ? (groupNameById.get(groupId.replace(/-/g, '')) || '') : '',
        links: plain(p['資料連結']?.rich_text),
        note: plain(p['備註']?.rich_text),
        notionUrl: page.url,
      });
    }
    rows.sort((a, b) => (b.number || '').localeCompare(a.number || ''));
    project.rows = rows;
    project.budgetItems = budgetItems;
    project.groups = groups;
    project.committed = rows.filter((r) => COMMITTED_STATUSES.has(r.status)).reduce((sum, r) => sum + r.amount, 0);
    project.pending = rows.filter((r) => !COMMITTED_STATUSES.has(r.status) && r.status !== '作廢').length;
  }
  return { projects, statuses: STATUSES };
}

// 編號自動:<館別代碼>-CT-001(各租戶專案的館別代碼各自序號,不撞號)
async function nextNumber(deps, projectId) {
  const projectPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectId)}`, { method: 'GET' });
  const code = plain(projectPage.properties['館別代碼']?.rich_text) || 'XX';
  const existing = await queryAll(deps, deps.dataSources.contracts, { property: '專案', relation: { contains: projectId } });
  let max = 0;
  for (const page of existing) {
    const m = plain(page.properties['編號']?.title).match(/-CT-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${code}-CT-${String(max + 1).padStart(3, '0')}`;
}

function contractProperties(fields) {
  const props = {};
  if (fields.name !== undefined) props['合約名稱'] = { rich_text: textFrag(fields.name) };
  if (fields.vendor !== undefined) props['承攬對象'] = { rich_text: textFrag(fields.vendor) };
  if (fields.amount !== undefined) props['合約金額'] = { number: fields.amount === '' || fields.amount == null ? null : Number(fields.amount) };
  if (fields.status !== undefined) props['狀態'] = { select: fields.status ? { name: fields.status } : null };
  if (fields.signDate !== undefined) props['簽約日期'] = { date: fields.signDate ? { start: fields.signDate } : null };
  if (fields.budgetItem !== undefined) props['預算項目'] = { relation: fields.budgetItem ? [{ id: fields.budgetItem }] : [] };
  if (fields.group !== undefined) props['負責群組'] = { relation: fields.group ? [{ id: fields.group }] : [] };
  if (fields.links !== undefined) props['資料連結'] = { rich_text: textFrag(fields.links) };
  if (fields.note !== undefined) props['備註'] = { rich_text: textFrag(fields.note) };
  return props;
}

async function createContract(deps, { project, operator, ...fields }, scope) {
  if (!project) throw new Error('project required');
  await assertProjectInScope(deps, scope, project);
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error('狀態不合法');
  const number = await nextNumber(deps, project);
  const props = contractProperties(fields);
  props['編號'] = { title: textFrag(number) };
  props['專案'] = { relation: [{ id: project }] };
  const created = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: { parent: { type: 'data_source_id', data_source_id: deps.dataSources.contracts }, properties: props },
  });
  await appendLog(deps, created.id, '開立', operator, `${fields.name || number} 對象=${fields.vendor || '-'} 金額=${fields.amount || 0} 狀態=${fields.status || '洽談中'}`);
  if (fields.budgetItem) await syncBudgetItem(deps, fields.budgetItem, operator);
  return { ok: true, id: created.id, number };
}

async function editContract(deps, { page, operator, ...fields }) {
  if (!page) throw new Error('page required');
  const before = await assertContractPage(deps, page);
  const oldBudgetItem = before.properties['預算項目']?.relation?.[0]?.id || '';
  if (fields.status && !STATUSES.includes(fields.status)) throw new Error('狀態不合法');
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, {
    method: 'PATCH',
    body: { properties: contractProperties(fields) },
  });
  const detail = Object.entries(fields).map(([k, v]) => `${k}=${v === '' ? '(清空)' : v}`).join(' ');
  await appendLog(deps, page, '編輯', operator, detail);
  // 新舊掛的預算項目都要回寫(可能換掛)
  const touched = new Set([oldBudgetItem, fields.budgetItem !== undefined ? fields.budgetItem : oldBudgetItem].filter(Boolean));
  for (const id of touched) await syncBudgetItem(deps, id, operator);
  return { ok: true };
}

async function archiveContract(deps, { page, operator }) {
  if (!page) throw new Error('page required');
  const target = await assertContractPage(deps, page);
  const budgetItem = target.properties['預算項目']?.relation?.[0]?.id || '';
  const number = plain(target.properties['編號']?.title);
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(page)}`, { method: 'PATCH', body: { archived: true } });
  console.log(`Contract archived by ${operator || '合約頁'}: ${number} (${page})`);
  if (budgetItem) await syncBudgetItem(deps, budgetItem, operator);
  return { ok: true };
}

// 自動回寫預算控制:已發包金額=有效合約金額合計、發包對象=各合約對象、
// 發包日期=最早簽約日、狀態=未發包/部分發包/已發包
async function syncBudgetItem(deps, budgetItemId, operator) {
  if (!deps.dataSources.budgets) return;
  let budgetPage;
  try {
    budgetPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, { method: 'GET' });
  } catch { return; }
  if (!sameId(budgetPage.parent?.data_source_id, deps.dataSources.budgets)) return;

  const contracts = await queryAll(deps, deps.dataSources.contracts, { property: '預算項目', relation: { contains: budgetItemId } });
  // 依編號排序,讓發包對象的串接順序穩定
  contracts.sort((a, b) => plain(a.properties['編號']?.title).localeCompare(plain(b.properties['編號']?.title)));
  let committed = 0;
  const vendors = [];
  let earliest = '';
  for (const page of contracts) {
    const p = page.properties;
    if (!COMMITTED_STATUSES.has(p['狀態']?.select?.name || '')) continue;
    committed += p['合約金額']?.number || 0;
    const vendor = plain(p['承攬對象']?.rich_text);
    if (vendor && !vendors.includes(vendor)) vendors.push(vendor);
    const d = (p['簽約日期']?.date?.start || '').slice(0, 10);
    if (d && (!earliest || d < earliest)) earliest = d;
  }
  const budget = budgetPage.properties['預算金額']?.number || 0;
  const status = committed <= 0 ? '未發包' : (budget && committed >= budget ? '已發包' : '部分發包');
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, {
    method: 'PATCH',
    body: { properties: {
      '已發包金額': { number: committed },
      '發包對象': { rich_text: textFrag(vendors.join('、')) },
      '發包日期': { date: earliest ? { start: earliest } : null },
      '狀態': { select: { name: status } },
    } },
  });
  await appendLog(deps, budgetItemId, '同步', operator, `依發包合約回寫:已發包=${committed} 對象=${vendors.join('、') || '-'} 狀態=${status}`);
}

function renderDeniedPage() {
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合約發包管理</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;background:#f5f7f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#22302a}
div{background:#fff;border:1px solid #e0e6e3;border-radius:16px;padding:28px;text-align:center;max-width:320px}
h1{font-size:17px;color:#2e7d52;margin:0 0 10px}p{font-size:13px;color:#6b7a72;line-height:1.7;margin:0}a{color:#2e7d52}</style></head>
<body><div><h1>📑 合約發包管理</h1><p>這個頁面的權限與專案檢視分開,需要另外授權。<br>請洽 Seven 在 AM Portal 帳號管理勾選「合約發包管理」。<br><br><a href="/dashboard">← 回儀表板</a></p></div></body></html>`;
}

function renderContractsPage(tenantKey, key, canBudget) {
  const qs = (extra) => `?tenant=${encodeURIComponent(tenantKey)}&key=${encodeURIComponent(key)}${extra || ''}`;
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>合約發包管理</title>
<style>
  :root { --green:#2e7d52; --bg:#f5f7f6; --card:#fff; --line:#e0e6e3; --dim:#6b7a72; --red:#a03e33; --amber:#8a6d1a; --blue:#3a5db0; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif; background:var(--bg); color:#22302a; padding-bottom:60px; }
  header { background:var(--green); color:#fff; padding:12px 16px; display:flex; align-items:center; gap:14px; position:sticky; top:0; z-index:5; }
  header h1 { font-size:17px; }
  header a { margin-left:auto; color:#dff0e7; font-size:13px; text-decoration:none; }
  .tabs { display:flex; flex-wrap:wrap; gap:8px; padding:12px 12px 0; }
  .tab { background:var(--card); border:1px solid var(--line); border-radius:20px; padding:8px 16px; font-size:14px; cursor:pointer; }
  .tab.active { background:var(--green); color:#fff; border-color:var(--green); }
  .section { margin:12px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:12px; }
  .panel h3 { font-size:14px; color:var(--dim); margin-bottom:10px; }
  .stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:6px; }
  .stat b { font-size:19px; display:block; font-variant-numeric:tabular-nums; }
  .stat span { font-size:11px; color:var(--dim); }
  .btn { background:var(--green); color:#fff; border:none; border-radius:8px; padding:7px 14px; font-size:13px; cursor:pointer; }
  .btn.ghost { background:#eef2f0; color:#22302a; }
  .twrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
  table { border-collapse:collapse; background:var(--card); font-size:13px; width:100%; min-width:900px; }
  th,td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; white-space:nowrap; vertical-align:top; }
  th { background:#eef2f0; font-size:12px; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .st-洽談中 { color:#98a5a0; }
  .st-報價中 { color:var(--blue); font-weight:600; }
  .st-已簽約 { color:var(--amber); font-weight:600; }
  .st-施工中 { color:var(--amber); font-weight:600; }
  .st-已完工 { color:#1d6b41; font-weight:600; }
  .st-結案 { color:#1d6b41; font-weight:600; }
  .st-作廢 { color:var(--red); text-decoration:line-through; }
  .rowbtn { border:none; background:#eef2f0; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer; margin-left:4px; }
  input,select { border:1px solid var(--line); border-radius:6px; padding:6px 8px; font-size:13px; font-family:inherit; }
  input.money { width:130px; text-align:right; }
  .empty { color:var(--dim); padding:20px; text-align:center; font-size:13px; }
  .links a { display:block; font-size:12px; color:var(--green); max-width:180px; overflow:hidden; text-overflow:ellipsis; }
  .hint { font-size:11px; color:var(--dim); margin-top:8px; line-height:1.6; }
</style>
</head>
<body>
<header><h1>📑 合約發包管理</h1>${canBudget ? `<a href="/budget${qs()}">→ 💰 預算控制</a>` : ''}<a href="/dashboard${qs()}" style="${canBudget ? 'margin-left:14px' : ''}">→ 儀表板</a></header>
<div class="tabs" id="tabs"></div>
<div class="section" id="main"><div class="empty">載入中…</div></div>
<script>
const TENANT = ${JSON.stringify(tenantKey)};
const KEY = ${JSON.stringify(key)};
let DATA = null;
let CURRENT = null;
const OPERATOR = () => localStorage.getItem('queueOperator') || '合約頁';
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function money(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
function fmtNum(v) { const d = String(v ?? '').replace(/[^0-9]/g, ''); return d ? Number(d).toLocaleString('en-US') : ''; }
function unfmt(v) { return String(v || '').replace(/,/g, ''); }
const MONEY_ATTRS = 'type="text" inputmode="numeric" oninput="this.value=fmtNum(this.value)"';
async function api(path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/contracts/api/' + path + sep + 'tenant=' + encodeURIComponent(TENANT) + '&key=' + encodeURIComponent(KEY),
    body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
async function load(keepCurrent) {
  DATA = await api('overview');
  if (!keepCurrent || !DATA.projects.find(p => p.id === CURRENT)) {
    CURRENT = DATA.projects.length ? DATA.projects[0].id : null;
  }
  render();
}
function render() {
  document.getElementById('tabs').innerHTML = DATA.projects.map(p =>
    '<button class="tab' + (CURRENT === p.id ? ' active' : '') + '" onclick="pick(\\'' + p.id + '\\')">' + esc(p.name) + '(' + p.rows.length + ')</button>').join('');
  const main = document.getElementById('main');
  const p = DATA.projects.find(x => x.id === CURRENT);
  main.innerHTML = p ? renderProject(p) : '<div class="empty">沒有可看的專案</div>';
}
function pick(id) { CURRENT = id; render(); }
function linkify(s) {
  return String(s || '').split(/\\s+/).filter(Boolean).map(part =>
    /^https?:\\/\\//.test(part) ? '<a href="' + esc(part) + '" target="_blank">' + esc(part.replace(/^https?:\\/\\//, '').slice(0, 40)) + '…</a>' : esc(part)
  ).join(' ');
}
function renderProject(p) {
  const active = p.rows.filter(r => r.status !== '作廢');
  const stats = '<div class="stats">'
    + '<div class="stat"><b>' + active.length + '</b><span>合約數</span></div>'
    + '<div class="stat"><b>' + money(p.committed) + '</b><span>已發包金額(已簽約起算)</span></div>'
    + '<div class="stat"><b>' + p.pending + '</b><span>洽談/報價中</span></div>'
    + '</div>';
  const table = '<div class="twrap"><table>'
    + '<tr><th>編號</th><th>合約名稱</th><th>預算項目</th><th>承攬對象</th><th class="num">合約金額</th><th>狀態</th><th>簽約日期</th><th>群組</th><th>資料連結</th><th>備註</th><th></th></tr>'
    + '<tr id="new-row"><td colspan="11" style="text-align:center"><button class="btn ghost" onclick="showNewForm()">＋ 新增發包合約</button></td></tr>'
    + p.rows.map(r => rowHtml(r)).join('')
    + '</table></div>'
    + (p.rows.length ? '' : '<div class="empty">尚無合約,點上方「＋ 新增發包合約」開始</div>');
  return '<div class="panel"><h3>' + esc(p.name) + ':發包合約</h3>' + stats + table
    + '<div class="hint">・狀態進入「已簽約」後,合約金額會自動回寫預算控制的「已發包金額/發包對象/發包日期/狀態」;改金額、換狀態、封存也會重算。<br>'
    + '・合約文件/圖面/簽約資料:貼網址到「資料連結」,或點「開Notion頁」把檔案直接拖進該合約頁面;每次操作都會留歷程。<br>'
    + '・群組欄位掛上該工班的 LINE 群組後,群組裡的討論(已全數落庫)就能對得上這份合約。</div></div>';
}
function rowHtml(r) {
  return '<tr id="row-' + r.id + '">'
    + '<td><b>' + esc(r.number) + '</b></td><td style="white-space:normal;min-width:110px">' + esc(r.name) + '</td>'
    + '<td style="white-space:normal;min-width:100px">' + esc(r.budgetItemName) + '</td>'
    + '<td>' + esc(r.vendor) + '</td><td class="num">' + money(r.amount) + '</td>'
    + '<td class="st-' + esc(r.status) + '">' + esc(r.status) + '</td><td>' + esc(r.signDate) + '</td>'
    + '<td style="white-space:normal;min-width:90px;font-size:12px">' + esc(r.groupName) + '</td>'
    + '<td class="links">' + linkify(r.links) + '</td>'
    + '<td style="white-space:normal;min-width:100px;font-size:12px">' + esc(r.note) + '</td>'
    + '<td><button class="rowbtn" onclick="editForm(\\'' + r.id + '\\')">✏️ 編輯</button>'
    + '<a class="rowbtn" style="text-decoration:none;display:inline-block" href="' + esc(r.notionUrl) + '" target="_blank">開Notion頁</a>'
    + '<button class="rowbtn" onclick="archiveRow(\\'' + r.id + '\\', \\'' + esc(r.number) + '\\')">🗄 封存</button></td>'
    + '</tr>';
}
function selectHtml(id, options, value, blankLabel) {
  return '<select id="' + id + '">' + (blankLabel !== undefined ? '<option value="">' + esc(blankLabel) + '</option>' : '')
    + options.map(o => '<option value="' + esc(o.value ?? o) + '" ' + ((o.value ?? o) === value ? 'selected' : '') + '>' + esc(o.label ?? o) + '</option>').join('') + '</select>';
}
function formCells(r) {
  const p = DATA.projects.find(x => x.id === CURRENT);
  const budgetOpts = p.budgetItems.map(b => ({ value: b.id, label: b.name + '(' + money(b.budget) + ')' }));
  const groupOpts = p.groups.map(g => ({ value: g.id, label: g.name }));
  return '<td style="color:var(--dim)">' + (r.number ? esc(r.number) : '自動') + '</td>'
    + '<td><input id="f-name" value="' + esc(r.name || '') + '" style="width:130px" placeholder="例:鋁窗工程承攬"></td>'
    + '<td>' + selectHtml('f-budgetItem', budgetOpts, r.budgetItemId || '', '(不掛預算)') + '</td>'
    + '<td><input id="f-vendor" value="' + esc(r.vendor || '') + '" style="width:100px" placeholder="工班/廠商"></td>'
    + '<td class="num"><input id="f-amount" class="money" ' + MONEY_ATTRS + ' value="' + fmtNum(r.amount ?? '') + '"></td>'
    + '<td>' + selectHtml('f-status', DATA.statuses, r.status || '洽談中') + '</td>'
    + '<td><input id="f-signDate" type="date" value="' + esc(r.signDate || '') + '"></td>'
    + '<td>' + selectHtml('f-group', groupOpts, r.groupId || '', '(未掛群組)') + '</td>'
    + '<td><input id="f-links" value="' + esc(r.links || '') + '" style="width:150px" placeholder="合約/圖面網址,空格分隔"></td>'
    + '<td><input id="f-note" value="' + esc(r.note || '') + '" style="width:110px"></td>';
}
function readForm() {
  return {
    name: document.getElementById('f-name').value.trim(),
    budgetItem: document.getElementById('f-budgetItem').value,
    vendor: document.getElementById('f-vendor').value.trim(),
    amount: unfmt(document.getElementById('f-amount').value),
    status: document.getElementById('f-status').value,
    signDate: document.getElementById('f-signDate').value,
    group: document.getElementById('f-group').value,
    links: document.getElementById('f-links').value.trim(),
    note: document.getElementById('f-note').value.trim(),
    operator: OPERATOR(),
  };
}
function showNewForm() {
  document.getElementById('new-row').innerHTML = formCells({})
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="createContract()">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
function editForm(id) {
  const r = DATA.projects.find(p => p.id === CURRENT).rows.find(x => x.id === id);
  document.getElementById('row-' + id).innerHTML = formCells(r)
    + '<td><button class="rowbtn" style="background:var(--green);color:#fff" onclick="saveRow(\\'' + id + '\\')">存</button><button class="rowbtn" onclick="render()">取消</button></td>';
}
async function run(fn) { try { await fn(); await load(true); } catch (e) { alert(e.message); } }
async function createContract() { const f = readForm(); if (!f.name && !f.vendor) return alert('請至少填合約名稱或承攬對象'); await run(() => api('create', { project: CURRENT, ...f })); }
async function saveRow(id) { await run(() => api('edit', { page: id, ...readForm() })); }
async function archiveRow(id, number) {
  if (!confirm('確定封存合約「' + number + '」?已發包金額會同步重算(可在 Notion 垃圾桶找回)。')) return;
  await run(() => api('archive', { page: id, operator: OPERATOR() }));
}
load();
</script>
</body>
</html>`;
}

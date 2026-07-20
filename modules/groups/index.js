// AM Platform groups — 租戶群組治理後臺
//
// Core/router.js 只負責解析與快取；本模組提供人可編輯的介面。
// 每一個請求都用 route 的 tenant + tenantKey 鎖住 Notion，不能用 ?tenant 讀寫別的租戶資料。

import { readBody, sendJson } from '../../core/util.js';
import {
  GROUP_CAPABILITIES as CAPABILITIES,
  GROUP_STATUS_UPDATE_POLICIES as STATUS_POLICIES,
  GROUP_BINDING_V2_REQUIRED_FIELDS as REQUIRED_FIELDS,
} from '../../core/group-binding-schema.js';

const schemaCache = new Map();
let platformRef = null;

const plain = (prop, kind = 'rich_text') => (prop?.[kind] || []).map((x) => x.plain_text || x.text?.content || '').join('');
const select = (prop) => prop?.select?.name || '';
const many = (prop) => (prop?.multi_select || []).map((x) => x.name).filter(Boolean);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (value) => value ? [{ type: 'text', text: { content: String(value).slice(0, 1900) } }] : [];

function pageModel(page) {
  const p = page.properties || {};
  let members = {};
  try { members = JSON.parse(plain(p['成員對照'])) || {}; } catch {}
  if (!members || Array.isArray(members) || typeof members !== 'object') members = {};
  const memberNames = Object.keys(members).filter((name) => members[name]).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return {
    id: page.id,
    name: plain(p['群組名稱'], 'title'),
    groupId: plain(p['LINE 群組 ID']),
    status: select(p['狀態']),
    role: select(p['群組角色']),
    purpose: plain(p['群組用途']),
    owner: plain(p['主要負責人']) || plain(p['我方主管']) || plain(p['對方主管']),
    capabilities: many(p['啟用功能']),
    goal: plain(p['所屬目標']),
    statusUpdatePolicy: select(p['狀態更新權限']),
    reminderTargets: plain(p['預設提醒對象']),
    memberNames,
    memberCount: memberNames.length,
    editedAt: p['最後設定時間']?.date?.start || '',
    editedBy: plain(p['最後設定者']),
  };
}

function actorName(user) {
  if (!user) return 'Portal 使用者';
  return String(user.name || user.displayName || user.email || user.id || 'Portal 管理者').slice(0, 120);
}

async function authorize(req, tenant, portal, provided = null) {
  if (provided) return provided;
  if (typeof portal?.resolveAccess === 'function') return portal.resolveAccess(req, tenant);
  const user = await portal?.userAuthed?.(req, tenant);
  const allowed = Boolean(user && (typeof portal?.tenantAuthorized === 'function'
    ? portal.tenantAuthorized(user, tenant)
    : true));
  return {
    allowed,
    actor: actorName(user),
    isTenantAll: allowed,
    can: () => allowed,
    assert: () => { if (!allowed) throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); },
    filterBindings: (rows) => allowed ? rows : [],
  };
}

function missingSchemaFields(schema) {
  return REQUIRED_FIELDS.filter((name) => !schema?.properties?.[name]);
}

async function schemaFor(tenant, force = false) {
  const cached = schemaCache.get(tenant.key);
  if (!force && cached && Date.now() - cached.at < 60 * 1000) return cached.schema;
  const schema = await platformRef.notionRequest(`/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}`, {
    method: 'GET', tenantKey: tenant.key,
  });
  schemaCache.set(tenant.key, { schema, at: Date.now() });
  return schema;
}

async function listBindings(tenant) {
  const rows = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;
    const result = await platformRef.notionRequest(`/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}/query`, {
      method: 'POST', tenantKey: tenant.key, body,
    });
    rows.push(...(result.results || []).map(pageModel));
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return rows;
}

function renderUnauthorized(tenant) {
  return `<!doctype html><meta charset="utf-8"><title>需要登入</title><main style="font-family:system-ui;margin:48px"><h2>需要 ${esc(tenant?.displayName || '此租戶')} 的後臺權限</h2><p><a href="/?tenant=${encodeURIComponent(tenant?.key || '')}">回到平台登入</a></p></main>`;
}

function renderAdmin(tenant) {
  const key = encodeURIComponent(tenant.key);
  const cards = [
    ['群組設定', '設定每個 LINE 群的用途、負責人與啟用功能。', `/groups?tenant=${key}`],
    ...(tenant.modules.includes('queue') ? [['確認佇列', '確認系統整理出的訊息與待辦。', `/queue?tenant=${key}`]] : []),
    ...(tenant.modules.includes('tasks') ? [['待辦案件', '查看尚未完成的案件與追蹤項目。', `/tasks?tenant=${key}`]] : []),
  ];
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tenant.displayName)}｜AM Platform</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;margin:0;background:#f5f7f6;color:#203128}main{max-width:980px;margin:0 auto;padding:38px 20px}h1{margin:0;font-size:28px}.sub{color:#617167;margin:8px 0 26px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card{display:block;color:inherit;text-decoration:none;background:#fff;border:1px solid #dce6e0;border-radius:15px;padding:20px;box-shadow:0 5px 18px #1b40200b}.card:hover{border-color:#2e7d52}.card b{font-size:17px;color:#1d633d}.card p{font-size:14px;line-height:1.55;color:#66756d;margin:9px 0 0}.note{margin-top:26px;padding:14px 16px;background:#edf7f0;border-radius:10px;font-size:14px;color:#396048}</style></head><body><main>
<h1>🐌 ${esc(tenant.displayName)} AM</h1><p class="sub">AM Platform 專案後臺</p><section class="grid">${cards.map(([title, detail, href]) => `<a class="card" href="${href}"><b>${esc(title)}</b><p>${esc(detail)}</p></a>`).join('')}</section>
<p class="note">所有設定都只會讀寫「${esc(tenant.displayName)}」自己的資料表，不會跨到其他租戶。</p>
</main></body></html>`;
}

function input(field, value, placeholder = '') {
  return `<input data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
}
function selectInput(field, value, options) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return `<select data-field="${field}">${list.map((option) => `<option value="${esc(option)}"${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
}
function splitNames(value) {
  return String(value || '').split(/[、,，\n]/).map((name) => name.trim()).filter(Boolean);
}
function memberSelect(field, value, members, { multiple = false, placeholder = '請選擇群組成員' } = {}) {
  const selected = new Set(multiple ? splitNames(value) : [String(value || '').trim()]);
  const available = [...members];
  for (const name of selected) if (name && !available.includes(name)) available.unshift(name);
  const noMembers = available.length === 0;
  const options = [
    !multiple ? `<option value="">${esc(noMembers ? '請先同步群組成員' : placeholder)}</option>` : '',
    ...available.map((name) => `<option value="${esc(name)}"${selected.has(name) ? ' selected' : ''}>${esc(name)}</option>`),
  ].join('');
  return `<select data-field="${field}"${multiple ? ' multiple size="4"' : ''}${noMembers ? ' disabled' : ''}>${options}</select>`;
}
function renderRow(row, disabled, canCore) {
  const memberControlsDisabled = disabled || !row.groupId;
  return `<tr data-page-id="${esc(row.id)}" data-group-id="${esc(row.groupId)}">
<td>${input('name', row.name, '群組名稱')}<small>${esc(row.groupId || '尚未取得 LINE 群組 ID')}</small></td>
<td>${input('purpose', row.purpose, '這個群主要處理什麼？')}</td>
<td>${memberSelect('owner', row.owner, row.memberNames)}<small>從此群成員中選擇。</small></td>
<td>${canCore ? input('capabilities', row.capabilities.join('、'), '待辦、案件狀態') : `<span>${esc(row.capabilities.join('、') || '未設定')}</span><small>核心功能由租戶全群組管理者設定。</small>`}</td>
<td>${input('goal', row.goal, '所屬專案或目標')}</td>
<td>${selectInput('statusUpdatePolicy', row.statusUpdatePolicy || STATUS_POLICIES[0], STATUS_POLICIES)}${memberSelect('reminderTargets', row.reminderTargets, row.memberNames, { multiple: true })}<small>可複選提醒對象。</small></td>
<td>${canCore ? selectInput('status', row.status || '影子記錄', ['啟用', '影子記錄', '停用']) : `<span>${esc(row.status || '停用')}</span>`}<small>角色：${esc(row.role || '未設定')}<br>成員對照：${row.memberCount} 人</small></td>
<td><button type="button" class="sync-members"${memberControlsDisabled ? ' disabled' : ''}>同步成員</button><button type="button" class="save"${disabled ? ' disabled' : ''}>儲存</button><small class="result">${esc(row.editedAt ? `最近設定：${row.editedAt}` : '')}</small></td></tr>`;
}

function renderGroups(tenant, rows, missing, access) {
  const disabled = missing.length > 0;
  const key = encodeURIComponent(tenant.key);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>群組設定｜${esc(tenant.displayName)}</title>
<style>body{font-family:system-ui,'Noto Sans TC',sans-serif;margin:0;background:#f5f7f6;color:#22302a}main{max-width:1560px;margin:auto;padding:25px 18px}a{color:#246d46}h1{font-size:25px;margin:0}.sub{margin:7px 0 16px;color:#65756c}.notice{padding:12px 14px;border-radius:9px;margin:12px 0;background:#fff4e6;color:#88520a}.ok{padding:12px 14px;border-radius:9px;margin:12px 0;background:#edf7f0;color:#2d6541}.wrap{overflow:auto;background:#fff;border:1px solid #dce5df;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:1350px}th,td{border-bottom:1px solid #e6ece8;vertical-align:top;padding:10px;text-align:left;font-size:13px}th{position:sticky;top:0;background:#eff5f1;color:#456054;white-space:nowrap}input,select{box-sizing:border-box;width:100%;padding:7px;border:1px solid #cfdad4;border-radius:6px;background:#fff;font:inherit}input:focus,select:focus{outline:2px solid #a8d3b6;border-color:#4b9b68}small{display:block;color:#77867d;font-size:11px;line-height:1.45;margin-top:5px}.save{border:0;border-radius:7px;padding:8px 11px;background:#2d7b4e;color:#fff;font-weight:700;cursor:pointer}.save:disabled{background:#aebbb3;cursor:not-allowed}.result.ok{padding:0;background:transparent;color:#267347}.result.err{padding:0;background:transparent;color:#a23d32}</style></head><body><main>
<p><a href="/admin?tenant=${key}">← ${esc(tenant.displayName)} 後臺</a></p><h1>LINE 群組設定</h1><p class="sub">設定會立即影響這個租戶的群組路由與功能；請先按「同步成員」，再從下拉選單精準選擇主要負責人與提醒對象。</p>
${disabled ? `<p class="notice">此租戶的群組表尚缺少欄位：${esc(missing.join('、'))}。請先套用群組綁定 v2 結構，避免用不完整資料開始管理。</p>` : '<p class="ok">群組綁定 v2 已就緒。每次儲存後，群組路由快取會立即更新。</p>'}
<div class="wrap"><table><thead><tr><th>群組</th><th>用途</th><th>主要負責人</th><th>啟用功能<br><small>以「、」分隔</small></th><th>所屬目標</th><th>案件狀態／提醒</th><th>啟用狀態</th><th></th></tr></thead><tbody>${rows.map((row) => renderRow(row, disabled, Boolean(access?.isTenantAll))).join('') || '<tr><td colspan="8">目前帳號沒有可管理的啟用群組。</td></tr>'}</tbody></table></div>
</main><script>
const tenant=${JSON.stringify(tenant.key)};
function valuesFor(row){const values={};row.querySelectorAll('[data-field]').forEach(el=>{values[el.dataset.field]=el.multiple?[...el.selectedOptions].map(o=>o.value).filter(Boolean).join('、'):el.value;});return values;}
for(const button of document.querySelectorAll('.save'))button.addEventListener('click',async()=>{const row=button.closest('tr'),result=row.querySelector('.result'),values=valuesFor(row);button.disabled=true;result.className='result';result.textContent='儲存中…';try{const r=await fetch('/groups/api/update?tenant='+encodeURIComponent(tenant),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId:row.dataset.pageId,...values})});const j=await r.json();if(!r.ok)throw Error(j.error||'儲存失敗');result.className='result ok';result.textContent='已儲存，設定已生效。'}catch(e){result.className='result err';result.textContent=e.message||'儲存失敗';}finally{button.disabled=false;}});
for(const button of document.querySelectorAll('.sync-members'))button.addEventListener('click',async()=>{const row=button.closest('tr'),result=row.querySelector('.result');button.disabled=true;result.className='result';result.textContent='同步群組成員中…';try{const r=await fetch('/groups/api/sync-members?tenant='+encodeURIComponent(tenant),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId:row.dataset.pageId})});const j=await r.json();if(!r.ok)throw Error(j.error||'同步失敗');result.className='result ok';result.textContent='已同步 '+j.memberCount+' 位成員，重新載入選單…';setTimeout(()=>location.reload(),400);}catch(e){result.className='result err';result.textContent=e.message||'同步失敗';button.disabled=false;}});
</script></body></html>`;
}

function normaliseCapabilities(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[、，,]/);
  const result = [...new Set(values.map((x) => String(x).trim()).filter(Boolean))];
  const invalid = result.filter((x) => !CAPABILITIES.includes(x));
  if (invalid.length) throw new Error(`未知功能：${invalid.join('、')}。可用功能：${CAPABILITIES.join('、')}`);
  return result;
}

function updateProperties(body, schema, actor) {
  const props = {};
  const add = (name, value) => { if (schema.properties?.[name]) props[name] = value; };
  const name = String(body.name || '').trim();
  if (!name) throw new Error('群組名稱不可空白。');
  add('群組名稱', { title: text(name) });
  add('群組用途', { rich_text: text(String(body.purpose || '').trim()) });
  add('主要負責人', { rich_text: text(String(body.owner || '').trim()) });
  if (Object.prototype.hasOwnProperty.call(body, 'capabilities')) {
    add('啟用功能', { multi_select: normaliseCapabilities(body.capabilities).map((name) => ({ name })) });
  }
  add('所屬目標', { rich_text: text(String(body.goal || '').trim()) });
  const policy = String(body.statusUpdatePolicy || '').trim();
  if (!STATUS_POLICIES.includes(policy)) throw new Error('案件狀態更新權限不正確。');
  add('狀態更新權限', { select: { name: policy } });
  add('預設提醒對象', { rich_text: text(String(body.reminderTargets || '').trim()) });
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status || '').trim();
    if (!['啟用', '影子記錄', '停用'].includes(status)) throw new Error('群組狀態只能是啟用、影子記錄或停用。');
    add('狀態', { select: { name: status } });
  }
  add('最後設定時間', { date: { start: new Date().toISOString() } });
  add('最後設定者', { rich_text: text(actor) });
  return props;
}

function memberMapFromProfiles(profiles) {
  const counts = new Map();
  for (const profile of profiles) counts.set(profile.name, (counts.get(profile.name) || 0) + 1);
  const members = {};
  for (const { name, userId } of profiles) {
    const uniqueName = counts.get(name) > 1 ? `${name}（${userId.slice(-6)}）` : name;
    members[uniqueName] = userId;
  }
  return members;
}

async function syncMembers(tenant, pageId) {
  // 先在本租戶的資料源內定位頁面，不接受前端任意 groupId，避免跨租戶讀取群組資訊。
  const binding = (await listBindings(tenant)).find((row) => row.id === pageId);
  if (!binding) throw new Error('找不到此租戶的群組綁定，無法同步成員。');
  if (!binding.groupId) throw new Error('此群尚未取得 LINE 群組 ID。');
  if (typeof platformRef.listGroupMemberIds !== 'function' || typeof platformRef.resolveGroupMemberName !== 'function') {
    throw new Error('LINE 成員同步尚未設定。');
  }
  const ids = await platformRef.listGroupMemberIds(binding.groupId);
  const profiles = await Promise.all(ids.map(async (userId) => ({
    userId,
    name: String(await platformRef.resolveGroupMemberName(binding.groupId, userId) || 'LINE 使用者').trim() || 'LINE 使用者',
  })));
  const members = memberMapFromProfiles(profiles);
  await platformRef.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH', tenantKey: tenant.key,
    body: { properties: { '成員對照': { rich_text: text(JSON.stringify(members)) } } },
  });
  platformRef.router?.invalidate?.(binding.groupId);
  return Object.keys(members).length;
}

async function handleGroups(req, res, rctx) {
  const { tenant, portal, pathname } = rctx;
  if (!tenant?.dataSources?.groupBindings) return sendJson(res, 404, { error: '此租戶未設定群組綁定資料表。' });
  const access = await authorize(req, tenant, portal, rctx.access);
  if (!access.allowed) {
    if (pathname === '/groups') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(renderUnauthorized(tenant));
    }
    return sendJson(res, 401, { error: '需要此租戶的後臺權限。' });
  }
  try {
    const schema = await schemaFor(tenant);
    const missing = missingSchemaFields(schema);
    if (pathname === '/groups' && req.method === 'GET') {
      const rows = access.filterBindings(await listBindings(tenant), 'groups.read');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(renderGroups(tenant, rows, missing, access));
    }
    if (pathname === '/groups/api/list' && req.method === 'GET') {
      return sendJson(res, 200, { tenant: tenant.key, rows: access.filterBindings(await listBindings(tenant), 'groups.read'), missingSchemaFields: missing });
    }
    if (pathname === '/groups/api/update' && req.method === 'POST') {
      if (missing.length) return sendJson(res, 409, { error: `群組表尚缺少欄位：${missing.join('、')}` });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: '資料格式不正確。' }); }
      const pageId = String(body?.pageId || '').trim();
      if (!pageId) return sendJson(res, 400, { error: '缺少群組綁定頁識別。' });
      const binding = (await listBindings(tenant)).find((row) => row.id === pageId);
      if (!binding) return sendJson(res, 404, { error: '找不到群組綁定。' });
      access.assert('groups.edit', binding.id, { status: binding.status });
      if (!access.isTenantAll && (Object.prototype.hasOwnProperty.call(body, 'capabilities') || Object.prototype.hasOwnProperty.call(body, 'status'))) {
        return sendJson(res, 403, { error: '此帳號只能修改群組營運設定，不能停用群組或變更啟用功能。' });
      }
      const props = updateProperties(body, schema, access.actor);
      await platformRef.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, {
        method: 'PATCH', tenantKey: tenant.key, body: { properties: props },
      });
      schemaCache.delete(tenant.key);
      // 不信任瀏覽器傳入的 LINE groupId；使用剛從本租戶綁定表重讀的值即時清除路由快取。
      platformRef.router?.invalidate?.(binding.groupId);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/groups/api/sync-members' && req.method === 'POST') {
      if (missing.length) return sendJson(res, 409, { error: `群組表尚缺少欄位：${missing.join('、')}` });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: '資料格式不正確。' }); }
      const pageId = String(body?.pageId || '').trim();
      if (!pageId) return sendJson(res, 400, { error: '缺少群組綁定頁識別。' });
      const binding = (await listBindings(tenant)).find((row) => row.id === pageId);
      if (!binding) return sendJson(res, 404, { error: '找不到群組綁定。' });
      access.assert('groups.edit', binding.id, { status: binding.status });
      const memberCount = await syncMembers(tenant, pageId);
      return sendJson(res, 200, { ok: true, memberCount });
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    platformRef.logger?.warn?.(`Groups admin failed (tenant=${tenant.key}): ${error.message}`);
    return sendJson(res, error.statusCode || 500, { error: error.message || '群組設定處理失敗。' });
  }
}

async function handleAdmin(req, res, rctx) {
  const { tenant, portal } = rctx;
  const access = await authorize(req, tenant, portal, rctx.access);
  if (!access.allowed) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(renderUnauthorized(tenant));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(renderAdmin(tenant));
}

export default {
  name: 'groups',
  init(platform) { platformRef = platform; },
  routes: [
    { prefix: '/admin', method: 'GET', access: { kind: 'group', capability: 'tenant.read' }, handler: handleAdmin },
    { prefix: '/groups', access: { kind: 'group', capability: 'groups.manage' }, handler: handleGroups },
  ],
};

export const __test = { normaliseCapabilities, pageModel, missingSchemaFields, updateProperties, memberMapFromProfiles };

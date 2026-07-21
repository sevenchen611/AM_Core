// AM Platform meetings — tenant/group rollout administration page.
//
// This file deliberately owns no tenant identifiers or credentials. Every
// Notion request uses the tenant selected and authorised by server.js, and the
// configured groupBindings data source (never a browser supplied source id).

import { readBody, sendJson } from '../../core/util.js';
import {
  MEETING_MODE_OPTIONS,
  MEETING_ROLLOUT_MODES,
  meetingModeLabel,
  meetingModeLevel,
  normalizeMeetingMode,
  resolveMeetingRolloutPolicy,
  tenantMeetingModeCeiling,
} from './policy.js';

export const MEETING_ADMIN_SCHEMA_VERSION = 'AM-MEETING-ROLLOUT-2026.0721.01';
export const MEETING_ADMIN_PROPERTIES = Object.freeze({
  '會議待辦模式': Object.freeze({
    select: { options: MEETING_MODE_OPTIONS.map(({ label }) => ({ name: label })) },
  }),
  '會議導入檢查': Object.freeze({
    select: { options: ['Ready', 'Warning', 'Blocked'].map((name) => ({ name })) },
  }),
  '會議檢查說明': Object.freeze({ rich_text: {} }),
  '會議設定版本': Object.freeze({ rich_text: {} }),
  '會議最後檢查時間': Object.freeze({ date: {} }),
});

const MEETING_ADMIN_FIELDS = Object.freeze(Object.keys(MEETING_ADMIN_PROPERTIES));
const REQUIRED_EXISTING_FIELDS = Object.freeze(['群組名稱', 'LINE 群組 ID', '狀態', '啟用功能']);
const schemaCache = new WeakMap();
const controllerCache = new WeakMap();

const clean = (value) => String(value ?? '').trim();
const plain = (prop, kind = 'rich_text') => (prop?.[kind] || [])
  .map((item) => item.plain_text || item.text?.content || '')
  .join('');
const selected = (prop) => prop?.select?.name || '';
const selectedMany = (prop) => (prop?.multi_select || []).map((item) => item.name).filter(Boolean);
const notionId = (value) => clean(value).replace(/-/g, '').toLowerCase();
const textItems = (value) => clean(value)
  ? [{ type: 'text', text: { content: clean(value).slice(0, 1900) } }]
  : [];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function publicError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function clientError(error) {
  if (error?.expose) return { status: error.statusCode || 400, message: error.message };
  if (error?.statusCode === 403) return { status: 403, message: '您沒有變更此會議設定的權限。' };
  if (error?.statusCode === 404) return { status: 404, message: '找不到可存取的群組設定。' };
  return { status: 500, message: '會議功能管理處理失敗，請稍後再試。' };
}

function assertTenantContext(tenant, tenants = []) {
  if (!tenant?.key || !(tenant.modules || []).includes('meetings')) {
    throw publicError(404, '此租戶尚未安裝會議功能。');
  }
  if (Array.isArray(tenants) && tenants.length) {
    const registered = tenants.find((item) => item === tenant || item?.key === tenant.key);
    if (!registered) throw publicError(404, '找不到已登記的租戶。');
  }
  if (!tenant.dataSources?.groupBindings) {
    throw publicError(409, '此租戶尚未設定群組綁定資料表。');
  }
  return tenant;
}

function assertTenantDataSource(tenant, schema) {
  const configured = notionId(tenant?.dataSources?.groupBindings);
  if (!configured) throw publicError(409, '此租戶尚未設定群組綁定資料表。');
  // Core already guards tenantKey. This second check prevents a malformed or
  // mocked response from being accepted as the selected tenant's data source.
  if (schema?.id && notionId(schema.id) !== configured) {
    throw publicError(409, '群組資料表的租戶驗證失敗，系統已拒絕寫入。');
  }
}

function pageModel(page) {
  const properties = page?.properties || {};
  let members = {};
  try { members = JSON.parse(plain(properties['成員對照'])) || {}; } catch {}
  if (!members || Array.isArray(members) || typeof members !== 'object') members = {};
  return {
    id: clean(page?.id),
    name: plain(properties['群組名稱'], 'title') || '未命名群組',
    groupId: plain(properties['LINE 群組 ID']),
    status: selected(properties['狀態']) || '停用',
    role: selected(properties['群組角色']),
    capabilities: selectedMany(properties['啟用功能']),
    memberCount: Object.entries(members).filter(([name, userId]) => clean(name) && clean(userId)).length,
    meetingMode: normalizeMeetingMode(selected(properties['會議待辦模式'])),
    storedPreflight: selected(properties['會議導入檢查']),
    storedPreflightNote: plain(properties['會議檢查說明']),
    settingsVersion: plain(properties['會議設定版本']),
    checkedAt: properties['會議最後檢查時間']?.date?.start || '',
  };
}

function safeExistingOptions(options = []) {
  return options
    .filter((option) => clean(option?.name))
    .map((option) => ({
      name: clean(option.name),
      ...(clean(option.color) ? { color: clean(option.color) } : {}),
    }));
}

function meetingAdminSchemaPatch(properties = {}) {
  const patch = {};
  for (const [name, definition] of Object.entries(MEETING_ADMIN_PROPERTIES)) {
    const expectedType = Object.keys(definition)[0];
    const existing = properties[name];
    if (!existing) {
      patch[name] = definition;
      continue;
    }
    if (existing.type && existing.type !== expectedType) {
      throw publicError(409, `欄位「${name}」型別不正確，請先人工確認，系統不會覆寫。`);
    }
    if (expectedType !== 'select') continue;
    const current = safeExistingOptions(existing.select?.options || []);
    const names = new Set(current.map((option) => option.name));
    const additions = (definition.select?.options || []).filter((option) => !names.has(option.name));
    if (additions.length) patch[name] = { select: { options: [...current, ...additions] } };
  }
  return patch;
}

function missingSchemaFields(schema) {
  const properties = schema?.properties || {};
  return [...REQUIRED_EXISTING_FIELDS, ...MEETING_ADMIN_FIELDS].filter((name) => !properties[name]);
}

function cacheFor(platform) {
  let cache = schemaCache.get(platform);
  if (!cache) {
    cache = new Map();
    schemaCache.set(platform, cache);
  }
  return cache;
}

async function schemaFor(platform, tenant, force = false) {
  const cache = cacheFor(platform);
  const cached = cache.get(tenant.key);
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.value;
  const value = await platform.notionRequest(
    `/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}`,
    { method: 'GET', tenantKey: tenant.key },
  );
  assertTenantDataSource(tenant, value);
  cache.set(tenant.key, { value, at: Date.now() });
  return value;
}

async function listBindings(platform, tenant) {
  const rows = [];
  let cursor;
  do {
    const body = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (cursor) body.start_cursor = cursor;
    const response = await platform.notionRequest(
      `/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}/query`,
      { method: 'POST', tenantKey: tenant.key, body },
    );
    rows.push(...(response.results || []).map(pageModel));
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);
  return rows;
}

function adjustedBinding(binding, mode, { preview = false } = {}) {
  const normalized = normalizeMeetingMode(mode);
  const capabilities = new Set(binding.capabilities || []);
  if (normalized === MEETING_ROLLOUT_MODES.OFF) capabilities.delete('會議');
  else if (normalized) capabilities.add('會議');
  return {
    ...binding,
    meetingMode: normalized || binding.meetingMode,
    capabilities: [...capabilities],
    preview,
  };
}

function readinessSignals(platform, tenant) {
  const ai = platform.aiForTenant?.(tenant) || {};
  const llm = platform.llmForTenant?.(tenant) || platform.llm || {};
  const publicBaseUrl = platform.publicBaseUrlForTenant?.(tenant) || platform.publicBaseUrl || '';
  return {
    meetingsModule: tenant.runtimeEnabled !== false && (tenant.modules || []).includes('meetings'),
    notion: Boolean(tenant.notionConfigured && tenant.dataSources?.groupBindings),
    meetingStorage: Boolean(tenant.meetingsParentPageId || tenant.dataSources?.meetings),
    transcription: Boolean(ai.assemblyKey || ai.geminiKey),
    summarization: Boolean(llm.available),
    publicReviewUrl: Boolean(clean(publicBaseUrl) && clean(platform.publicLinkSecret)),
    liff: Boolean(clean(tenant.config?.meetings?.liffId)),
    tasks: Boolean(tenant.dataSources?.tasks),
    drive: Boolean(tenant.driveConfigured || platform.driveConfigured),
    line: platform.lineConfigured !== false && typeof platform.pushLineMessage === 'function',
  };
}

function issue(level, code, message) {
  return Object.freeze({ level, code, message });
}

function preflightBinding(platform, tenant, originalBinding, requestedMode) {
  const hasPreview = requestedMode !== undefined;
  const normalized = hasPreview ? normalizeMeetingMode(requestedMode) : '';
  if (hasPreview && !normalized) throw publicError(400, '會議待辦模式不正確。');
  const binding = hasPreview ? adjustedBinding(originalBinding, normalized, { preview: true }) : originalBinding;
  const policy = resolveMeetingRolloutPolicy({
    tenant,
    binding,
    ...(hasPreview ? { requestedMode: normalized } : {}),
  });
  const signals = readinessSignals(platform, tenant);
  const issues = [];

  if (policy.requestedMode === MEETING_ROLLOUT_MODES.OFF) {
    return {
      status: 'Ready',
      requestedMode: policy.requestedMode,
      effectiveMode: policy.effectiveMode,
      issues,
      signals,
      policy,
    };
  }

  if (!signals.meetingsModule) issues.push(issue('blocked', 'meetings_module', '此租戶尚未啟用會議模組。'));
  if (!signals.notion) issues.push(issue('blocked', 'notion', '此租戶的 Notion 群組資料尚未就緒。'));
  if (!signals.meetingStorage) issues.push(issue('blocked', 'meeting_storage', '尚未設定會議記錄儲存位置。'));
  if (!signals.transcription) issues.push(issue('blocked', 'transcription', '尚未設定可用的語音轉文字服務。'));
  if (!signals.summarization) issues.push(issue('blocked', 'summarization', '尚未設定可用的 AI 會議整理服務。'));
  if (!signals.line) issues.push(issue('blocked', 'line', 'LINE 群組通知功能尚未就緒。'));
  if (!clean(binding.groupId)) issues.push(issue('blocked', 'group_id', '此群尚未取得 LINE 群組識別。'));
  if (binding.status === '停用') issues.push(issue('blocked', 'binding_disabled', '此群目前是停用狀態。'));
  if (!(binding.capabilities || []).includes('會議')) {
    issues.push(issue('blocked', 'capability', '此群尚未啟用「會議」功能。'));
  }
  if (policy.reasons.includes('tenant_ceiling')) {
    issues.push(issue('blocked', 'tenant_ceiling', `此租戶目前最高只允許「${policy.ceilingLabel}」。`));
  }
  if (policy.reasons.includes('shadow_binding')) {
    issues.push(issue('blocked', 'shadow_binding', '影子記錄群只能保留會議記錄，不會開啟確認或建立正式任務。'));
  }

  if (policy.review) {
    if (!signals.publicReviewUrl) issues.push(issue('blocked', 'review_url', '尚未設定安全的待辦確認連結。'));
    if (!signals.liff) issues.push(issue('blocked', 'liff', '此租戶所屬租戶尚未設定 LIFF 身分驗證。'));
    if (Number(binding.memberCount || 0) < 1) issues.push(issue('blocked', 'members', '請先同步群組成員，才能選擇與驗證負責人。'));
  }
  if (policy.createFormalTasks && !signals.tasks) {
    issues.push(issue('blocked', 'tasks', '此租戶所屬租戶尚未設定正式待辦資料表。'));
  }

  if (!signals.drive) issues.push(issue('warning', 'drive', '錄音雲端留底尚未就緒，會議處理仍可執行。'));
  if (!signals.publicReviewUrl && policy.effectiveMode === MEETING_ROLLOUT_MODES.RECORD_ONLY) {
    issues.push(issue('warning', 'public_url', '尚未設定免登入的公開會議連結。'));
  }

  const status = issues.some((item) => item.level === 'blocked')
    ? 'Blocked'
    : issues.some((item) => item.level === 'warning') ? 'Warning' : 'Ready';
  return {
    status,
    requestedMode: policy.requestedMode,
    effectiveMode: policy.effectiveMode,
    issues,
    signals,
    policy,
  };
}

function preflightNote(preflight) {
  const detail = preflight.issues.map((item) => item.message).join('、');
  return (detail || '導入條件已就緒。').slice(0, 1800);
}

function publicRow(row, preflight) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    role: row.role,
    memberCount: row.memberCount,
    requestedMode: preflight.requestedMode,
    requestedLabel: meetingModeLabel(preflight.requestedMode),
    effectiveMode: preflight.effectiveMode,
    effectiveLabel: meetingModeLabel(preflight.effectiveMode),
    legacy: preflight.policy.legacy,
    preflight: preflight.status,
    issues: preflight.issues.map(({ level, code, message }) => ({ level, code, message })),
    checkedAt: row.checkedAt,
    settingsVersion: row.settingsVersion,
  };
}

function parseUpdates(body) {
  let updates = [];
  if (Array.isArray(body?.updates)) {
    updates = body.updates.map((item) => ({ pageId: clean(item?.pageId), mode: normalizeMeetingMode(item?.mode) }));
  } else if (Array.isArray(body?.pageIds)) {
    const mode = normalizeMeetingMode(body?.mode);
    updates = body.pageIds.map((pageId) => ({ pageId: clean(pageId), mode }));
  }
  if (!updates.length) throw publicError(400, '請先勾選要套用的群組。');
  if (updates.length > 100) throw publicError(400, '單次最多可變更 100 個群組。');
  const seen = new Set();
  for (const update of updates) {
    if (!update.pageId || !update.mode) throw publicError(400, '群組識別或會議模式不正確。');
    const key = notionId(update.pageId);
    if (seen.has(key)) throw publicError(400, '批次中有重複的群組。');
    seen.add(key);
  }
  return updates;
}

function assertTenantAll(access) {
  if (!access?.allowed) throw publicError(401, '請先登入 AM Platform。');
  if (!access.isPlatformOwner) throw publicError(403, '只有平台最高管理者可以批次變更會議功能。');
}

function rowsForUpdates(access, allRows, updates, action = 'groups.read') {
  const visible = access.filterBindings(allRows, action);
  const byId = new Map(visible.map((row) => [notionId(row.id), row]));
  return updates.map((update) => {
    const row = byId.get(notionId(update.pageId));
    if (!row) throw publicError(404, '找不到可存取的群組設定。');
    access.assert(action, row.id, { status: row.status });
    return { update, row };
  });
}

function propertiesForUpdate(row, mode, preflight, schema, actor) {
  const properties = {};
  const add = (name, value) => { if (schema.properties?.[name]) properties[name] = value; };
  const capabilities = new Set(row.capabilities || []);
  if (mode === MEETING_ROLLOUT_MODES.OFF) capabilities.delete('會議');
  else capabilities.add('會議');
  add('會議待辦模式', { select: { name: meetingModeLabel(mode) } });
  add('啟用功能', { multi_select: [...capabilities].map((name) => ({ name })) });
  add('會議導入檢查', { select: { name: preflight.status } });
  add('會議檢查說明', { rich_text: textItems(preflightNote(preflight)) });
  add('會議設定版本', { rich_text: textItems(MEETING_ADMIN_SCHEMA_VERSION) });
  add('會議最後檢查時間', { date: { start: new Date().toISOString() } });
  add('最後設定時間', { date: { start: new Date().toISOString() } });
  add('最後設定者', { rich_text: textItems(clean(actor) || 'Portal 管理者') });
  return properties;
}

function tenantTabs(tenant, tenants, access) {
  const available = (Array.isArray(tenants) ? tenants : [])
    .filter((item) => item?.runtimeEnabled !== false && (item?.modules || []).includes('meetings'));
  // Only a platform owner may discover and switch across tenant names from this
  // global console. Non-owner users are rejected before this page renders.
  const visible = access?.isPlatformOwner
    ? available
    : available.filter((item) => item?.key === tenant?.key);
  const rows = visible.length ? visible : [tenant];
  return rows.map((item) => `<a class="tab${item.key === tenant.key ? ' active' : ''}" href="/meetings/manage?tenant=${encodeURIComponent(item.key)}">${esc(item.displayName || item.key)}</a>`).join('');
}

function renderAdminHtml(tenant, tenants, access) {
  const tabs = tenantTabs(tenant, tenants, access);
  const canMutate = Boolean(access?.isPlatformOwner);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>會議功能管理臺｜${esc(tenant.displayName)}</title>
<style>
:root{--green:#164c39;--mint:#e5f3ec;--line:#dbe6df;--ink:#183026;--muted:#66766e;--warn:#8a5b0a;--danger:#a12d28}*{box-sizing:border-box}body{margin:0;background:#f4f7f5;color:var(--ink);font-family:system-ui,'Noto Sans TC',sans-serif}main{max-width:1220px;margin:auto;padding:26px 18px 64px}a{color:var(--green)}h1{font-size:29px;margin:8px 0}.sub{color:var(--muted);line-height:1.6}.tabs{display:flex;gap:8px;overflow:auto;margin:22px 0 18px}.tab{white-space:nowrap;padding:9px 14px;border:1px solid var(--line);border-radius:999px;background:#fff;text-decoration:none;color:var(--ink)}.tab.active{background:var(--green);color:#fff;border-color:var(--green)}.panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:17px;margin-top:14px;box-shadow:0 5px 22px #183d2a0a}.summary{display:flex;gap:9px;flex-wrap:wrap}.pill{padding:7px 11px;border-radius:999px;background:var(--mint);font-weight:700;font-size:13px}.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center}.toolbar select,.toolbar button{min-height:42px;border-radius:10px;border:1px solid #cddbd3;padding:8px 12px;font:inherit}.toolbar select{background:#fff;min-width:210px}.toolbar button{background:var(--green);color:#fff;border:0;font-weight:750;cursor:pointer}.toolbar button.secondary{background:#e4f1ea;color:var(--green)}.toolbar button:disabled{opacity:.45;cursor:not-allowed}.notice{margin:12px 0;padding:12px 14px;border-radius:10px;background:#fff5dc;color:#714c0a;line-height:1.55}.notice.info{background:#eaf4ef;color:#28543f}.table{overflow:auto;margin-top:14px}table{width:100%;border-collapse:collapse;min-width:840px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e6ede9;padding:12px 9px;font-size:14px}th{color:#496257;font-size:12px}.badge{display:inline-block;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800}.Ready{background:#e1f4e8;color:#17623a}.Warning{background:#fff0c9;color:#7b5000}.Blocked{background:#ffe0de;color:#912620}.mode{font-weight:750}.muted{color:var(--muted);font-size:12px;line-height:1.5}.problems{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:12px;line-height:1.55}.toast{position:fixed;right:18px;bottom:18px;max-width:420px;padding:13px 16px;border-radius:11px;background:#173f31;color:white;display:none}.toast.error{background:#982b27}@media(max-width:680px){main{padding:17px 12px 50px}h1{font-size:25px}.panel{padding:13px}.toolbar>*{width:100%}}
</style></head><body><main><p><a href="/admin?tenant=${encodeURIComponent(tenant.key)}">← 回 AM Platform 後臺</a></p><h1>會議功能管理臺</h1><p class="sub">選擇每個 LINE 群的會議模式。套用前會即時檢查 LINE、LIFF、語音轉文字、Notion 與待辦儲存條件。</p><nav class="tabs">${tabs}</nav>
<section class="panel"><div class="summary"><span class="pill" id="countAll">載入中…</span><span class="pill" id="countReady">Ready 0</span><span class="pill" id="countWarning">Warning 0</span><span class="pill" id="countBlocked">Blocked 0</span><span class="pill" id="ceiling">租戶上限載入中…</span></div><p class="notice info">四種模式：關閉／僅記錄／確認試行（不建立正式任務）／完整確認（建立正式任務）。影子群與租戶安全上限會自動降級。</p><div id="schemaNotice"></div>
<div class="toolbar"><label><input id="selectAll" type="checkbox"> 全選目前群組</label><select id="batchMode"><option value="">批次選擇模式…</option>${MEETING_MODE_OPTIONS.map(({ value, label }) => `<option value="${value}">${esc(label)}</option>`).join('')}</select><button class="secondary" id="preflight">重新檢查選取群組</button><button id="apply"${canMutate ? '' : ' disabled'}>套用到選取群組</button><button class="secondary" id="schema"${canMutate ? '' : ' disabled'}>初始化管理欄位</button></div>${canMutate ? '' : '<p class="notice">目前帳號可查看與執行檢查；只有平台最高管理者可以套用變更。</p>'}
<div class="table"><table><thead><tr><th></th><th>LINE 群組</th><th>群組狀態</th><th>選擇模式</th><th>實際模式</th><th>導入檢查</th></tr></thead><tbody id="rows"><tr><td colspan="6">正在取得群組設定…</td></tr></tbody></table></div></section></main><div class="toast" id="toast"></div>
<script>
const TENANT=${JSON.stringify(tenant.key)},CAN_MUTATE=${JSON.stringify(canMutate)};let state={rows:[],missingSchemaFields:[]},busy=false;
const $=s=>document.querySelector(s);function show(message,error=false){const t=$('#toast');t.textContent=message;t.className='toast'+(error?' error':'');t.style.display='block';setTimeout(()=>t.style.display='none',5000)}
async function api(path,options={}){const response=await fetch('/meetings/manage'+path+'?tenant='+encodeURIComponent(TENANT),{...options,headers:{'content-type':'application/json',...(options.headers||{})}});let data={};try{data=await response.json()}catch{}if(!response.ok)throw Error(data.error||'處理失敗');return data}
function modeSelect(row){const s=document.createElement('select');s.className='row-mode';for(const o of ${JSON.stringify(MEETING_MODE_OPTIONS)}){const e=document.createElement('option');e.value=o.value;e.textContent=o.label;if(o.value===row.requestedMode)e.selected=true;s.appendChild(e)}return s}
function render(){const body=$('#rows');body.textContent='';for(const row of state.rows){const tr=document.createElement('tr');tr.dataset.id=row.id;const check=document.createElement('input');check.type='checkbox';check.className='pick';const td0=document.createElement('td');td0.appendChild(check);const td1=document.createElement('td');const strong=document.createElement('strong');strong.textContent=row.name;td1.append(strong);const meta=document.createElement('div');meta.className='muted';meta.textContent=(row.role||'未設定角色')+'．成員 '+row.memberCount+' 人';td1.append(meta);const td2=document.createElement('td');td2.textContent=row.status;const td3=document.createElement('td');td3.appendChild(modeSelect(row));if(row.legacy){const legacy=document.createElement('div');legacy.className='muted';legacy.textContent='沿用舊設定（尚未單群儲存）';td3.append(legacy)}const td4=document.createElement('td');td4.className='mode';td4.textContent=row.effectiveLabel;const td5=document.createElement('td');const badge=document.createElement('span');badge.className='badge '+row.preflight;badge.textContent=row.preflight;td5.append(badge);if(row.issues.length){const ul=document.createElement('ul');ul.className='problems';for(const p of row.issues){const li=document.createElement('li');li.textContent=p.message;ul.appendChild(li)}td5.appendChild(ul)}tr.append(td0,td1,td2,td3,td4,td5);body.appendChild(tr)}if(!state.rows.length){body.innerHTML='<tr><td colspan="6">目前帳號沒有可管理的群組。</td></tr>'}$('#countAll').textContent='群組 '+state.rows.length;for(const s of ['Ready','Warning','Blocked'])$('#count'+s).textContent=s+' '+state.rows.filter(r=>r.preflight===s).length;$('#ceiling').textContent='租戶上限 '+(state.ceilingLabel||'未設定');const sn=$('#schemaNotice');sn.textContent='';if(state.missingSchemaFields.length){sn.className='notice';sn.textContent='尚缺少管理欄位：'+state.missingSchemaFields.join('、')+'。請先按「初始化管理欄位」。'}else{sn.className='notice info';sn.textContent='會議管理欄位已就緒，設定套用後會立即生效。'}}
function selectedUpdates(useRowMode=false){return [...document.querySelectorAll('tr[data-id]')].filter(tr=>tr.querySelector('.pick').checked).map(tr=>({pageId:tr.dataset.id,mode:useRowMode?tr.querySelector('.row-mode').value:$('#batchMode').value}))}
async function load(){try{state=await api('/api/list');render()}catch(e){show(e.message,true);$('#rows').innerHTML='<tr><td colspan="6">群組設定取得失敗。</td></tr>'}}
async function runBusy(button,label,work){if(busy)return;busy=true;const original=button.textContent;button.disabled=true;button.textContent=label;try{return await work()}finally{busy=false;button.textContent=original;button.disabled=button.id!=='preflight'&&!CAN_MUTATE}}
$('#selectAll').addEventListener('change',e=>document.querySelectorAll('.pick').forEach(c=>c.checked=e.target.checked));$('#batchMode').addEventListener('change',e=>{if(!e.target.value)return;document.querySelectorAll('tr[data-id]').forEach(tr=>{if(tr.querySelector('.pick').checked)tr.querySelector('.row-mode').value=e.target.value})});
$('#preflight').addEventListener('click',async e=>{const updates=selectedUpdates(true);if(!updates.length)return show('請先勾選群組。',true);await runBusy(e.currentTarget,'檢查中…',async()=>{try{const data=await api('/api/preflight',{method:'POST',body:JSON.stringify({updates})});const byId=new Map(data.rows.map(r=>[r.id,r]));state.rows=state.rows.map(r=>byId.get(r.id)||r);render();show('即時檢查已完成。')}catch(error){show(error.message,true)}})});
$('#apply').addEventListener('click',async e=>{if(!CAN_MUTATE)return;const updates=selectedUpdates(true);if(!updates.length)return show('請先勾選群組。',true);if(!confirm('確定要套用到 '+updates.length+' 個群組？'))return;await runBusy(e.currentTarget,'套用中…',async()=>{try{const data=await api('/api/apply',{method:'POST',body:JSON.stringify({updates})});show('已更新 '+data.updated+' 個群組。');await load()}catch(error){show(error.message,true)}})});
$('#schema').addEventListener('click',async e=>{if(!CAN_MUTATE)return;await runBusy(e.currentTarget,'初始化中…',async()=>{try{const data=await api('/api/schema',{method:'POST',body:'{}'});show(data.changed?'管理欄位已初始化。':'管理欄位原本已就緒。');await load()}catch(error){show(error.message,true)}})});load();
</script></body></html>`;
}

function renderUnauthorized(tenant, { forbidden = false } = {}) {
  const title = forbidden ? '需要平台最高管理者權限' : '請先從 HOZO Portal 登入';
  const detail = forbidden
    ? `目前帳號不是平台最高管理者，不能開啟 ${esc(tenant?.displayName || '此租戶')} 的會議功能管理臺。`
    : '這是受保護的管理頁，請先登入 HOZO Portal，再從「AM Platform 會議管理臺」入口進入。';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f4f7f5;color:#183026;font-family:system-ui,'Noto Sans TC',sans-serif}main{max-width:620px;margin:10vh auto;padding:32px;background:#fff;border:1px solid #dbe6df;border-radius:18px;box-shadow:0 8px 32px #183d2a12}h1{font-size:26px}.sub{color:#66766e;line-height:1.8}.button{display:inline-block;margin-top:14px;padding:12px 18px;border-radius:10px;background:#164c39;color:#fff;text-decoration:none;font-weight:750}</style></head><body><main><h1>${title}</h1><p class="sub">${detail}</p><a class="button" href="https://rental.hozorental.com/portal">前往 HOZO Portal</a></main></body></html>`;
}

async function readJson(req) {
  try { return JSON.parse(await readBody(req)); } catch { throw publicError(400, '資料格式不正確。'); }
}

async function dispatch(platform, req, res, rctx) {
  if (!platform?.notionRequest) throw publicError(503, '會議管理服務尚未就緒。');
  const tenant = assertTenantContext(rctx?.tenant, rctx?.tenants);
  const access = rctx?.access;
  const pathname = clean(rctx?.pathname || new URL(req.url || '/', 'http://localhost').pathname).replace(/\/+$/, '') || '/';
  if (!access?.allowed) {
    if (pathname === '/meetings/manage' && req.method === 'GET') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(renderUnauthorized(tenant));
    }
    return sendJson(res, 401, { error: '需要此租戶的後臺權限。' });
  }

  // This console changes rollout policy across tenant groups. Until Portal has
  // a complete AM group-authorization editor, keep it platform-owner only.
  if (!access.isPlatformOwner) {
    if (pathname === '/meetings/manage' && req.method === 'GET') {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(renderUnauthorized(tenant, { forbidden: true }));
    }
    return sendJson(res, 403, { error: '只有平台最高管理者可以使用會議功能管理臺。' });
  }

  if (pathname === '/meetings/manage' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(renderAdminHtml(tenant, rctx.tenants, access));
  }

  const schema = await schemaFor(platform, tenant);
  if (pathname === '/meetings/manage/api/list' && req.method === 'GET') {
    const rows = access.filterBindings(await listBindings(platform, tenant), 'groups.read');
    return sendJson(res, 200, {
      tenant: { key: tenant.key, displayName: tenant.displayName },
      canMutate: Boolean(access.isPlatformOwner),
      ceiling: tenantMeetingModeCeiling(tenant),
      ceilingLabel: meetingModeLabel(tenantMeetingModeCeiling(tenant)),
      missingSchemaFields: missingSchemaFields(schema),
      rows: rows.map((row) => publicRow(row, preflightBinding(platform, tenant, row))),
    });
  }

  if (pathname === '/meetings/manage/api/preflight' && req.method === 'POST') {
    const updates = parseUpdates(await readJson(req));
    const rows = rowsForUpdates(access, await listBindings(platform, tenant), updates);
    return sendJson(res, 200, {
      rows: rows.map(({ row, update }) => publicRow(row, preflightBinding(platform, tenant, row, update.mode))),
    });
  }

  if (pathname === '/meetings/manage/api/schema' && req.method === 'POST') {
    assertTenantAll(access);
    const patch = meetingAdminSchemaPatch(schema.properties || {});
    if (Object.keys(patch).length) {
      await platform.notionRequest(
        `/v1/data_sources/${encodeURIComponent(tenant.dataSources.groupBindings)}`,
        { method: 'PATCH', tenantKey: tenant.key, body: { properties: patch } },
      );
      cacheFor(platform).delete(tenant.key);
    }
    return sendJson(res, 200, { ok: true, changed: Object.keys(patch).length > 0, fields: Object.keys(patch) });
  }

  if (pathname === '/meetings/manage/api/apply' && req.method === 'POST') {
    assertTenantAll(access);
    const missing = missingSchemaFields(schema);
    if (missing.length) throw publicError(409, `尚缺少管理欄位：${missing.join('、')}。`);
    const updates = parseUpdates(await readJson(req));
    const selectedRows = rowsForUpdates(access, await listBindings(platform, tenant), updates);
    const prepared = selectedRows.map(({ row, update }) => {
      access.assert('groups.core.edit', row.id, { status: row.status });
      const preflight = preflightBinding(platform, tenant, row, update.mode);
      return { row, update, preflight };
    });
    const blocked = prepared.filter((item) => item.preflight.status === 'Blocked');
    if (blocked.length) {
      throw publicError(409, `${blocked.length} 個群組未通過導入檢查，設定未變更。`);
    }

    for (const { row, update, preflight } of prepared) {
      await platform.notionRequest(`/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        tenantKey: tenant.key,
        body: { properties: propertiesForUpdate(row, update.mode, preflight, schema, access.actor) },
      });
      // The group id is server-read from this tenant's binding row. Browser
      // payloads can never choose which router cache entry is invalidated.
      platform.router?.invalidate?.(row.groupId);
    }
    return sendJson(res, 200, {
      ok: true,
      updated: prepared.length,
      rows: prepared.map(({ row, preflight }) => publicRow(row, preflight)),
    });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

function controllerFor(platform) {
  if (!platform || (typeof platform !== 'object' && typeof platform !== 'function')) return null;
  let controller = controllerCache.get(platform);
  if (!controller) {
    controller = createMeetingAdmin(platform);
    controllerCache.set(platform, controller);
  }
  return controller;
}

// Factory for modules/meetings/index.js. The returned function also exposes a
// .handler alias so either route style can mount it without an adapter.
export function createMeetingAdmin(platformOrGetter) {
  const meetingAdminHandler = async (req, res, rctx = {}) => {
    const injected = typeof platformOrGetter === 'function' ? platformOrGetter() : platformOrGetter;
    try {
      return await dispatch(injected || rctx.platform, req, res, rctx);
    } catch (error) {
      (injected || rctx.platform)?.logger?.warn?.(`Meeting admin failed (tenant=${rctx?.tenant?.key || '?'}): ${error.message}`);
      const response = clientError(error);
      return sendJson(res, response.status, { error: response.message });
    }
  };
  meetingAdminHandler.handler = meetingAdminHandler;
  return meetingAdminHandler;
}

export async function handler(req, res, rctx = {}) {
  const controller = controllerFor(rctx.platform);
  if (!controller) return sendJson(res, 503, { error: '會議管理服務尚未就緒。' });
  return controller(req, res, rctx);
}

export const __test = {
  pageModel,
  meetingAdminSchemaPatch,
  missingSchemaFields,
  adjustedBinding,
  readinessSignals,
  preflightBinding,
  publicRow,
  parseUpdates,
  rowsForUpdates,
  propertiesForUpdate,
  renderAdminHtml,
  assertTenantDataSource,
  dispatch,
};

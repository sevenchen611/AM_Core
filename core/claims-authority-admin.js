const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
const HTML_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

const json = (status, value) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(value) });
const allowedToRead = (actor) => actor?.roles?.some((role) => ['platform_owner', 'claims_access_admin', 'operator', 'auditor'].includes(role));

function financeAdminUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.pathname = '/admin-finance.html';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function financeClaimPreviewUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.pathname = '/finance-claims.html';
    url.search = '?adminPreview=employee_expense';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export const CLAIM_FORM_INVENTORY = Object.freeze([
  Object.freeze({
    key: 'legacy_social_insurance',
    name: '勞健保費用請款單',
    version: '舊版 LIFF',
    status: '歷史相容',
    description: '勞健保費用與分攤欄位模式。',
  }),
  Object.freeze({
    key: 'legacy_shared_operating',
    name: '共同營業費用請款單',
    version: '舊版 LIFF',
    status: '歷史相容',
    description: '共同營業費用明細模式。',
  }),
  Object.freeze({
    key: 'legacy_other',
    name: '其他費用請款單',
    version: '舊版 LIFF',
    status: '歷史相容',
    description: '一般與其他費用明細模式。',
  }),
  Object.freeze({
    key: 'employee_expense',
    name: 'V3 標準版請款單',
    version: 'Finance Claims V3',
    status: '現行標準',
    description: 'HOZO 同仁費用申請的現行標準表單。',
  }),
]);

function renderClaimFormInventory(basePath, financeBaseUrl) {
  const v3Preview = financeClaimPreviewUrl(financeBaseUrl);
  return CLAIM_FORM_INVENTORY.map((form, index) => {
    const previewUrl = form.key === 'employee_expense' ? v3Preview : `${basePath}/forms/${form.key}/preview`;
    const previewAction = previewUrl
      ? `<a class="preview-link" href="${previewUrl}" target="_blank" rel="noopener">開啟管理者預覽<span aria-hidden="true">↗</span></a>`
      : '<span class="preview-unavailable">預覽尚未設定</span>';
    return `<article class="form-card" data-form-key="${form.key}"><div class="form-order">${index + 1}</div><div><div class="form-card-head"><h3>${form.name}</h3><span class="pill">${form.status}</span></div><p>${form.description}</p><div class="form-footer"><div class="form-meta"><span>${form.version}</span><code>${form.key}</code></div>${previewAction}</div></div></article>`;
  }).join('');
}

export function renderClaimsAuthorityAdminPage({ basePath = '/claims-authority', csrfToken = '', financeBaseUrl = '' } = {}) {
  const api = `${basePath}/api`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>請款功能管理</title><style>
  :root{font-family:system-ui,"Noto Sans TC",sans-serif;color:#22302a;background:#f4f6f5}body{margin:0}.wrap{max-width:1100px;margin:auto;padding:28px}h1{margin:0 0 6px}h2{margin:0}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.muted{color:#68756f}.bar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button,select,input,.button-link{font:inherit;padding:9px 12px;border:1px solid #cad4cf;border-radius:9px;background:white}button{cursor:pointer;background:#246b4b;color:white}.secondary{background:white;color:#246b4b}.button-link{display:inline-block;color:#246b4b;text-decoration:none;white-space:nowrap}table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}th,td{text-align:left;padding:11px;border-bottom:1px solid #e8ecea}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f3ee;color:#246b4b;font-size:12px;font-weight:700}.error{color:#a13d34;white-space:pre-wrap}.panel{margin:18px 0}.tools{margin:24px 0;padding:18px;background:white;border:1px solid #e1e7e4;border-radius:14px}.tools h2{font-size:18px;margin-bottom:12px}.tool-button{min-width:180px;text-align:left}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 14px}.form-list{display:grid;gap:12px}.form-card{display:grid;grid-template-columns:40px 1fr;gap:12px;padding:16px;background:white;border:1px solid #e1e7e4;border-radius:14px}.form-order{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#e9f3ee;color:#246b4b;font-weight:800}.form-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.form-card h3{margin:0;font-size:17px}.form-card p{margin:6px 0;color:#68756f}.form-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.form-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:#68756f}.form-meta code{padding:3px 7px;border-radius:6px;background:#f4f6f5;color:#43514b}.preview-link{display:inline-flex;align-items:center;gap:5px;padding:8px 11px;border:1px solid #246b4b;border-radius:9px;color:#246b4b;text-decoration:none;font-size:14px;font-weight:700;white-space:nowrap}.preview-link:hover{background:#246b4b;color:white}.preview-unavailable{color:#8a4b18;font-size:13px}dialog{border:0;border-radius:14px;max-width:760px;width:90%;padding:20px}label{display:block;margin:9px 0 4px}[hidden]{display:none!important}@media(max-width:720px){.wrap{padding:18px}.page-head{flex-direction:column}table{display:block;overflow:auto}.form-card-head,.section-head,.form-footer{align-items:flex-start;flex-direction:column}}
  </style></head><body><main class="wrap"><div class="page-head"><div><h1>請款功能管理</h1><p class="muted">管理已加入「葉小蝸AI 小幫手」的群組，以及發言後自動記錄的成員。</p></div><a id="financeAdminBack" class="button-link" href="${financeAdminUrl(financeBaseUrl)}">返回財務後台</a></div><section class="tools" aria-labelledby="claims-tools-title"><h2 id="claims-tools-title">請款功能工具</h2><button type="button" id="formManagementButton" class="tool-button" aria-controls="formManagement" aria-expanded="false">請款單管理</button></section><section id="authorityManagement"><div class="bar"><button id="assigned">已綁定群組</button><button class="secondary" id="unassigned">待綁定群組</button><button class="secondary" id="reload">重新整理</button><button class="secondary" id="syncDiscovery">重新掃描已知群組</button><select id="target" hidden aria-label="請款綁定目標"></select><button id="bindSelected" hidden>綁定勾選群組</button></div><p class="muted">系統會自動接收新群組事件；「重新掃描已知群組」會回查 HOZO 既有群組資料，並向 LINE 確認小幫手是否仍在群內。</p><p id="error" class="error" role="alert"></p><section class="panel"><table><thead><tr><th>選取</th><th>群組</th><th>狀態</th><th>OA</th><th>更新時間</th><th>操作</th></tr></thead><tbody id="rows"></tbody></table></section></section><section id="formManagement" hidden><div class="section-head"><div><h2>請款單管理</h2><p class="muted">依舊版 LINE LIFF 固定模式至目前 V3 標準版排列；可用管理者預覽檢查一般使用者畫面，預覽不會建立草稿或送出請款。</p></div><button type="button" id="closeFormManagement" class="secondary">返回群組授權</button></div><div class="form-list">${renderClaimFormInventory(basePath, financeBaseUrl)}</div></section><dialog id="members"><h2>群組成員</h2><table><thead><tr><th>成員</th><th>狀態</th><th>請款權限</th><th>操作</th></tr></thead><tbody id="memberRows"></tbody></table><div class="bar"><button id="close" class="secondary">關閉</button></div></dialog></main><script>
  const API=${JSON.stringify(api)},CSRF=${JSON.stringify(csrfToken)};let view='groups';const rows=document.querySelector('#rows'),error=document.querySelector('#error');
  const text=(value)=>document.createTextNode(String(value??''));const cell=(value)=>{const td=document.createElement('td');td.append(text(value));return td};
  async function call(path,options={}){const response=await fetch(API+path,{credentials:'same-origin',...options,headers:{'content-type':'application/json','x-csrf-token':CSRF,...(options.headers||{})}});const data=await response.json();if(!response.ok)throw new Error(data.error||'操作失敗');return data}
  function action(label,handler,secondary=false){const button=document.createElement('button');button.append(text(label));if(secondary)button.className='secondary';button.onclick=handler;return button}
  async function load(){error.textContent='';rows.replaceChildren();const target=document.querySelector('#target'),bind=document.querySelector('#bindSelected');target.hidden=view==='groups';bind.hidden=view==='groups';try{if(view==='unassigned'){const targets=await call('/targets');target.replaceChildren();for(const item of targets.items){const option=document.createElement('option');option.value=item.key;option.append(text(item.label));target.append(option)}}const data=await call(view==='groups'?'/groups':'/unassigned');for(const item of data.items){const tr=document.createElement('tr'),pick=document.createElement('td');if(view==='unassigned'){const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='groupPick';checkbox.value=item.group_lookup;checkbox.setAttribute('aria-label','選取 '+(item.display_name||'群組'));pick.append(checkbox)}tr.append(pick,cell(item.display_name||String(item.group_lookup||'').slice(0,12)),cell(item.state),cell(item.oa_state),cell(item.updated_at||''));const actions=document.createElement('td');if(view==='groups')actions.append(action('成員',()=>members(item.group_lookup)),text(' '),action(item.state==='paused'?'恢復':'暫停',()=>setState(item.group_lookup,item.state==='paused'?'active':'paused'),true));tr.append(actions);rows.append(tr)}}catch(e){error.textContent=e.message}}
  async function members(group){const data=await call('/members?groupLookup='+encodeURIComponent(group));const body=document.querySelector('#memberRows');body.replaceChildren();for(const item of data.items){const tr=document.createElement('tr');tr.append(cell(item.display_name||String(item.member_lookup).slice(0,12)),cell(item.state),cell(item.manual_deny?'停用':'可請款'));const a=document.createElement('td');a.append(action(item.manual_deny?'恢復':'停用',async()=>{await mutate('/members/deny',{groupLookup:group,memberLookup:item.member_lookup,denied:!item.manual_deny});await members(group)},true));tr.append(a);body.append(tr)}document.querySelector('#members').showModal()}
  async function mutate(path,body){return call(path,{method:'POST',body:JSON.stringify(body)})}async function setState(groupLookup,state){await mutate('/groups/state',{groupLookup,state});await load()}
  async function bindSelected(){const targetKey=document.querySelector('#target').value,picks=[...document.querySelectorAll('.groupPick:checked')];if(!targetKey)throw new Error('沒有可用的 Finance V3 綁定目標');if(!picks.length)throw new Error('請先勾選群組');for(const pick of picks)await mutate('/assign',{discoveryLookup:pick.value,targetKey});view='groups';await load()}
  async function syncDiscovery(){error.textContent='';const button=document.querySelector('#syncDiscovery');button.disabled=true;try{const result=await mutate('/discovery/sync',{});view='unassigned';await load();error.textContent=result.verified+' 個仍有小幫手的既有群組已完成同步。'}catch(e){error.textContent=e.message}finally{button.disabled=false}}
  function showFormManagement(show){document.querySelector('#authorityManagement').hidden=show;document.querySelector('#formManagement').hidden=!show;document.querySelector('#formManagementButton').setAttribute('aria-expanded',String(show))}
  document.querySelector('#formManagementButton').onclick=()=>showFormManagement(true);document.querySelector('#closeFormManagement').onclick=()=>showFormManagement(false);document.querySelector('#assigned').onclick=()=>{view='groups';load()};document.querySelector('#unassigned').onclick=()=>{view='unassigned';load()};document.querySelector('#reload').onclick=load;document.querySelector('#syncDiscovery').onclick=syncDiscovery;document.querySelector('#bindSelected').onclick=()=>bindSelected().catch(e=>{error.textContent=e.message});document.querySelector('#close').onclick=()=>document.querySelector('#members').close();load();
  </script></body></html>`;
}

export function createClaimsAuthorityAdminHandler({ authority, resolveContext, resolveTarget, listTargets, verifyMutation, renderFormPreview, syncDiscovery = async () => ({ ok: true, scanned: 0, verified: 0 }), basePath = '/claims-authority' } = {}) {
  if (!authority || typeof resolveContext !== 'function' || typeof resolveTarget !== 'function' || typeof listTargets !== 'function' || typeof verifyMutation !== 'function') {
    throw new Error('Claims authority admin dependencies are incomplete.');
  }
  const api = `${basePath}/api`;
  return async function handle(request) {
    try {
      const url = new URL(request.url, 'https://claims-authority.invalid');
      const context = await resolveContext(request);
      if (!allowedToRead(context?.actor)) return json(403, { error: 'Forbidden' });
      if (request.method === 'GET' && url.pathname === basePath) return { status: 200, headers: HTML_HEADERS, body: renderClaimsAuthorityAdminPage({ basePath, csrfToken: context.csrfToken || '', financeBaseUrl: context.tenant?.config?.claims?.rentalBaseUrl || '' }) };
      const previewMatch = url.pathname.match(new RegExp(`^${basePath}/forms/([A-Za-z0-9_-]+)/preview$`, 'u'));
      if (request.method === 'GET' && previewMatch) {
        const form = CLAIM_FORM_INVENTORY.find((item) => item.key === previewMatch[1]);
        if (!form || form.key === 'employee_expense' || typeof renderFormPreview !== 'function') return json(404, { error: 'Not found' });
        return { status: 200, headers: HTML_HEADERS, body: renderFormPreview(form.key, { backUrl: basePath }) };
      }
      if (request.method === 'GET' && url.pathname === `${api}/groups`) return json(200, { items: await authority.listGroups(context) });
      if (request.method === 'GET' && url.pathname === `${api}/unassigned`) return json(200, { items: await authority.listUnassigned({ actor: context.actor }) });
      if (request.method === 'GET' && url.pathname === `${api}/targets`) {
        if (!context.actor.roles?.includes('platform_owner')) return json(403, { error: 'Forbidden' });
        return json(200, { items: await listTargets(context) });
      }
      if (request.method === 'GET' && url.pathname === `${api}/members`) return json(200, { items: await authority.listMembers({ ...context, groupLookup: url.searchParams.get('groupLookup') }) });
      if (request.method !== 'POST' || !url.pathname.startsWith(`${api}/`)) return json(404, { error: 'Not found' });
      await verifyMutation(request, context);
      const body = await request.json();
      if (url.pathname === `${api}/assign`) {
        if (!context.actor.roles?.includes('platform_owner')) return json(403, { error: 'Forbidden' });
        const target = await resolveTarget(body.targetKey, context);
        if (!target?.tenant || !target?.bindingId) throw new Error('Finance V3 binding target is invalid.');
        return json(200, await authority.assignGroup({ actor: context.actor, discoveryLookup: body.discoveryLookup, tenant: target.tenant, bindingId: target.bindingId, financeScope: target.financeScope || {} }));
      }
      if (url.pathname === `${api}/discovery/sync`) {
        if (!context.actor.roles?.includes('platform_owner')) return json(403, { error: 'Forbidden' });
        return json(200, await syncDiscovery(context));
      }
      if (url.pathname === `${api}/members/deny`) return json(200, await authority.setMemberDenied({ ...context, ...body }));
      if (url.pathname === `${api}/groups/state`) return json(200, await authority.setGroupState({ ...context, ...body }));
      return json(404, { error: 'Not found' });
    } catch (error) {
      const status = /access denied|Forbidden/u.test(String(error?.message || '')) ? 403 : 400;
      return json(status, { error: status === 403 ? 'Forbidden' : String(error?.message || 'Invalid request').slice(0, 240) });
    }
  };
}

// AM Platform 模組：會議名詞庫
// 每個租戶各自使用 Notion 資料源，只有「已啟用」的人工核准詞會帶入語音轉錄。

let platformRef = null;

const text = (value) => ({ type: 'text', text: { content: String(value || '').slice(0, 1800) } });
const plain = (prop) => (prop?.title || prop?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
const select = (prop) => String(prop?.select?.name || '').trim();
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function reqFor(tenant) {
  return (pathname, opts = {}) => platformRef.notionRequest(pathname, { ...opts, tenantKey: tenant.key });
}

function dataSource(tenant) {
  return tenant?.dataSources?.meetingTerms || '';
}

async function listTerms(tenant, { enabledOnly = false } = {}) {
  const source = dataSource(tenant);
  if (!source) return [];
  const body = { page_size: 100, sorts: [{ property: '名詞', direction: 'ascending' }] };
  if (enabledOnly) body.filter = { property: '狀態', select: { equals: '已啟用' } };
  const result = await reqFor(tenant)(`/v1/data_sources/${encodeURIComponent(source)}/query`, { method: 'POST', body });
  return (result.results || []).map((page) => ({
    id: page.id,
    term: plain(page.properties?.['名詞']),
    category: select(page.properties?.['類型']) || '其他',
    status: select(page.properties?.['狀態']) || '待確認',
    source: select(page.properties?.['來源']) || '手動',
    note: plain(page.properties?.['說明']),
  })).filter((row) => row.term);
}

async function enabledTerms(tenant) {
  try {
    return (await listTerms(tenant, { enabledOnly: true })).map((row) => row.term).filter(Boolean);
  } catch (error) {
    platformRef?.logger?.warn?.(`Meeting terms unavailable (tenant=${tenant?.key || '?'}): ${error.message}`);
    return [];
  }
}

async function saveTerm(tenant, input) {
  const source = dataSource(tenant);
  if (!source) throw new Error('此 AM 尚未建立會議名詞庫。');
  const term = String(input?.term || '').trim().slice(0, 120);
  if (!term) throw new Error('請輸入名詞。');
  const category = ['人名', '部門／職稱', '館別／案場', '系統／品牌', '其他'].includes(input?.category) ? input.category : '其他';
  const status = ['已啟用', '停用', '待確認'].includes(input?.status) ? input.status : '已啟用';
  const properties = {
    '名詞': { title: [text(term)] },
    '類型': { select: { name: category } },
    '狀態': { select: { name: status } },
    '來源': { select: { name: '手動' } },
    ...(String(input?.note || '').trim() ? { '說明': { rich_text: [text(String(input.note).trim())] } } : {}),
  };
  await reqFor(tenant)('/v1/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: source }, properties } });
}

async function setTermStatus(tenant, input) {
  const id = String(input?.id || '').trim();
  const status = ['已啟用', '停用'].includes(input?.status) ? input.status : '';
  if (!id || !status) throw new Error('名詞或狀態不正確。');
  await reqFor(tenant)(`/v1/pages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { properties: { '狀態': { select: { name: status } } } } });
}

async function suggestTermsFromMeeting({ tenant, text: meetingText, meetingTitle = '' } = {}) {
  if (!tenant || !dataSource(tenant) || !platformRef?.llmForTenant?.(tenant)?.available) return [];
  const sourceText = String(meetingText || '').slice(0, 12000);
  if (!sourceText) return [];
  let answer;
  try {
    answer = await platformRef.llmForTenant(tenant).completeJson({
      profile: 'cheap', maxTokens: 500, timeoutMs: 25_000, budgetMs: 45_000,
      system: '你是會議語音辨識名詞校對員。只找可能被聽錯的人名、中英混用專有名詞、部門、館別／案場、系統或品牌。不要列一般詞、待辦或日期。',
      userContent: `會議標題：${meetingTitle}\n內容：${sourceText}`,
      schema: { type: 'object', required: ['terms'], properties: { terms: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, category: { type: 'string' }, note: { type: 'string' } } } } } },
    });
  } catch (error) {
    platformRef.logger?.warn?.(`Meeting term suggestion skipped (tenant=${tenant.key}): ${error.message}`);
    return [];
  }
  const existing = new Set((await listTerms(tenant)).map((row) => row.term.toLocaleLowerCase()));
  const candidates = (answer?.terms || []).map((item) => ({
    term: String(item?.term || '').trim().slice(0, 120),
    category: ['人名', '部門／職稱', '館別／案場', '系統／品牌', '其他'].includes(item?.category) ? item.category : '其他',
    note: String(item?.note || '').trim().slice(0, 500),
  })).filter((item) => item.term && !existing.has(item.term.toLocaleLowerCase())).slice(0, 12);
  for (const item of candidates) {
    await reqFor(tenant)('/v1/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: dataSource(tenant) }, properties: {
      '名詞': { title: [text(item.term)] }, '類型': { select: { name: item.category } }, '狀態': { select: { name: '待確認' } }, '來源': { select: { name: 'AI 候選' } }, ...(item.note ? { '說明': { rich_text: [text(item.note)] } } : {}),
    } } });
  }
  return candidates;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 100000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('無法讀取送出的資料。')); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function render(tenant) {
  const title = escapeHtml(tenant.displayName);
  const ready = Boolean(dataSource(tenant));
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}｜會議名詞庫</title>
<style>body{margin:0;background:#f7f5ef;color:#18372d;font-family:system-ui,"Noto Sans TC",sans-serif}.wrap{max-width:780px;margin:auto;padding:28px 18px 70px}h1{font-size:28px;margin:0 0 8px}.sub{color:#62756e;line-height:1.7}.card{background:#fff;border-radius:18px;padding:22px;margin-top:18px;box-shadow:0 8px 24px #18372d12}input,select,textarea,button{font:inherit;border-radius:10px;padding:11px;border:1px solid #cdd9d3;width:100%;box-sizing:border-box}textarea{min-height:72px}button{background:#164b3a;color:#fff;border:0;font-weight:700;cursor:pointer}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.term{padding:13px 0;border-bottom:1px solid #edf0ed}.tag{font-size:12px;padding:3px 8px;border-radius:99px;background:#e8f2ed;margin-left:7px}.empty{color:#8a4a21;background:#fff6e8;padding:14px;border-radius:10px}</style>
<main class="wrap"><p class="sub">AM Platform／${title}</p><h1>會議名詞庫</h1><p class="sub">每個 AM 的名詞資料各自保存。只有<strong>已啟用</strong>的詞會帶入會議語音辨識；AI 找到的新詞應先以「待確認」保存，不能自動啟用。</p>
${ready ? `<section class="card"><h2>新增人工確認名詞</h2><div class="row"><input id="term" placeholder="例如：Amber、UOF、葉綠宿 CEO"><select id="category"><option>人名</option><option>部門／職稱</option><option>館別／案場</option><option>系統／品牌</option><option>其他</option></select></div><textarea id="note" placeholder="可選：正確寫法、職稱或辨識提示"></textarea><div class="row"><select id="status"><option>已啟用</option><option>停用</option></select><button onclick="save()">新增名詞</button></div></section><section class="card"><h2>目前名詞</h2><div id="list">讀取中…</div></section>` : `<section class="card"><div class="empty">此 AM 尚未設定專屬的名詞資料庫。平台功能已就緒；建立該 AM 的名詞庫後，才會開放新增與語音轉錄使用。</div></section>`}</main>
${ready ? `<script>async function load(){const r=await fetch('/meeting-terms/api/list?tenant=${encodeURIComponent(tenant.key)}');const j=await r.json();document.querySelector('#list').innerHTML=j.terms.length?j.terms.map(x=>'<div class="term"><strong>'+esc(x.term)+'</strong><span class="tag">'+esc(x.category)+'</span><span class="tag">'+esc(x.status)+'</span>'+(x.note?'<div class="sub">'+esc(x.note)+'</div>':'')+(x.status==='已啟用'?'<p><button onclick="state(\''+x.id+'\',\'停用\')">停用</button></p>':'<p><button onclick="state(\''+x.id+'\',\'已啟用\')">確認並啟用</button></p>')+'</div>').join(''):'<p class="sub">尚未建立名詞。</p>'}function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}async function save(){const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('/meeting-terms/api/save?tenant=${encodeURIComponent(tenant.key)}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({term:term.value,category:category.value,status:status.value,note:note.value})});const j=await r.json();if(!r.ok)throw Error(j.error);term.value='';note.value='';await load()}catch(e){alert(e.message)}finally{b.disabled=false}}async function state(id,status){const r=await fetch('/meeting-terms/api/status?tenant=${encodeURIComponent(tenant.key)}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,status})});const j=await r.json();if(!r.ok)alert(j.error);else load()}load()</script>` : ''}</html>`;
}

async function handle(req, res, rctx) {
  const { tenant, pathname, access } = rctx;
  if (!tenant) return sendJson(res, 404, { error: '找不到 AM。' });
  if (pathname === '/meeting-terms') {
    if (!access?.isTenantAll) return sendJson(res, 403, { error: '只有此 AM 的管理者可管理名詞庫。' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(render(tenant));
  }
  try {
    if (!access?.isTenantAll) return sendJson(res, 403, { error: '只有此 AM 的管理者可管理名詞庫。' });
    if (pathname === '/meeting-terms/api/list' && req.method === 'GET') return sendJson(res, 200, { terms: await listTerms(tenant) });
    if (pathname === '/meeting-terms/api/save' && req.method === 'POST') { await saveTerm(tenant, await readJson(req)); return sendJson(res, 201, { ok: true }); }
    if (pathname === '/meeting-terms/api/status' && req.method === 'POST') { await setTermStatus(tenant, await readJson(req)); return sendJson(res, 200, { ok: true }); }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) { return sendJson(res, error.statusCode || 500, { error: error.message || '名詞庫操作失敗。' }); }
}

export default {
  name: 'meeting-terms',
  init(platform) { platformRef = platform; platform.meetingTerms = { enabledTerms, listTerms, suggestTermsFromMeeting }; platform.suggestTermsFromMeeting = suggestTermsFromMeeting; },
  routes: [{ prefix: '/meeting-terms', access: { kind: 'tenant', capability: 'tenant.read' }, handler: handle }],
};

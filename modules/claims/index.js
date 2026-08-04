import crypto from 'node:crypto';
import { normalizeId, readBody, sendJson } from '../../core/util.js';

let platform = null;

const SESSION_TTL_MS = 15 * 60 * 1000;
const EVENT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const COMMANDS = new Set(['請款', '我要請款', '#請款']);
const EVENT_STATUSES = new Set([
  'submitted', 'supplement_requested', 'approved', 'rejected', 'awaiting_payment',
  'payment_processing', 'partially_paid', 'paid', 'cancelled',
]);
const SAFE_EVENT_FIELDS = new Set([
  'eventId', 'tenantKey', 'tenantId', 'bindingId', 'claimId', 'claimNumber', 'status',
  'amount', 'currency', 'occurredAt', 'reasonCode', 'paymentReference', 'paidAt',
]);

const sessions = new Map();
const eventDedupe = new Map();

function init(injected) {
  platform = injected;
}

function claimConfig(tenant) {
  const config = tenant?.config?.claims;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function cleanText(value, max = 180) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

function canonicalId(value) {
  return normalizeId(value);
}

function isActiveBinding(binding) {
  return Boolean(binding && String(binding.status || '').trim() === '啟用');
}

function hasClaimsCapability(binding, tenant) {
  const capability = cleanText(claimConfig(tenant).capability || '請款', 60);
  return Boolean(capability && Array.isArray(binding?.capabilities) && binding.capabilities.includes(capability));
}

function allowedSubmitterIds(tenant, bindingId, binding = null) {
  const bindingPolicy = cleanText(binding?.claimSubmissionPolicy, 60);
  if (bindingPolicy) {
    if (bindingPolicy !== '指定成員') return [];
    return [...new Set((Array.isArray(binding?.claimSubmitterUserIds) ? binding.claimSubmitterUserIds : [])
      .map((item) => cleanText(item, 128))
      .filter((item) => /^U[a-f0-9]{20,}$/i.test(item)))];
  }
  const configured = claimConfig(tenant).allowedSubmitterUserIdsByBinding || {};
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return [];
  const ids = configured[bindingId] || configured[canonicalId(bindingId)] || [];
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map((item) => cleanText(item, 128))
    .filter((item) => /^U[a-f0-9]{20,}$/i.test(item)))];
}

function isAllowedSubmitter(tenant, bindingId, userId, binding = null) {
  return allowedSubmitterIds(tenant, bindingId, binding).includes(cleanText(userId, 128));
}

function activeClaimsContext({ tenant, binding, userId }) {
  if (claimConfig(tenant).enabled !== true) return { ok: false, error: '此租戶的請款功能尚未啟用。' };
  if (!tenant || !binding || !isActiveBinding(binding)) return { ok: false, error: '此群組目前未啟用請款功能。' };
  if (!hasClaimsCapability(binding, tenant)) return { ok: false, error: '此群組尚未開啟請款功能。' };
  if (!isAllowedSubmitter(tenant, binding.pageId, userId, binding)) return { ok: false, error: '你的帳號尚未被指定為此群組的請款送件人。' };
  if (!claimsLiffId(tenant) || !claimsBaseUrl(tenant) || !claimsRentalToken(tenant)) {
    return { ok: false, error: '請款服務尚未完成設定，請聯絡系統管理者。' };
  }
  return { ok: true };
}

function claimsLiffId(tenant) {
  return cleanText(claimConfig(tenant).liffId, 160);
}

function claimsLiffChannelId(tenant) {
  return claimsLiffId(tenant).split('-')[0] || '';
}

function claimsBaseUrl(tenant) {
  return cleanText(claimConfig(tenant).rentalBaseUrl || claimConfig(tenant).baseUrl, 1000).replace(/\/+$/, '');
}

function claimsRentalToken(tenant) {
  const config = claimConfig(tenant);
  const envName = cleanText(config.rentalTokenEnv || config.tokenEnv, 160);
  return envName ? String(process.env[envName] || '').trim() : cleanText(config.rentalClaimsToken || config.rentalToken || config.token, 1000);
}

function claimsEventToken(tenant) {
  const config = claimConfig(tenant);
  const envName = cleanText(config.eventTokenEnv, 160);
  return envName ? String(process.env[envName] || '').trim() : cleanText(config.rentalEventToken || config.eventToken, 1000);
}

function sessionSecret() {
  return String(platform?.publicLinkSecret || '').trim();
}

function sign(value) {
  const secret = sessionSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeSessionToken(session) {
  const payload = `${session.id}.${session.expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function sessionFromToken(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || !/^[0-9a-f]{32}$/i.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const [id, rawExpiresAt, signature] = parts;
  const payload = `${id}.${rawExpiresAt}`;
  if (!timingSafeEqual(signature, sign(payload))) return null;
  const expiresAt = Number(rawExpiresAt);
  const session = sessions.get(id);
  if (!session || !Number.isFinite(expiresAt) || session.expiresAt !== expiresAt || expiresAt <= Date.now()) return null;
  return session;
}

function cleanupMemory(now = Date.now()) {
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  for (const [key, expiresAt] of eventDedupe) if (expiresAt <= now) eventDedupe.delete(key);
}

function lineUserId(ctx) {
  return cleanText(ctx?.event?.source?.userId, 128);
}

function sourceName(ctx) {
  return cleanText(ctx?.binding?.groupName, 200);
}

function commandText(value) {
  return cleanText(value, 2400);
}

function parseCommand(value) {
  const text = commandText(value);
  if (!text) return { kind: 'none' };
  if (COMMANDS.has(text)) return { kind: 'open', draftText: '' };
  const standard = text.match(/^#請款\s+([\s\S]+)$/);
  if (standard) return { kind: 'draft', draftText: standard[1].trim().slice(0, 2000) };
  return { kind: 'none' };
}

function createSession(ctx, draftText = '') {
  cleanupMemory();
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const session = {
    id,
    expiresAt: now + SESSION_TTL_MS,
    externalSubmissionId: `amc_${ctx.tenant.key}_${crypto.randomUUID()}`,
    tenantKey: ctx.tenant.key,
    tenantId: cleanText(ctx.tenant.tenantId, 100),
    bindingId: ctx.binding.pageId,
    sourceGroupName: sourceName(ctx),
    requestedByUserId: lineUserId(ctx),
    requestedByName: cleanText(ctx.senderName, 120),
    draftText: cleanText(draftText, 2000),
    submitted: false,
  };
  sessions.set(id, session);
  return session;
}

function liffLink(tenant, session) {
  const liffId = claimsLiffId(tenant);
  // Keep the LIFF endpoint path fixed and pass the signed session as query
  // data. LINE restores this after liff.init(), avoiding a second page path
  // transition inside the mobile LIFF browser.
  const url = new URL(`https://liff.line.me/${encodeURIComponent(liffId)}`);
  url.searchParams.set('session', makeSessionToken(session));
  return url.toString();
}

function html(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function readJson(req) {
  return readBody(req).then((raw) => {
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    try { return raw ? JSON.parse(raw) : {}; }
    catch { throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 }); }
  });
}

async function lineProfileFromAccessToken(accessToken, expectedClientId) {
  const token = cleanText(accessToken, 8000);
  if (!token || !expectedClientId) throw Object.assign(new Error('請從群組提供的連結重新開啟。'), { statusCode: 401 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const verification = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`, { signal: controller.signal });
    if (!verification.ok) throw Object.assign(new Error('LINE 身分驗證失敗，請重新開啟表單。'), { statusCode: 401 });
    const tokenInfo = await verification.json();
    if (String(tokenInfo.client_id || '') !== expectedClientId || Number(tokenInfo.expires_in || 0) <= 0) {
      throw Object.assign(new Error('LINE 身分驗證失敗，請重新開啟表單。'), { statusCode: 401 });
    }
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    });
    if (!profileResponse.ok) throw Object.assign(new Error('LINE 個人資料驗證失敗，請重新開啟表單。'), { statusCode: 401 });
    const profile = await profileResponse.json();
    return { userId: cleanText(profile.userId, 128), displayName: cleanText(profile.displayName, 120) };
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('LINE 身分驗證逾時，請稍後重試。'), { statusCode: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifiedActor(session, tenant, accessToken, binding) {
  const profile = await lineProfileFromAccessToken(accessToken, claimsLiffChannelId(tenant));
  if (!profile.userId || profile.userId !== session.requestedByUserId) {
    throw Object.assign(new Error('此請款連結僅限原送件人使用。'), { statusCode: 403 });
  }
  if (!isAllowedSubmitter(tenant, session.bindingId, profile.userId, binding)) {
    throw Object.assign(new Error('你的帳號已不具此群組的請款送件權限。'), { statusCode: 403 });
  }
  return profile;
}

function amount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) return null;
  return Math.round(n * 100) / 100;
}

function validPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : '';
}

function claimTypes(tenant) {
  const configured = claimConfig(tenant).claimTypes;
  const list = Array.isArray(configured) ? configured : ['labor_health_insurance', 'shared_operating', 'other'];
  return new Set(list.map((type) => cleanText(type, 80)).filter((type) => /^[a-z][a-z0-9_]{1,79}$/.test(type)));
}

function normalizeAttachments(value) {
  if (!Array.isArray(value) || value.length > 5) throw Object.assign(new Error('附件格式不正確。'), { statusCode: 400 });
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Object.assign(new Error('附件格式不正確。'), { statusCode: 400 });
    const id = cleanText(item.id, 160);
    const name = cleanText(item.name, 180);
    const contentType = cleanText(item.contentType, 100).toLowerCase();
    const size = Number(item.size);
    const sha256 = cleanText(item.sha256, 64).toLowerCase();
    if (!id || !name || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(contentType)
      || !Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024 || (sha256 && !/^[a-f0-9]{64}$/.test(sha256))) {
      throw Object.assign(new Error('附件格式不正確。'), { statusCode: 400 });
    }
    return { id, name, contentType, size, ...(sha256 ? { sha256 } : {}) };
  });
}

function normalizeClaimSubmission(body, session, tenant, actor) {
  const type = cleanText(body.type, 80);
  const period = validPeriod(body.period);
  if (!claimTypes(tenant).has(type) || !period) throw Object.assign(new Error('請款類型或期間不正確。'), { statusCode: 400 });
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 30) {
    throw Object.assign(new Error('至少需要一筆、至多 30 筆請款明細。'), { statusCode: 400 });
  }
  const lines = body.lines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw Object.assign(new Error('請款明細格式不正確。'), { statusCode: 400 });
    const description = cleanText(line.description, 500);
    const amountValue = amount(line.amount);
    const employeeReference = cleanText(line.employeeReference, 160);
    if (!description || amountValue === null || amountValue <= 0) throw Object.assign(new Error('請款明細格式不正確。'), { statusCode: 400 });
    return { description, amount: amountValue, ...(employeeReference ? { employeeReference } : {}) };
  });
  const expectedTotal = Math.round(lines.reduce((total, line) => total + line.amount, 0) * 100) / 100;
  const totals = body.totals && typeof body.totals === 'object' && !Array.isArray(body.totals) ? body.totals : {};
  const requestedAmount = amount(totals.requestedAmount);
  const companyExpenseAmount = totals.companyExpenseAmount === undefined ? undefined : amount(totals.companyExpenseAmount);
  const employeeRecoverableAmount = totals.employeeRecoverableAmount === undefined ? undefined : amount(totals.employeeRecoverableAmount);
  const currency = cleanText(totals.currency || 'TWD', 8).toUpperCase();
  if (requestedAmount === null || requestedAmount !== expectedTotal || currency !== 'TWD'
    || companyExpenseAmount === null || employeeRecoverableAmount === null
    || (companyExpenseAmount !== undefined && employeeRecoverableAmount !== undefined
      && Math.round((companyExpenseAmount + employeeRecoverableAmount) * 100) / 100 !== requestedAmount)) {
    throw Object.assign(new Error('請款總額與明細不一致。'), { statusCode: 400 });
  }
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate || '')) ? String(body.dueDate) : '';
  const note = cleanText(body.note, 1000);
  return {
    schemaVersion: 'am-claims-v1',
    externalSubmissionId: session.externalSubmissionId,
    tenant: { key: session.tenantKey, uuid: session.tenantId },
    source: {
      groupBindingId: session.bindingId,
      groupNameSnapshot: session.sourceGroupName,
      actor: { reference: actor.userId, name: actor.displayName || session.requestedByName },
    },
    claim: {
      type, period, lines,
      totals: {
        requestedAmount,
        ...(companyExpenseAmount === undefined ? {} : { companyExpenseAmount }),
        ...(employeeRecoverableAmount === undefined ? {} : { employeeRecoverableAmount }),
        currency,
      },
      ...(dueDate ? { dueDate } : {}),
      ...(note ? { note } : {}),
    },
    attachments: normalizeAttachments(body.attachments || []),
  };
}

async function createRentalClaim(tenant, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${claimsBaseUrl(tenant)}/api/integrations/finance/claims`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${claimsRentalToken(tenant)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.externalSubmissionId,
        'X-AM-Claims-Version': payload.schemaVersion,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let result = {};
    try { result = responseText ? JSON.parse(responseText) : {}; } catch { result = {}; }
    if (!response.ok) throw Object.assign(new Error('Rental 請款服務暫時無法處理，請稍後重試。'), { statusCode: 502, detail: `status=${response.status}` });
    return {
      claimId: cleanText(result.claimId || result.id, 160),
      claimNumber: cleanText(result.claimNumber || result.number, 120),
      status: cleanText(result.status || 'submitted', 80),
    };
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('Rental 請款服務逾時，請稍後重試。'), { statusCode: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function money(value, currency = 'TWD') {
  const amountValue = amount(value);
  return amountValue === null ? '' : new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amountValue);
}

function initialStatusMessage(result, payload) {
  const number = result.claimNumber ? `請款單 ${result.claimNumber}` : '請款單';
  return `${number} 已送出\n期間：${payload.claim.period}\n金額：${money(payload.claim.totals.requestedAmount, payload.claim.totals.currency)}\n狀態：待核准`;
}

function liffHtml(session, tenant) {
  const data = {
    sessionToken: makeSessionToken(session),
    apiPath: `/claims/liff/${encodeURIComponent(makeSessionToken(session))}`,
    liffId: claimsLiffId(tenant),
    draftText: session.draftText,
    claimTypes: [...claimTypes(tenant)],
    sourceGroupName: session.sourceGroupName,
  };
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>請款單</title>
<style>body{margin:0;background:#f3f6f4;color:#24352c;font-family:system-ui,'Noto Sans TC',sans-serif}main{max-width:680px;margin:auto;padding:20px 16px 44px}h1{font-size:22px;margin:0 0 4px}.sub{color:#68776f;font-size:13px;margin:0 0 18px}.panel{background:#fff;border:1px solid #dce6e0;border-radius:8px;padding:16px;margin-top:12px}label{display:block;font-size:13px;font-weight:700;margin:13px 0 6px}input,select,textarea,button{font:inherit;box-sizing:border-box}input,select,textarea{width:100%;border:1px solid #bdcfc4;border-radius:6px;padding:10px;background:#fff}textarea{min-height:72px;resize:vertical}.line{display:grid;grid-template-columns:1fr 132px;gap:8px;margin-top:8px}.secondary{background:#fff;color:#22643e;border:1px solid #68a47d}.actions{display:flex;gap:8px;margin-top:14px}.actions button{flex:1}button{border:0;border-radius:6px;padding:11px;background:#267348;color:#fff;font-weight:700;cursor:pointer}.status{font-size:13px;line-height:1.55;margin-top:12px}.error{color:#a13d32}.hidden{display:none}</style></head><body><main>
<h1>請款單</h1><p class="sub" id="group"></p><section class="panel"><p class="status" id="identity">正在驗證 LINE 身分…</p><div id="form" class="hidden"><label>請款類型<select id="type"></select></label><label>請款期間<input id="period" type="month"></label><label>請款明細</label><div id="lines"></div><button class="secondary" id="add" type="button">新增明細</button><label>公司費用（選填）<input id="companyExpense" inputmode="decimal" placeholder="0"></label><label>員工應收／扣回（選填）<input id="employeeRecoverable" inputmode="decimal" placeholder="0"></label><label>付款到期日（選填）<input id="dueDate" type="date"></label><label>備註（選填）<textarea id="note"></textarea></label><label>附件資訊（此版先登錄檔案資訊）<input id="attachments" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></label><div class="actions"><button id="submit" type="button">確認送出請款</button></div></div><p id="result" class="status"></p><button class="secondary hidden" id="retry" type="button">重新驗證</button></section>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>const DATA=${jsonScript(data)};const $=id=>document.getElementById(id);let token='';let identified=false;
const api=async(body)=>{const r=await fetch(DATA.apiPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,liffAccessToken:token})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'操作失敗');return j};
const trace=stage=>fetch(DATA.apiPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'telemetry',sessionToken:DATA.sessionToken,stage})}).catch(()=>{});
const within=(promise,timeoutMs,message)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(message)),timeoutMs);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)});});
function addLine(description='',lineAmount=''){const row=document.createElement('div');row.className='line';row.innerHTML='<input class="desc" placeholder="項目說明"><input class="amount" inputmode="decimal" placeholder="金額">';row.querySelector('.desc').value=description;row.querySelector('.amount').value=lineAmount;$('lines').append(row)}
function parseDraft(){if(!DATA.draftText)return;const raw=DATA.draftText;const entries=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);if(entries.length)entries.forEach(x=>addLine(x,''));}
function files(){return [...$('attachments').files].map((file,index)=>({id:'client-'+index+'-'+file.name, name:file.name,contentType:file.type,size:file.size}))}
async function init(){try{$('retry').classList.add('hidden');$('identity').className='status';$('identity').textContent='正在啟動 LINE 身分元件…';trace('init_start');if(!window.liff)throw Error('LINE 登入元件載入失敗，請關閉後從群組連結重新開啟。');await within(liff.init({liffId:DATA.liffId,withLoginOnExternalBrowser:true}),10000,'LINE 身分元件初始化逾時，請按重新驗證或從群組重新開啟。');trace('init_ready');if(!liff.isLoggedIn()){$('identity').textContent='正在開啟 LINE 登入…';trace('login_redirect');liff.login({redirectUri:location.href});return}token=liff.getAccessToken?.()||'';if(!token)throw Error('沒有取得 LINE 登入權杖，請從群組重新開啟。');$('identity').textContent='正在向系統驗證 LINE 身分…';trace('identify_start');await within(api({action:'identify',sessionToken:DATA.sessionToken}),12000,'系統身分驗證逾時，請按重新驗證或從群組重新開啟。');identified=true;trace('identify_ready');$('identity').textContent='LINE 身分已驗證';$('form').classList.remove('hidden')}catch(error){trace('error');$('identity').className='status error';$('identity').textContent=error.message||'LINE 身分驗證失敗';$('retry').classList.remove('hidden')}}
$('group').textContent='來源群組：'+DATA.sourceGroupName;$('type').innerHTML=DATA.claimTypes.map(type=>'<option value="'+type+'">'+type+'</option>').join('');addLine();parseDraft();$('retry').onclick=()=>init();$('add').onclick=()=>addLine();$('submit').onclick=async()=>{if(!identified)return;const button=$('submit'),result=$('result');button.disabled=true;result.className='status';result.textContent='送出中…';try{const lines=[...document.querySelectorAll('.line')].map(row=>({description:row.querySelector('.desc').value,amount:row.querySelector('.amount').value})).filter(line=>line.description||line.amount);const requestedAmount=lines.reduce((sum,line)=>sum+(Number(line.amount)||0),0);const companyExpenseAmount=$('companyExpense').value;const employeeRecoverableAmount=$('employeeRecoverable').value;const totals={requestedAmount,currency:'TWD'};if(companyExpenseAmount)totals.companyExpenseAmount=Number(companyExpenseAmount);if(employeeRecoverableAmount)totals.employeeRecoverableAmount=Number(employeeRecoverableAmount);const data=await api({action:'submit',sessionToken:DATA.sessionToken,type:$('type').value,period:$('period').value,lines,totals,dueDate:$('dueDate').value,note:$('note').value,attachments:files()});result.textContent=(data.claimNumber?'請款單 '+data.claimNumber:'請款單')+' 已送出，已同步回覆群組。';$('form').classList.add('hidden')}catch(error){result.className='status error';result.textContent=error.message||'送出失敗'}finally{button.disabled=false}};init();</script></main></body></html>`;
}

function liffTokenFromRequest(pathname, url) {
  const direct = String(pathname || '').match(/^\/claims\/liff\/([0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]+)$/i);
  if (direct) return direct[1];
  const state = String(url?.searchParams?.get('liff.state') || '');
  const fromState = state.match(/^\/?(?:claims\/liff\/)?([0-9a-f]{32}\.\d+\.[A-Za-z0-9_-]+)(?:[?#].*)?$/i);
  if (fromState) return fromState[1];
  const stateSession = new URLSearchParams(state.replace(/^\?/, '').split('#', 1)[0]).get('session');
  if (stateSession) return cleanText(stateSession, 400);
  return cleanText(url?.searchParams?.get('session'), 400);
}

function tenantForSession(session, tenants, fallback) {
  return (tenants || []).find((tenant) => tenant.key === session.tenantKey) || (fallback?.key === session.tenantKey ? fallback : null);
}

async function handleLiff(req, res, { pathname, url, tenant = null, tenants = [] }) {
  const token = liffTokenFromRequest(pathname, url);
  const session = sessionFromToken(token);
  if (!session) return sendJson(res, 404, { error: '請款連結已失效，請回到群組重新建立。' });
  const sessionTenant = tenantForSession(session, tenants, tenant);
  if (!sessionTenant || claimConfig(sessionTenant).enabled !== true || !claimsLiffId(sessionTenant)) {
    return sendJson(res, 404, { error: '請款服務未設定。' });
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(liffHtml(session, sessionTenant));
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  try {
    const body = await readJson(req);
    const action = cleanText(body.action, 40);
    if (action === 'telemetry') {
      const stage = cleanText(body.stage, 60);
      platform?.logger?.log?.(`[claims] liff stage=${stage || 'unknown'} session=${session.id.slice(0, 8)}`);
      return sendJson(res, 200, { ok: true });
    }
    // Re-read the source binding at every protected action. A link created before a group is
    // disabled, loses the claims capability, or has its sender allowlist changed must fail closed.
    session.binding = await bindingForEvent(sessionTenant, session.bindingId);
    const actor = await verifiedActor(session, sessionTenant, body.liffAccessToken, session.binding);
    if (action === 'identify') return sendJson(res, 200, { ok: true, actor: { name: actor.displayName }, draftText: session.draftText });
    if (action !== 'submit') return sendJson(res, 400, { error: 'Unsupported action.' });
    if (session.submitted) return sendJson(res, 409, { error: '此請款單已送出。' });
    const payload = normalizeClaimSubmission(body, session, sessionTenant, actor);
    const result = await createRentalClaim(sessionTenant, payload);
    session.submitted = true;
    session.claimId = result.claimId;
    session.claimNumber = result.claimNumber;
    // This ID only stays in the short-lived AM session so the initial safe status can go back to
    // the originating LINE group. It is never included in the Rental request or event API.
    const binding = session.binding;
    if (binding?.groupId) await platform.pushLineMessage(binding.groupId, initialStatusMessage(result, payload), undefined, { retryKey: session.externalSubmissionId });
    return sendJson(res, 201, { ok: true, claimId: result.claimId, claimNumber: result.claimNumber, status: result.status || 'submitted' });
  } catch (error) {
    platform?.logger?.warn?.(`Claims LIFF request failed: ${error.message}`);
    return sendJson(res, error.statusCode || 500, { error: error.message || '請款送出失敗。' });
  }
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function eventAuthorized(req, tenant) {
  const expected = claimsEventToken(tenant);
  return Boolean(expected && timingSafeEqual(bearerToken(req), expected));
}

function readPlain(prop, type = 'rich_text') {
  return (prop?.[type] || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function readMulti(prop) {
  return (prop?.multi_select || []).map((item) => item.name).filter(Boolean);
}

function parseUserIds(prop) {
  const raw = readPlain(prop);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => cleanText(item, 128));
  } catch { /* fail closed below */ }
  return [];
}

function groupIdFromPage(page) {
  return readPlain(page?.properties?.['LINE 群組 ID']);
}

function groupNameFromPage(page) {
  return readPlain(page?.properties?.['群組名稱'], 'title');
}

function statusFromPage(page) {
  return page?.properties?.['狀態']?.select?.name || '';
}

async function bindingForEvent(tenant, bindingId) {
  const pageId = canonicalId(bindingId);
  if (!/^[a-f0-9]{32}$/.test(pageId)) throw Object.assign(new Error('Invalid binding ID.'), { statusCode: 400 });
  const page = await platform.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET', tenantKey: tenant.key });
  const parentId = canonicalId(page?.parent?.data_source_id || (page?.parent?.type === 'data_source_id' ? page.parent.data_source_id : ''));
  if (!parentId || parentId !== canonicalId(tenant.dataSources?.groupBindings)) {
    throw Object.assign(new Error('Binding does not belong to this tenant.'), { statusCode: 403 });
  }
  const binding = {
    pageId,
    groupId: groupIdFromPage(page),
    groupName: groupNameFromPage(page),
    status: statusFromPage(page),
    capabilities: readMulti(page?.properties?.['啟用功能']),
    claimSubmissionPolicy: page?.properties?.['請款送件權限']?.select?.name || '',
    claimSubmitterUserIds: parseUserIds(page?.properties?.['請款指定送件人']),
  };
  if (!isActiveBinding(binding) || !hasClaimsCapability(binding, tenant) || !binding.groupId) {
    throw Object.assign(new Error('Binding is not active for claims.'), { statusCode: 409 });
  }
  return binding;
}

function normalizeClaimEvent(body, tenant) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid event payload.'), { statusCode: 400 });
  for (const key of Object.keys(body)) if (!SAFE_EVENT_FIELDS.has(key)) throw Object.assign(new Error(`Unsupported event field: ${key}`), { statusCode: 400 });
  const eventId = cleanText(body.eventId, 160);
  const tenantKey = cleanText(body.tenantKey, 120);
  const tenantId = cleanText(body.tenantId, 120);
  const bindingId = canonicalId(body.bindingId);
  const status = cleanText(body.status, 80);
  const claimId = cleanText(body.claimId, 160);
  const claimNumber = cleanText(body.claimNumber, 120);
  const amountValue = amount(body.amount);
  const currency = cleanText(body.currency || 'TWD', 8).toUpperCase();
  const occurredAt = cleanText(body.occurredAt, 64);
  const paidAt = cleanText(body.paidAt, 64);
  const paymentReference = cleanText(body.paymentReference, 80);
  const reasonCode = cleanText(body.reasonCode, 80);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(eventId) || tenantKey !== tenant.key || tenantId !== cleanText(tenant.tenantId, 120)
    || !/^[a-f0-9]{32}$/.test(bindingId) || !EVENT_STATUSES.has(status) || !claimId || !claimNumber
    || amountValue === null || currency !== 'TWD' || (occurredAt && Number.isNaN(Date.parse(occurredAt))) || (paidAt && Number.isNaN(Date.parse(paidAt)))) {
    throw Object.assign(new Error('Invalid claim event payload.'), { statusCode: 400 });
  }
  return { eventId, tenantKey, tenantId, bindingId, claimId, claimNumber, status, amount: amountValue, currency, occurredAt, paidAt, paymentReference, reasonCode };
}

function eventMessage(event) {
  const subject = `請款單 ${event.claimNumber}`;
  const value = money(event.amount, event.currency);
  const suffix = value ? `\n金額：${value}` : '';
  const templates = {
    submitted: `${subject} 已送出\n狀態：待核准${suffix}`,
    supplement_requested: `${subject} 需要補件\n狀態：待補件${suffix}`,
    approved: `${subject} 已核准\n狀態：待付款${suffix}`,
    rejected: `${subject} 未核准\n狀態：已退回${suffix}`,
    awaiting_payment: `${subject} 已列入應付款\n狀態：待付款${suffix}`,
    payment_processing: `${subject} 正在付款處理\n狀態：付款處理中${suffix}`,
    partially_paid: `${subject} 已部分付款\n狀態：部分付款${suffix}`,
    paid: `${subject} 已完成付款\n付款金額：${value}\n狀態：已付款`,
    cancelled: `${subject} 已取消\n狀態：已取消${suffix}`,
  };
  return templates[event.status] || `${subject} 狀態已更新${suffix}`;
}

async function handleClaimEvent(req, res, { tenant }) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  if (!tenant || claimConfig(tenant).enabled !== true) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  if (!tenant || !eventAuthorized(req, tenant)) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  try {
    cleanupMemory();
    const event = normalizeClaimEvent(await readJson(req), tenant);
    const key = `${tenant.key}:${event.bindingId}:${event.eventId}`;
    if (eventDedupe.has(key)) return sendJson(res, 200, { ok: true, duplicate: true });
    const binding = await bindingForEvent(tenant, event.bindingId);
    const receipt = await platform.pushLineMessage(binding.groupId, eventMessage(event), undefined, { retryKey: event.eventId });
    eventDedupe.set(key, Date.now() + EVENT_DEDUPE_TTL_MS);
    return sendJson(res, 200, {
      ok: true,
      duplicate: false,
      bindingId: binding.pageId,
      line: { status: receipt.status, requestId: receipt.requestId || '', acceptedRequestId: receipt.acceptedRequestId || '' },
    });
  } catch (error) {
    platform?.logger?.warn?.(`Claim event delivery failed: ${error.message}`);
    return sendJson(res, error.statusCode || 502, { ok: false, error: error.message || 'Claim event delivery failed.' });
  }
}

async function onMessage(ctx) {
  const command = parseCommand(ctx.text);
  if (command.kind === 'none') return false;
  let binding = ctx.binding;
  try {
    binding = await bindingForEvent(ctx.tenant, ctx.binding?.pageId);
  } catch (error) {
    const message = error.statusCode === 409 ? '此群組目前未啟用請款功能。' : '請款群組設定暫時無法驗證，請稍後再試。';
    await platform.replyLineMessage(ctx.event?.replyToken, message).catch(() => {});
    return true;
  }
  const context = activeClaimsContext({ tenant: ctx.tenant, binding, userId: lineUserId(ctx) });
  if (!context.ok) {
    await platform.replyLineMessage(ctx.event?.replyToken, context.error).catch(() => {});
    return true;
  }
  const session = createSession({ ...ctx, binding }, command.draftText);
  session.binding = binding;
  const link = liffLink(ctx.tenant, session);
  const message = command.kind === 'draft'
    ? `已建立請款草稿預覽，請確認內容後再送出：\n${link}`
    : `請開啟請款表單填寫資料：\n${link}`;
  await platform.replyLineMessage(ctx.event?.replyToken, message).catch(async () => {
    await platform.pushLineMessage(ctx.groupId, message, undefined, { retryKey: session.id });
  });
  return true;
}

export default {
  name: 'claims',
  init,
  onMessage,
  routes: [
    {
      prefix: '/claims/liff',
      access: { kind: 'public', scope: 'signed-liff-session' },
      handler: handleLiff,
    },
    {
      prefix: '/control/finance/claim-events',
      method: 'POST',
      access: { kind: 'machine', scope: 'tenant', capability: 'finance.claim-events' },
      handler: handleClaimEvent,
    },
  ],
};

export const __test = {
  parseCommand,
  normalizeClaimSubmission,
  normalizeClaimEvent,
  eventMessage,
  isActiveBinding,
  hasClaimsCapability,
  allowedSubmitterIds,
  createSession,
  makeSessionToken,
  sessionFromToken,
  liffLink,
  liffTokenFromRequest,
  eventDedupe,
  sessions,
  cleanupMemory,
};

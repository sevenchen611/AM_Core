import { randomBytes } from 'node:crypto';
import {
  ContractSigningError,
  contractSigningSecurityHeaders,
} from './contract-signing.js';

export const CONTRACT_SIGNING_WEB_PATH = '/contract-sign';
export const CONTRACT_SIGNING_OPEN_PATH = '/contract-sign/api/open';
export const CONTRACT_SIGNING_SUBMIT_PATH = '/contract-sign/api/submit';
export const CONTRACT_SIGNING_DOCUMENT_PATH = '/contract-sign/api/document';
export const DEFAULT_CONTRACT_SIGNING_BODY_LIMIT = 450_000;
export const DEFAULT_SIGNATURE_DATA_LIMIT = 320_000;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function escapeScriptJson(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function error(code, message, status) {
  return new ContractSigningError(code, message, status);
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) return String(Array.isArray(value) ? value[0] : value || '').trim();
  }
  return '';
}

function webSecurityHeaders(nonce, contentType) {
  const headers = contractSigningSecurityHeaders({
    connectSources: ['https://api.line.me', 'https://access.line.me'],
  });
  headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
  headers['Content-Security-Policy'] = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' https://static.line-scdn.net`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "connect-src 'self' https://api.line.me https://access.line.me",
  ].join('; ');
  headers['Content-Type'] = contentType;
  return headers;
}

function writeResponse(res, status, headers, body, headOnly = false) {
  res.writeHead(status, headers);
  res.end(headOnly ? '' : body);
}

function sendJson(res, status, payload, nonce = randomBytes(16).toString('base64url')) {
  writeResponse(res, status, webSecurityHeaders(nonce, 'application/json; charset=utf-8'), JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(headerValue(req.headers, 'content-type'))) {
    throw error('UNSUPPORTED_MEDIA_TYPE', '請使用 application/json。', 415);
  }
  const declared = Number(headerValue(req.headers, 'content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw error('BODY_TOO_LARGE', '送出資料過大。', 413);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw error('BODY_TOO_LARGE', '送出資料過大。', 413);
    chunks.push(buffer);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw error('INVALID_JSON', 'JSON 格式不正確。', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('INVALID_JSON', 'JSON 內容必須是物件。', 400);
  return body;
}

function requireText(value, name, maxLength = 5000) {
  const normalized = String(value || '').trim();
  if (!normalized) throw error('FIELD_REQUIRED', `${name} 不可為空。`, 400);
  if (normalized.length > maxLength) throw error('FIELD_TOO_LONG', `${name} 過長。`, 400);
  return normalized;
}

function positiveInteger(value, fallback, name) {
  const normalized = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(`${name} must be a positive integer`);
  return normalized;
}

function decodeSignatureDataUrl(value, maxBytes) {
  const dataUrl = requireText(value, 'signatureDataUrl', Math.ceil(maxBytes * 1.5) + 100);
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw error('INVALID_SIGNATURE_FORMAT', '簽名必須是 PNG 或 JPEG data URL。', 400);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw error('SIGNATURE_TOO_LARGE', '簽名圖片過大。', 413);
  const isPng = match[1] === 'image/png'
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === 'image/jpeg'
    && bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9;
  if (!isPng && !isJpeg) throw error('INVALID_SIGNATURE_BYTES', '簽名圖片內容與格式不符。', 400);
  return { bytes, contentType: match[1] };
}

function normalizeDocumentUrl(value) {
  const candidate = requireText(value, 'documentUrl', 3000);
  if (/[\u0000-\u001f\u007f]/.test(candidate) || candidate.includes('\\')) {
    throw error('UNSAFE_DOCUMENT_URL', '合約文件連結不安全。', 500);
  }
  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    const base = new URL('https://engineering-am.invalid');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) throw error('UNSAFE_DOCUMENT_URL', '合約文件連結不安全。', 500);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw error('UNSAFE_DOCUMENT_URL', '合約文件連結不安全。', 500);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw error('UNSAFE_DOCUMENT_URL', '合約文件連結不安全。', 500);
  }
  return parsed.toString();
}

async function resolvePublicDocumentUrl(result, resolver) {
  const documentRef = String(result?.documentRef || '').trim();
  if (!documentRef || documentRef.length > 3000) {
    throw error('DOCUMENT_REFERENCE_INVALID', '合約文件目前無法開啟。', 500);
  }
  const candidate = resolver
    ? await resolver({
      documentRef,
      sessionId: String(result?.sessionId || ''),
      contractId: String(result?.contractId || ''),
      projectId: String(result?.projectId || ''),
      documentHash: String(result?.documentHash || ''),
    })
    : documentRef;
  const normalized = normalizeDocumentUrl(candidate);
  if (!resolver && normalized.startsWith('/')) {
    throw error('DOCUMENT_RESOLVER_REQUIRED', '合約文件目前無法開啟。', 500);
  }
  return normalized;
}

function publicOpenPayload(result, documentUrl) {
  return {
    sessionId: String(result?.sessionId || ''),
    contractId: String(result?.contractId || ''),
    projectId: String(result?.projectId || ''),
    documentHash: String(result?.documentHash || ''),
    documentUrl,
    status: String(result?.status || ''),
    expiresAt: String(result?.expiresAt || ''),
    idempotent: result?.idempotent === true,
  };
}

function publicSubmitPayload(result) {
  return {
    sessionId: String(result?.sessionId || ''),
    status: String(result?.status || ''),
    idempotent: result?.idempotent === true,
    groupNotificationAccepted: result?.groupNotificationAccepted === true,
  };
}

function signingPageScript(liffId) {
  return `
const LIFF_ID = ${escapeScriptJson(liffId)};
const TOKEN_STORAGE_KEY = 'engineering-contract-sign-token';
const state = { token:'', credential:'', signing:null, reviewAcknowledged:false, canvas:null, context:null, width:0, height:0, strokes:[], drawing:false };
const byId = (id) => document.getElementById(id);
function show(message, kind='') { const node=byId('message'); node.textContent=message; node.className='message '+kind; }
async function api(path, payload) {
  const response = await fetch(path, {
    method:'POST', credentials:'same-origin', cache:'no-store', referrerPolicy:'no-referrer',
    headers:{'content-type':'application/json'}, body:JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const failure=new Error(result.error || '操作失敗，請稍後再試。'); failure.code=result.code || ''; throw failure; }
  return result;
}
function readFragmentToken() {
  const fragment = new URLSearchParams(location.hash.replace(/^#/,''));
  const fromFragment = fragment.get('token') || '';
  if (fromFragment) sessionStorage.setItem(TOKEN_STORAGE_KEY, fromFragment);
  history.replaceState(null, '', location.pathname);
  return fromFragment || sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
}
function initCanvas() {
  const canvas=byId('signature'); const ratio=Math.min(devicePixelRatio || 1,2);
  const width=canvas.clientWidth || 320; const height=canvas.clientHeight || 180;
  canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
  const context=canvas.getContext('2d'); context.scale(ratio,ratio);
  context.strokeStyle='#1e2923'; context.lineWidth=2.5; context.lineCap='round'; context.lineJoin='round';
  state.canvas=canvas; state.context=context; state.width=width; state.height=height;
  const point=(event)=>{ const rect=canvas.getBoundingClientRect(); return {x:event.clientX-rect.left,y:event.clientY-rect.top}; };
  canvas.addEventListener('pointerdown',(event)=>{ event.preventDefault(); canvas.setPointerCapture(event.pointerId); state.drawing=true; state.strokes.push([point(event)]); });
  canvas.addEventListener('pointermove',(event)=>{ if(!state.drawing)return; event.preventDefault(); const stroke=state.strokes.at(-1); const next=point(event); const previous=stroke.at(-1); stroke.push(next); context.beginPath(); context.moveTo(previous.x,previous.y); context.lineTo(next.x,next.y); context.stroke(); });
  const finish=()=>{ if(!state.drawing)return; const stroke=state.strokes.at(-1); if(stroke?.length===1){ context.beginPath(); context.arc(stroke[0].x,stroke[0].y,1.25,0,Math.PI*2); context.fillStyle='#1e2923'; context.fill(); } state.drawing=false; };
  canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish);
}
function clearSignature() { state.strokes=[]; if(state.context)state.context.clearRect(0,0,state.width,state.height); }
function idempotencyKey() {
  const key='engineering-contract-submit-'+state.signing.sessionId;
  let value=sessionStorage.getItem(key);
  if(!value){ value=crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(36).slice(2); sessionStorage.setItem(key,value); }
  return { key, value };
}
async function initialize() {
  state.token=readFragmentToken();
  if(!state.token){ show('簽署連結不完整，請回到工程 LINE 群組重新開啟。','error'); return; }
  if(!LIFF_ID){ show('LIFF 尚未設定，請聯繫工程 AM 管理員。','error'); return; }
  show('正在驗證 LINE 身分…');
  await liff.init({liffId:LIFF_ID});
  if(!liff.isLoggedIn()) { liff.login({redirectUri:location.origin+location.pathname}); return; }
  state.credential=liff.getAccessToken() || '';
  if(!state.credential) throw new Error('無法取得 LINE 身分憑證，請重新登入。');
  const opened=await api('${CONTRACT_SIGNING_OPEN_PATH}',{token:state.token,liffCredential:state.credential});
  state.signing=opened.signing;
  const documentLink=byId('document-link'); documentLink.href=state.signing.documentUrl; documentLink.hidden=false;
  byId('contract-state').textContent='合約已完成身分與版本驗證。請先開啟文件詳閱，再進行簽名。';
  byId('sign-panel').hidden=false;
  show('請先開啟合約文件詳閱。','ok');
  initCanvas();
}
byId('document-link').addEventListener('click',async(event)=>{
  event.preventDefault(); const target=window.open('about:blank','_blank'); if(target)target.opener=null;
  try{const response=await fetch(state.signing.documentUrl,{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},body:JSON.stringify({token:state.token,liffCredential:state.credential})});if(!response.ok){const failure=await response.json().catch(()=>({}));throw new Error(failure.error||'無法讀取合約文件');}const blob=await response.blob();const blobUrl=URL.createObjectURL(blob);if(target)target.location.replace(blobUrl);else location.href=blobUrl;state.reviewAcknowledged=true;byId('consent').disabled=false;byId('submit-signature').disabled=false;byId('review-state').textContent='已開啟合約文件；請詳閱後勾選同意簽署。';}catch(failure){if(target)target.close();show(failure.message||'無法讀取合約文件','error');}
});
byId('clear-signature').addEventListener('click',clearSignature);
byId('submit-signature').addEventListener('click',async()=>{
  const button=byId('submit-signature');
  if(!state.signing){ show('合約尚未完成驗證。','error'); return; }
  if(!state.reviewAcknowledged){ show('請先開啟合約文件詳閱。','error'); return; }
  if(!state.strokes.length){ show('請先在簽名框內簽名。','error'); return; }
  if(!byId('consent').checked){ show('請先勾選同意簽署。','error'); return; }
  const idem=idempotencyKey(); button.disabled=true; show('正在安全送出簽名…');
  try {
    const result=await api('${CONTRACT_SIGNING_SUBMIT_PATH}',{
      token:state.token,liffCredential:state.credential,idempotencyKey:idem.value,
      documentHash:state.signing.documentHash,signatureDataUrl:state.canvas.toDataURL('image/png'),
      reviewAcknowledged:true,consent:true
    });
    sessionStorage.removeItem(TOKEN_STORAGE_KEY); sessionStorage.removeItem(idem.key);
    byId('sign-panel').hidden=true; show(result.idempotent ? '簽名先前已安全送達，無需重複提交。' : '簽名已安全提交，請等待工程 AM 內部確認。','ok');
  } catch(failure) { button.disabled=false; show(failure.message || '送出失敗，請稍後再試。','error'); }
});
initialize().catch((failure)=>show(failure.message || '頁面初始化失敗，請稍後再試。','error'));
`;
}

export function renderContractSigningPage({ liffId, nonce = randomBytes(16).toString('base64url') } = {}) {
  const script = signingPageScript(requireText(liffId, 'liffId', 300));
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>工程合約線上簽署</title>
<style nonce="${nonce}">
:root{--green:#2e7d52;--ink:#22302a;--dim:#6b7a72;--line:#dfe7e2;--paper:#f4f7f5;--danger:#9f3e32}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;line-height:1.65;padding-bottom:calc(32px + env(safe-area-inset-bottom))}
header{background:var(--green);color:#fff;padding:16px max(16px,env(safe-area-inset-left));text-align:center}header small{display:block;opacity:.82;letter-spacing:.12em}header h1{font-size:19px;margin:3px 0 0}
main{width:min(100%,680px);margin:auto;padding:14px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 3px 14px rgba(34,48,42,.05)}
h2{font-size:15px;margin:0 0 8px}.hint{font-size:13px;color:var(--dim);margin:0}.message{min-height:48px;border-radius:10px;padding:12px 14px;background:#eef2f0;font-size:14px}.message.ok{background:#eaf6ee;color:#1f683e}.message.error{background:#fff0ed;color:var(--danger)}
.document-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:12px;border-radius:9px;background:#eef6f1;color:#1f683e;padding:9px 14px;font-weight:700;text-decoration:none}.signature-wrap{border:1px dashed #9aac9f;border-radius:10px;background:#fff;overflow:hidden;touch-action:none;margin:10px 0}canvas{display:block;width:100%;height:180px;touch-action:none}
.actions{display:flex;gap:9px}.button{min-height:46px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:10px 14px;font:inherit;font-weight:650}.button.primary{flex:1;background:var(--green);border-color:var(--green);color:#fff}.button:disabled{opacity:.55}.consent{display:flex;align-items:flex-start;gap:9px;font-size:13px;margin:14px 0}.consent input{width:20px;height:20px;flex:none;margin-top:2px}
@media(min-width:700px){main{padding:22px}.card{padding:20px}canvas{height:210px}}
</style>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js" nonce="${nonce}"></script>
</head>
<body>
<header><small>ENGINEERING AM</small><h1>工程合約線上簽署</h1></header>
<main>
  <section class="card"><h2>安全驗證</h2><div id="message" class="message">頁面載入中…</div></section>
  <section class="card"><h2>合約確認</h2><p id="contract-state" class="hint">完成 LINE 身分與群組資格驗證後，才會開放合約文件。</p><a id="document-link" class="document-button" href="#" target="_blank" rel="noopener noreferrer" hidden>開啟合約文件</a><p id="review-state" class="hint" aria-live="polite"></p></section>
  <section class="card" id="sign-panel" hidden>
    <h2>簽名</h2><p class="hint">請使用手指或滑鼠在下方簽名。簽名只會提交至受保護的工程 AM 儲存空間。</p>
    <div class="signature-wrap"><canvas id="signature" aria-label="簽名區"></canvas></div>
    <div class="actions"><button class="button" id="clear-signature" type="button">全部清除</button></div>
    <label class="consent"><input id="consent" type="checkbox" disabled><span>我已詳閱本工程合約及其附件，確認內容與版本無誤，並同意以本簽名完成簽署。</span></label>
    <button class="button primary" id="submit-signature" type="button" disabled>送出簽名</button>
  </section>
</main>
<script nonce="${nonce}">${script}</script>
</body></html>`;
}

export function createContractSigningWebHandler(options = {}) {
  const service = options.service;
  const saveSignature = options.saveSignature;
  if (!service || typeof service.openSigningRequest !== 'function' || typeof service.submitSignature !== 'function') {
    throw new Error('contract signing web service with openSigningRequest/submitSignature is required');
  }
  if (typeof saveSignature !== 'function') throw new Error('contract signing web saveSignature is required');
  const liffId = requireText(options.liffId, 'liffId', 300);
  const resolveDocumentUrl = typeof options.resolveDocumentUrl === 'function' ? options.resolveDocumentUrl : null;
  const loadDocument = typeof options.loadDocument === 'function' ? options.loadDocument : null;
  if (typeof loadDocument !== 'function') throw new Error('contract signing web loadDocument is required');
  const bodyLimit = positiveInteger(options.bodyLimit, DEFAULT_CONTRACT_SIGNING_BODY_LIMIT, 'bodyLimit');
  const signatureLimit = positiveInteger(options.signatureLimit, DEFAULT_SIGNATURE_DATA_LIMIT, 'signatureLimit');
  const logger = options.logger || console;
  const getRequestMeta = typeof options.getRequestMeta === 'function'
    ? options.getRequestMeta
    : (req) => ({ headers: req.headers || {}, remoteAddress: req.socket?.remoteAddress || '' });

  return async function handleContractSigningWebRequest(req, res, pathname, urlInput) {
    const url = urlInput instanceof URL ? urlInput : new URL(String(urlInput || req.url || '/'), 'http://localhost');
    const route = pathname || url.pathname;
    const isPage = route === CONTRACT_SIGNING_WEB_PATH;
    const isOpen = route === CONTRACT_SIGNING_OPEN_PATH;
    const isSubmit = route === CONTRACT_SIGNING_SUBMIT_PATH;
    const isDocument = route === CONTRACT_SIGNING_DOCUMENT_PATH;
    if (!isPage && !isOpen && !isSubmit && !isDocument) return false;
    const nonce = randomBytes(16).toString('base64url');
    try {
      if (isPage) {
        if (!['GET', 'HEAD'].includes(req.method)) throw error('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
        if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === 'token')) {
          throw error('TOKEN_QUERY_FORBIDDEN', '請使用工程 LINE 群組中的受保護簽署連結。', 400);
        }
        const html = renderContractSigningPage({ liffId, nonce });
        writeResponse(res, 200, webSecurityHeaders(nonce, 'text/html; charset=utf-8'), html, req.method === 'HEAD');
        return true;
      }
      if (req.method !== 'POST') throw error('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
      const body = await readJsonBody(req, bodyLimit);
      const token = requireText(body.token, 'token', 500);
      const liffCredential = requireText(body.liffCredential, 'liffCredential', 5000);
      const requestMeta = getRequestMeta(req);
      if (isDocument) {
        const opened = await service.openSigningRequest({ token, liffCredential, requestMeta });
        const document = await loadDocument(opened);
        if (!Buffer.isBuffer(document?.buffer) || document.contentType !== 'application/pdf') {
          throw error('DOCUMENT_STORAGE_FAILED', '合約文件目前無法開啟。', 502);
        }
        res.writeHead(200, {
          ...contractSigningSecurityHeaders(),
          'Content-Type': 'application/pdf',
          'Content-Length': String(document.buffer.length),
          'Content-Disposition': 'inline; filename="engineering-contract.pdf"',
        });
        res.end(document.buffer);
        return true;
      }
      if (isOpen) {
        const opened = await service.openSigningRequest({ token, liffCredential, requestMeta });
        const documentUrl = await resolvePublicDocumentUrl(opened, resolveDocumentUrl);
        sendJson(res, 200, { ok: true, signing: publicOpenPayload(opened, documentUrl) }, nonce);
        return true;
      }

      if (body.reviewAcknowledged !== true) throw error('REVIEW_ACKNOWLEDGEMENT_REQUIRED', '請先開啟並詳閱合約文件。', 400);
      if (body.consent !== true) throw error('CONSENT_REQUIRED', '請先確認同意簽署。', 400);
      const idempotencyKey = requireText(body.idempotencyKey, 'idempotencyKey', 500);
      const documentHash = requireText(body.documentHash, 'documentHash', 64).toLowerCase();
      if (!SHA256_PATTERN.test(documentHash)) throw error('INVALID_DOCUMENT_HASH', '合約版本雜湊格式不正確。', 400);
      const signature = decodeSignatureDataUrl(body.signatureDataUrl, signatureLimit);

      // Authenticate and bind the upload to the exact signing session and
      // document version before persisting signature evidence.
      const opened = await service.openSigningRequest({ token, liffCredential, requestMeta });
      if (String(opened.documentHash || '').toLowerCase() !== documentHash) {
        throw error('DOCUMENT_VERSION_MISMATCH', '合約版本已改變，請重新開啟簽署連結。', 409);
      }
      const sessionId = String(opened.sessionId || '').trim();
      if (!sessionId || sessionId.length > 500) {
        throw error('SIGNING_SESSION_INVALID', '簽署工作階段無效。', 500);
      }

      const saved = await saveSignature({
        sessionId,
        idempotencyKey,
        documentHash,
        reviewAcknowledged: true,
        contentType: signature.contentType,
        bytes: signature.bytes,
      });
      const signatureHash = String(saved?.hash || '').trim().toLowerCase();
      const submissionRef = String(saved?.ref || '').trim();
      if (!SHA256_PATTERN.test(signatureHash) || !submissionRef) {
        throw error('SIGNATURE_STORAGE_FAILED', '簽名儲存結果不完整。', 500);
      }
      const result = await service.submitSignature({
        token,
        liffCredential,
        idempotencyKey,
        documentHash,
        signatureHash,
        submissionRef,
        reviewAcknowledged: true,
        requestMeta,
      });
      sendJson(res, 200, { ok: true, signing: publicSubmitPayload(result) }, nonce);
      return true;
    } catch (failure) {
      const known = failure instanceof ContractSigningError;
      const status = known ? failure.status : 500;
      const code = known ? failure.code : 'INTERNAL_ERROR';
      const message = known ? failure.message : '簽署服務暫時無法使用，請稍後再試。';
      if (!known) logger?.error?.('contract signing web request failed', { route, code });
      sendJson(res, status, { ok: false, code, error: message }, nonce);
      return true;
    }
  };
}

export const __test = Object.freeze({ decodeSignatureDataUrl });

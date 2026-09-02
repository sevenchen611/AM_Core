import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ContractSigningError,
  contractSigningSecurityHeaders,
} from './contract-signing.js';

export const CONTRACT_SIGNING_WEB_PATH = '/contract-sign';
export const CONTRACT_SIGNING_OPEN_PATH = '/contract-sign/api/open';
export const CONTRACT_SIGNING_SUBMIT_PATH = '/contract-sign/api/submit';
export const CONTRACT_SIGNING_PARTY_A_SUBMIT_PATH = '/contract-sign/api/submit-party-a';
export const CONTRACT_SIGNING_DOCUMENT_PATH = '/contract-sign/api/document';
export const CONTRACT_SIGNING_PDF_JS_PATH = '/contract-sign/assets/pdf-5.4.624.min.mjs';
export const CONTRACT_SIGNING_PDF_WORKER_PATH = '/contract-sign/assets/pdf-worker-5.4.624.min.mjs';
export const DEFAULT_CONTRACT_SIGNING_BODY_LIMIT = 9 * 1024 * 1024;
export const DEFAULT_SIGNATURE_DATA_LIMIT = 320_000;
export const DEFAULT_IDENTITY_PHOTO_LIMIT = 3 * 1024 * 1024;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const PDF_VIEWER_ASSETS = new Map([
  [CONTRACT_SIGNING_PDF_JS_PATH, new URL('../../node_modules/pdfjs-dist/build/pdf.min.mjs', import.meta.url)],
  [CONTRACT_SIGNING_PDF_WORKER_PATH, new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)],
]);
const pdfViewerAssetCache = new Map();

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
  headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()';
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
    "worker-src 'self' blob:",
  ].join('; ');
  headers['Content-Type'] = contentType;
  return headers;
}

async function bundledPdfViewerAsset(route) {
  if (!PDF_VIEWER_ASSETS.has(route)) return null;
  if (!pdfViewerAssetCache.has(route)) {
    pdfViewerAssetCache.set(route, readFile(PDF_VIEWER_ASSETS.get(route)));
  }
  return pdfViewerAssetCache.get(route);
}

function javascriptAssetHeaders(byteSize) {
  return {
    ...contractSigningSecurityHeaders(),
    'Content-Type': 'text/javascript; charset=utf-8',
    'Content-Length': String(byteSize),
    'Cache-Control': 'public, max-age=86400, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
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

function decodeIdentityPhotoDataUrl(value, side, maxBytes) {
  const label = side === 'front' ? '身分證正面' : '身分證反面';
  const dataUrl = requireText(value, label, Math.ceil(maxBytes * 1.5) + 100);
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw error('INVALID_IDENTITY_PHOTO_FORMAT', `${label}必須是 PNG 或 JPEG 圖片。`, 400);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw error('IDENTITY_PHOTO_TOO_LARGE', `${label}圖片過大。`, 413);
  const isPng = match[1] === 'image/png'
    && bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === 'image/jpeg'
    && bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9;
  if (!isPng && !isJpeg) throw error('INVALID_IDENTITY_PHOTO_BYTES', `${label}圖片內容與格式不符。`, 400);
  return { bytes, contentType: match[1] };
}

function normalizeCounterpartyDetails(value) {
  const source = value && typeof value === 'object' ? value : {};
  const name = requireText(source.name, '乙方姓名', 100);
  const identityNumber = requireText(source.identityNumber, '乙方身分證字號', 30).toUpperCase().replace(/\s+/g, '');
  const address = requireText(source.address, '乙方住址', 300);
  if (!/^[A-Z0-9-]{6,30}$/.test(identityNumber)) {
    throw error('COUNTERPARTY_IDENTITY_NUMBER_INVALID', '乙方身分證字號格式不正確。', 400);
  }
  return { name, identityNumber, address };
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
  const canSignPartyB = result?.canSignPartyB === true || result?.canSign === true;
  const canSignPartyA = result?.canSignPartyA === true;
  const canSign = canSignPartyB;
  const canInspectSigning = result?.canInspectSigning === true;
  return {
    sessionId: String(result?.sessionId || ''),
    contractId: String(result?.contractId || ''),
    projectId: String(result?.projectId || ''),
    documentHash: String(result?.documentHash || ''),
    documentUrl,
    status: String(result?.status || ''),
    expiresAt: String(result?.expiresAt || ''),
    idempotent: result?.idempotent === true,
    canSign,
    canSignPartyB,
    canSignPartyA,
    partyARequired: result?.partyARequired === true,
    partyASigned: result?.partyASigned === true,
    canInspectSigning,
    signingRole: canSignPartyB ? 'party_b' : canSignPartyA ? 'party_a' : 'group_member',
    accessMode: canSignPartyB ? 'signer' : canSignPartyA ? 'party_a_signer'
      : canInspectSigning ? 'signer_inspection_read_only' : 'group_member_read_only',
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
const PDF_JS_URL = ${escapeScriptJson(CONTRACT_SIGNING_PDF_JS_PATH)};
const PDF_WORKER_URL = ${escapeScriptJson(CONTRACT_SIGNING_PDF_WORKER_PATH)};
const TOKEN_STORAGE_KEY = 'engineering-contract-sign-token';
const LOGIN_ATTEMPT_KEY = 'engineering-contract-sign-login-attempted';
const REVIEW_STORAGE_PREFIX = 'engineering-contract-document-reviewed:';
const state = { token:'', credential:'', signing:null, reviewAcknowledged:false, documentLoading:false, canvas:null, context:null, width:0, height:0, strokes:[], drawing:false, partyACanvas:null, partyAContext:null, partyAWidth:0, partyAHeight:0, partyAStrokes:[], partyADrawing:false };
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
  if (fromFragment) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, fromFragment);
    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
    // Remove only the secret fragment. LINE OAuth callback parameters in the
    // query string must remain available until liff.init() consumes them.
    history.replaceState(null, '', location.pathname+location.search);
  }
  return fromFragment || sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
}
function reviewStorageKey() {
  if(!state.signing?.sessionId||!state.signing?.documentHash)return '';
  return REVIEW_STORAGE_PREFIX+state.signing.sessionId+':'+state.signing.documentHash;
}
function setReviewAcknowledged(value,persist=true) {
  state.reviewAcknowledged=value===true;
  const key=reviewStorageKey();
  if(key&&persist){if(state.reviewAcknowledged)sessionStorage.setItem(key,'1');else sessionStorage.removeItem(key);}
  const enablePartyB=state.reviewAcknowledged&&state.signing?.canSignPartyB;
  const enablePartyA=state.reviewAcknowledged&&state.signing?.canSignPartyA&&!state.signing?.partyASigned;
  byId('consent').disabled=!enablePartyB;byId('submit-signature').disabled=!enablePartyB;
  byId('party-a-consent').disabled=!enablePartyA;byId('party-a-submit-signature').disabled=!enablePartyA;
  byId('signature').setAttribute('aria-disabled',enablePartyB?'false':'true');
  byId('party-a-signature').setAttribute('aria-disabled',enablePartyA?'false':'true');
  const note=byId('review-lock-note');
  note.textContent=state.reviewAcknowledged?'✓ 合約 PDF 已成功載入，可勾選確認並完成簽署。':'請先按上方「在本頁開啟完整合約 PDF」，成功載入後才會開放確認與送出。';
  note.className='review-lock-note '+(state.reviewAcknowledged?'ready':'');
}
function restoreReviewAcknowledgement(){const key=reviewStorageKey();setReviewAcknowledged(Boolean(key&&sessionStorage.getItem(key)==='1'),false);}
function initCanvas() {
  const canvas=byId('signature'); const ratio=Math.min(devicePixelRatio || 1,2);
  const width=canvas.clientWidth || 320; const height=canvas.clientHeight || 180;
  canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
  const context=canvas.getContext('2d'); context.scale(ratio,ratio);
  context.strokeStyle='#1e2923'; context.lineWidth=2.5; context.lineCap='round'; context.lineJoin='round';
  state.canvas=canvas; state.context=context; state.width=width; state.height=height;
  const point=(event)=>{ const rect=canvas.getBoundingClientRect(); return {x:event.clientX-rect.left,y:event.clientY-rect.top}; };
  canvas.addEventListener('pointerdown',(event)=>{ event.preventDefault(); if(!state.reviewAcknowledged){show('請先在本頁開啟並詳閱合約 PDF。','error');return;} canvas.setPointerCapture(event.pointerId); state.drawing=true; state.strokes.push([point(event)]); });
  canvas.addEventListener('pointermove',(event)=>{ if(!state.drawing)return; event.preventDefault(); const stroke=state.strokes.at(-1); const next=point(event); const previous=stroke.at(-1); stroke.push(next); context.beginPath(); context.moveTo(previous.x,previous.y); context.lineTo(next.x,next.y); context.stroke(); });
  const finish=()=>{ if(!state.drawing)return; const stroke=state.strokes.at(-1); if(stroke?.length===1){ context.beginPath(); context.arc(stroke[0].x,stroke[0].y,1.25,0,Math.PI*2); context.fillStyle='#1e2923'; context.fill(); } state.drawing=false; };
  canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish);
}
function clearSignature() { state.strokes=[]; if(state.context)state.context.clearRect(0,0,state.width,state.height); }
function initPartyACanvas() {
  const canvas=byId('party-a-signature'); const ratio=Math.min(devicePixelRatio || 1,2);
  const width=canvas.clientWidth || 320; const height=canvas.clientHeight || 180;
  canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio);
  const context=canvas.getContext('2d'); context.scale(ratio,ratio);
  context.strokeStyle='#1e2923'; context.lineWidth=2.5; context.lineCap='round'; context.lineJoin='round';
  state.partyACanvas=canvas; state.partyAContext=context; state.partyAWidth=width; state.partyAHeight=height;
  const point=(event)=>{ const rect=canvas.getBoundingClientRect(); return {x:event.clientX-rect.left,y:event.clientY-rect.top}; };
  canvas.addEventListener('pointerdown',(event)=>{ event.preventDefault(); if(!state.reviewAcknowledged){show('請先在本頁開啟並詳閱合約 PDF。','error');return;} canvas.setPointerCapture(event.pointerId); state.partyADrawing=true; state.partyAStrokes.push([point(event)]); });
  canvas.addEventListener('pointermove',(event)=>{ if(!state.partyADrawing)return; event.preventDefault(); const stroke=state.partyAStrokes.at(-1); const next=point(event); const previous=stroke.at(-1); stroke.push(next); context.beginPath(); context.moveTo(previous.x,previous.y); context.lineTo(next.x,next.y); context.stroke(); });
  const finish=()=>{ if(!state.partyADrawing)return; const stroke=state.partyAStrokes.at(-1); if(stroke?.length===1){ context.beginPath(); context.arc(stroke[0].x,stroke[0].y,1.25,0,Math.PI*2); context.fillStyle='#1e2923'; context.fill(); } state.partyADrawing=false; };
  canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish);
}
function clearPartyASignature() { state.partyAStrokes=[]; if(state.partyAContext)state.partyAContext.clearRect(0,0,state.partyAWidth,state.partyAHeight); }
function enableSigningInspection() {
  const panel=byId('sign-panel'); panel.hidden=false; panel.classList.add('inspection-mode');
  byId('inspection-banner').hidden=false;
  byId('signature-inspection-label').hidden=false;
  byId('document-warning').textContent='PDF 僅供閱讀。下方會顯示指定簽署人看到的相同簽署區，供你協助確認位置；檢查模式不能輸入、上傳、簽名或送出。';
  ['counterparty-name','counterparty-identity-number','counterparty-address','identity-front','identity-back','clear-signature','consent','submit-signature'].forEach((id)=>{
    const node=byId(id); node.disabled=true; node.setAttribute('aria-disabled','true');
  });
  byId('signature').setAttribute('aria-disabled','true');
  byId('submit-signature').textContent='檢查模式不可送出';
  if(state.signing.partyARequired){
    const partyAPanel=byId('party-a-sign-panel'); partyAPanel.hidden=false; partyAPanel.classList.add('inspection-mode');
    byId('party-a-inspection-banner').hidden=false; byId('party-a-signature-inspection-label').hidden=false;
    ['party-a-clear-signature','party-a-consent','party-a-submit-signature'].forEach((id)=>{const node=byId(id);node.disabled=true;node.setAttribute('aria-disabled','true');});
    byId('party-a-signature').setAttribute('aria-disabled','true'); byId('party-a-submit-signature').textContent='檢查模式不可送出';
  }
}
async function identityPhotoDataUrl(inputId,label) {
  const file=byId(inputId).files?.[0];
  if(!file)throw new Error('請提供'+label+'照片。');
  if(file.size>12*1024*1024)throw new Error(label+'原始照片過大，請改用 12 MB 以下圖片。');
  let bitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw new Error(label+'無法讀取，請改用 JPG 或 PNG 照片。');}
  const maxSide=2000;const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d',{alpha:false});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const dataUrl=canvas.toDataURL('image/jpeg',0.88);
  if(dataUrl.length>4.2*1024*1024)throw new Error(label+'壓縮後仍過大，請降低照片解析度後再試。');
  return dataUrl;
}
function identitySelected(inputId,stateId,label){const file=byId(inputId).files?.[0];byId(stateId).textContent=file?'✓ 已選擇'+label+'：'+file.name:'尚未選擇';}
function idempotencyKey(role='party-b') {
  const key='engineering-contract-submit-'+role+'-'+state.signing.sessionId;
  let value=sessionStorage.getItem(key);
  if(!value){ value=crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(36).slice(2); sessionStorage.setItem(key,value); }
  return { key, value };
}
async function renderPdfInPage(bytes) {
  const panel=byId('document-reader-panel');const pages=byId('document-pages');const status=byId('document-load-state');
  panel.hidden=false;pages.textContent='';status.textContent='正在載入安全 PDF 閱讀器…';
  const pdfjs=await import(PDF_JS_URL);pdfjs.GlobalWorkerOptions.workerSrc=PDF_WORKER_URL;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo+=1){
    status.textContent='正在顯示合約 PDF：第 '+pageNo+'／'+pdf.numPages+' 頁';
    const page=await pdf.getPage(pageNo);const base=page.getViewport({scale:1});
    const available=Math.max(280,(pages.clientWidth||document.documentElement.clientWidth||320)-16);
    const viewport=page.getViewport({scale:available/base.width});const ratio=Math.min(devicePixelRatio||1,2);
    const wrapper=document.createElement('section');wrapper.className='pdf-page';wrapper.setAttribute('aria-label','合約 PDF 第 '+pageNo+' 頁');
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(viewport.width*ratio));canvas.height=Math.max(1,Math.round(viewport.height*ratio));canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    wrapper.appendChild(canvas);pages.appendChild(wrapper);
    const context=canvas.getContext('2d',{alpha:false});
    await page.render({canvasContext:context,viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
  }
  status.textContent='✓ 完整合約 PDF 已載入，共 '+pdf.numPages+' 頁。';
}
function protectedExternalUrl(){return location.origin+location.pathname+'#token='+encodeURIComponent(state.token);}
function openInExternalBrowser(){
  if(!state.token){show('簽署連結不完整，請回到工程 LINE 群組重新開啟。','error');return;}
  if(globalThis.liff?.isInClient?.()){liff.openWindow({url:protectedExternalUrl(),external:true});return;}
  show('目前已在外部瀏覽器中。','ok');
}
async function initialize() {
  state.token=readFragmentToken();
  if(!state.token){ show('簽署連結不完整，請回到工程 LINE 群組重新開啟。','error'); return; }
  if(!LIFF_ID){ show('LIFF 尚未設定，請聯繫工程 AM 管理員。','error'); return; }
  show('正在驗證 LINE 身分…');
  await liff.init({liffId:LIFF_ID});
  if(!liff.isLoggedIn()) {
    if(sessionStorage.getItem(LOGIN_ATTEMPT_KEY)==='1') {
      byId('contract-state').textContent='LINE 登入沒有完成，系統已停止自動重新登入。請關閉此頁，再從原工程 LINE 群組的合約訊息重新開啟。';
      show('LINE 登入未完成，已停止自動重試，避免重複跳轉。','error');
      return;
    }
    sessionStorage.setItem(LOGIN_ATTEMPT_KEY,'1');
    liff.login({redirectUri:location.origin+location.pathname});
    return;
  }
  sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
  // liff.init() has now consumed the OAuth callback. Remove its transient
  // query parameters only after authentication has been restored.
  if(location.search) history.replaceState(null, '', location.pathname);
  state.credential=liff.getAccessToken() || '';
  if(!state.credential) throw new Error('無法取得 LINE 身分憑證，請重新登入。');
  const opened=await api('${CONTRACT_SIGNING_OPEN_PATH}',{token:state.token,liffCredential:state.credential});
  state.signing=opened.signing;
  byId('document-link').hidden=false;
  byId('external-browser').hidden=!liff.isInClient();
  if(state.signing.canSignPartyB){
    byId('contract-state').textContent='你是本合約指定的乙方簽署人。請先開啟文件詳閱，再進行簽名。';
    byId('sign-panel').hidden=false;
    show('已驗證乙方指定簽署人身分，請先開啟合約文件詳閱。','ok');
    initCanvas();
  }else if(state.signing.canSignPartyA){
    byId('contract-state').textContent=state.signing.partyASigned?'你是本合約指定的個人甲方簽署人，甲方簽名已完成。':'你是本合約指定的個人甲方簽署人。請先開啟文件詳閱，再於甲方簽名區簽名。';
    byId('party-a-sign-panel').hidden=false;
    if(state.signing.partyASigned){
      ['party-a-clear-signature','party-a-consent','party-a-submit-signature'].forEach((id)=>byId(id).disabled=true);
      byId('party-a-submit-signature').textContent='甲方已完成簽名';
      show('甲方簽名先前已安全送達，無需重複提交。','ok');
    }else{
      show('已驗證個人甲方指定簽署人身分，請先開啟合約文件詳閱。','ok');
      initPartyACanvas();
    }
  }else if(state.signing.canInspectSigning){
    byId('contract-state').textContent='你已進入簽署檢查模式，可查看甲乙雙方指定簽署人會看到的完整簽署版面；只有各方指定簽署人可以操作與送出。';
    enableSigningInspection();
    show('已驗證群組成員身分，目前為簽署檢查模式（唯讀）。','ok');
  }else{
    byId('contract-state').textContent='你是此工程 LINE 群組成員，可以檢視完整合約；只有指定簽署人可以填寫資料與簽署。';
    show('已驗證群組成員身分，目前為唯讀檢視。','ok');
  }
  restoreReviewAcknowledgement();
}
byId('external-browser').addEventListener('click',openInExternalBrowser);
byId('document-link').addEventListener('click',async()=>{
  if(state.documentLoading)return;state.documentLoading=true;const button=byId('document-link');button.disabled=true;show('正在安全載入完整合約 PDF…');
  try{const response=await fetch(state.signing.documentUrl,{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'},body:JSON.stringify({token:state.token,liffCredential:state.credential})});if(!response.ok){const failure=await response.json().catch(()=>({}));throw new Error(failure.error||'無法讀取合約文件');}const bytes=await response.arrayBuffer();await renderPdfInPage(bytes);setReviewAcknowledged(true);byId('review-state').textContent=state.signing.canSignPartyB?'完整合約已在本頁載入。詳閱後請填寫資料、上傳證件並簽名。':state.signing.canSignPartyA?'完整合約已在本頁載入。詳閱後請在甲方大簽名格完成本次簽名。':'完整合約已在本頁載入，可向下逐頁檢視。';button.textContent='重新載入完整合約 PDF';show('完整合約 PDF 已成功載入，請詳閱後完成簽署。','ok');}catch(failure){show(failure.message||'無法讀取合約文件','error');}finally{state.documentLoading=false;button.disabled=false;}
});
byId('clear-signature').addEventListener('click',clearSignature);
byId('party-a-clear-signature').addEventListener('click',clearPartyASignature);
byId('identity-front').addEventListener('change',()=>identitySelected('identity-front','identity-front-state','正面'));
byId('identity-back').addEventListener('change',()=>identitySelected('identity-back','identity-back-state','反面'));
byId('submit-signature').addEventListener('click',async()=>{
  const button=byId('submit-signature');
  if(!state.signing){ show('合約尚未完成驗證。','error'); return; }
  if(!state.signing.canSignPartyB){ show('目前帳號不是乙方指定簽署人，不能代替乙方送出。','error'); return; }
  if(!state.reviewAcknowledged){ show('請先開啟合約文件詳閱。','error'); return; }
  const counterpartyName=byId('counterparty-name').value.trim();
  const counterpartyIdentityNumber=byId('counterparty-identity-number').value.trim().toUpperCase().replace(/\s+/g,'');
  const counterpartyAddress=byId('counterparty-address').value.trim();
  if(!counterpartyName||!counterpartyIdentityNumber||!counterpartyAddress){ show('請完整填寫乙方姓名、身分證字號與住址。','error'); return; }
  if(!state.strokes.length){ show('請先在簽名框內簽名。','error'); return; }
  if(!byId('identity-front').files?.[0]||!byId('identity-back').files?.[0]){ show('請先提供身分證正面與反面照片。','error'); return; }
  if(!byId('consent').checked){ show('請先勾選同意簽署。','error'); return; }
  const idem=idempotencyKey('party-b'); button.disabled=true; show('正在處理身分證照片並安全送出…');
  try {
    const frontDataUrl=await identityPhotoDataUrl('identity-front','身分證正面');
    const backDataUrl=await identityPhotoDataUrl('identity-back','身分證反面');
    const result=await api('${CONTRACT_SIGNING_SUBMIT_PATH}',{
      token:state.token,liffCredential:state.credential,idempotencyKey:idem.value,
      documentHash:state.signing.documentHash,signatureDataUrl:state.canvas.toDataURL('image/png'),
      counterpartyDetails:{name:counterpartyName,identityNumber:counterpartyIdentityNumber,address:counterpartyAddress},
      identityDocuments:{frontDataUrl,backDataUrl},
      reviewAcknowledged:true,consent:true
    });
    const reviewKey=reviewStorageKey();sessionStorage.removeItem(TOKEN_STORAGE_KEY);sessionStorage.removeItem(idem.key);if(reviewKey)sessionStorage.removeItem(reviewKey);
    byId('sign-panel').hidden=true; show(result.idempotent ? '簽名先前已安全送達，無需重複提交。' : '簽名已安全提交，請等待工程 AM 內部確認。','ok');
  } catch(failure) { button.disabled=false; show(failure.message || '送出失敗，請稍後再試。','error'); }
});
byId('party-a-submit-signature').addEventListener('click',async()=>{
  const button=byId('party-a-submit-signature');
  if(!state.signing){ show('合約尚未完成驗證。','error'); return; }
  if(!state.signing.canSignPartyA){ show('目前帳號不是個人甲方指定簽署人，不能代替甲方送出。','error'); return; }
  if(state.signing.partyASigned){ show('甲方簽名先前已安全送達，無需重複提交。','ok'); return; }
  if(!state.reviewAcknowledged){ show('請先開啟合約文件詳閱。','error'); return; }
  if(!state.partyAStrokes.length){ show('請先在甲方簽名框內簽名。','error'); return; }
  if(!byId('party-a-consent').checked){ show('請先勾選個人甲方本次簽署確認。','error'); return; }
  const idem=idempotencyKey('party-a'); button.disabled=true; show('正在安全送出個人甲方簽名…');
  try {
    const result=await api('${CONTRACT_SIGNING_PARTY_A_SUBMIT_PATH}',{
      token:state.token,liffCredential:state.credential,idempotencyKey:idem.value,
      documentHash:state.signing.documentHash,signatureDataUrl:state.partyACanvas.toDataURL('image/png'),
      reviewAcknowledged:true,consent:true
    });
    const reviewKey=reviewStorageKey();sessionStorage.removeItem(TOKEN_STORAGE_KEY);sessionStorage.removeItem(idem.key);if(reviewKey)sessionStorage.removeItem(reviewKey);
    byId('party-a-sign-panel').hidden=true; show(result.idempotent ? '甲方簽名先前已安全送達，無需重複提交。' : '個人甲方簽名已安全提交，請等待乙方簽署及工程 AM 內部確認。','ok');
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
.document-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.document-button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:1px solid #cfe1d6;border-radius:9px;background:#eef6f1;color:#1f683e;padding:10px 14px;font:inherit;font-weight:700;text-align:center}.document-button.secondary{background:#fff;color:var(--ink)}.document-button:disabled{opacity:.55}.document-warning{margin-top:12px;border:1px solid #e8c779;border-radius:10px;background:#fff8e6;color:#6b5017;padding:11px 12px;font-size:13px;font-weight:650}.review-lock-note{margin:12px 0 0;border-radius:9px;background:#fff0ed;color:var(--danger);padding:10px 12px;font-size:13px;font-weight:700}.review-lock-note.ready{background:#eaf6ee;color:#1f683e}.document-reader{padding:10px}.document-load-state{position:sticky;top:0;z-index:2;margin:0 0 10px;border-radius:8px;background:#1f683e;color:#fff;padding:9px 11px;font-size:13px;font-weight:700}.document-pages{display:grid;gap:12px}.pdf-page{overflow:hidden;border:1px solid #cad6cf;border-radius:7px;background:#fff;box-shadow:0 3px 10px rgba(34,48,42,.12)}.pdf-page canvas{display:block;max-width:100%;height:auto;margin:auto}.inspection-banner{margin-bottom:14px;border:1px solid #e0ad3f;border-radius:10px;background:#fff7df;color:#6b5017;padding:11px 12px;font-size:14px;font-weight:700}.signature-heading{margin-top:18px}.signature-instruction{border-radius:10px;background:#eaf6ee;color:#1f683e;padding:11px 12px;font-size:14px;font-weight:700}.signature-wrap{position:relative;height:clamp(320px,48vh,480px);border:2px solid var(--green);border-radius:12px;background:linear-gradient(#fff,#fbfdfc);overflow:hidden;touch-action:none;margin:12px 0;box-shadow:inset 0 0 0 1px rgba(46,125,82,.08)}.signature-wrap canvas{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair}.signature-inspection-label{position:absolute;z-index:1;inset:50% auto auto 50%;transform:translate(-50%,-50%);width:82%;border:1px dashed #a97718;border-radius:10px;background:rgba(255,247,223,.94);color:#6b5017;padding:12px;text-align:center;font-size:14px;font-weight:800;pointer-events:none}.inspection-mode input:disabled,.inspection-mode textarea:disabled{opacity:1;background:#f2f4f3;color:#69766f}.inspection-mode .signature-wrap{border-style:dashed;border-color:#a97718;background:#f7f8f7}.inspection-mode .signature-wrap canvas{pointer-events:none;cursor:not-allowed}
.actions{display:flex;gap:9px}.button{min-height:46px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:10px 14px;font:inherit;font-weight:650}.button.primary{flex:1;background:var(--green);border-color:var(--green);color:#fff}.button:disabled{opacity:.55}.consent{display:flex;align-items:flex-start;gap:10px;font-size:13px;margin:14px 0;padding:8px 2px;cursor:pointer}.consent input{width:24px;height:24px;flex:none;margin-top:1px;accent-color:var(--green)}.consent input:disabled{cursor:not-allowed}
.identity-grid{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0}.identity-upload{border:1px dashed #9aac9f;border-radius:10px;padding:12px;background:#fbfdfc}.identity-upload label{display:block;font-weight:700;font-size:14px}.identity-upload input{display:block;width:100%;margin-top:8px}.identity-state{font-size:12px;color:var(--dim);margin-top:6px}.privacy-note{border-radius:10px;background:#f5f1e8;color:#5c4b2c;padding:11px 12px;font-size:12px;margin-top:10px}
.party-fields{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0}.party-fields label{display:block;font-weight:700;font-size:14px}.party-fields input,.party-fields textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;border:1px solid var(--line);border-radius:9px;padding:11px 12px;background:#fff;color:var(--ink);font:inherit}.party-fields textarea{min-height:76px;resize:vertical}.required-note{font-size:12px;color:#991b1b;margin-top:6px}
@media(min-width:700px){main{padding:22px}.card{padding:20px}.signature-wrap{height:380px}}
</style>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js" nonce="${nonce}"></script>
</head>
<body>
<header><small>ENGINEERING AM</small><h1>工程合約線上簽署</h1></header>
<main>
  <section class="card"><h2>安全驗證</h2><div id="message" class="message">頁面載入中…</div></section>
  <section class="card"><h2>合約確認</h2><p id="contract-state" class="hint">完成 LINE 身分與群組資格驗證後，才會開放合約文件。</p><div class="document-warning" id="document-warning">PDF 僅供閱讀，請勿在 PDF 閱讀器內使用畫筆簽名。請按下方按鈕，系統會直接在本頁顯示完整合約；詳閱後再於大簽名格完成正式簽署。</div><div class="document-actions"><button id="document-link" class="document-button" type="button" hidden>在本頁開啟完整合約 PDF</button><button id="external-browser" class="document-button secondary" type="button" hidden>在外部瀏覽器開啟簽署頁</button></div><p id="review-state" class="hint" aria-live="polite"></p><p id="review-lock-note" class="review-lock-note">請先完成安全驗證並在本頁開啟完整合約 PDF。</p></section>
  <section class="card document-reader" id="document-reader-panel" hidden><p id="document-load-state" class="document-load-state" aria-live="polite">準備載入完整合約 PDF…</p><div id="document-pages" class="document-pages"></div></section>
  <section class="card" id="sign-panel" hidden>
    <div class="inspection-banner" id="inspection-banner" hidden>簽署檢查模式（唯讀）：這裡與指定簽署人的版面相同，但你不能填寫、上傳、簽名或送出，也不會產生任何簽署紀錄。</div>
    <h2>乙方簽約資料</h2><p class="hint">以下三項會直接寫入電子簽署完成版合約，請依本人證件完整填寫。</p>
    <div class="party-fields">
      <label for="counterparty-name">乙方姓名（必填）<input id="counterparty-name" name="counterpartyName" autocomplete="name" maxlength="100" required></label>
      <label for="counterparty-identity-number">身分證字號（必填）<input id="counterparty-identity-number" name="counterpartyIdentityNumber" inputmode="text" autocomplete="off" maxlength="30" required></label>
      <label for="counterparty-address">住址（必填）<textarea id="counterparty-address" name="counterpartyAddress" autocomplete="street-address" maxlength="300" required></textarea></label>
    </div>
    <p class="required-note">姓名、身分證字號或住址缺少任一項，系統將不允許送出簽署。</p>
    <h2>承包人身分證件</h2><p class="hint">正式簽署前，請提供本人身分證正面與反面清晰照片，兩張缺一不可。</p>
    <div class="identity-grid">
      <div class="identity-upload"><label for="identity-front">身分證正面</label><input id="identity-front" type="file" accept="image/jpeg,image/png" capture="environment"><div id="identity-front-state" class="identity-state">尚未選擇</div></div>
      <div class="identity-upload"><label for="identity-back">身分證反面</label><input id="identity-back" type="file" accept="image/jpeg,image/png" capture="environment"><div id="identity-back-state" class="identity-state">尚未選擇</div></div>
    </div>
    <div class="privacy-note">證件影像僅供本工程合約的當事人身分確認、履約管理及爭議處理，儲存在工程 AM 私有簽署證據區，不會出現在草約頁、LINE 訊息或合約 PDF 內。若不同意電子提供，請聯繫工程人員改採書面核驗方式。</div>
    <h2 class="signature-heading">正式簽名</h2><div class="signature-instruction">請直接在下面整個大格內簽名，不必對準 PDF 裡的小框，也不要在 PDF 閱讀器的畫筆工具中簽名。</div><p class="hint">簽名只會提交至受保護的工程 AM 儲存空間，並自動帶入合約及本票。</p>
    <div class="signature-wrap"><div class="signature-inspection-label" id="signature-inspection-label" hidden>對方要在這個大框內直接簽名</div><canvas id="signature" aria-label="大尺寸正式簽名區"></canvas></div>
    <div class="actions"><button class="button" id="clear-signature" type="button">清除並重新簽名</button></div>
    <label class="consent"><input id="consent" type="checkbox" disabled><span>我已詳閱本工程合約及其附件，確認內容與版本無誤；我確認上述乙方資料正確，同意將其寫入簽署完成版合約，也同意依上述用途提供身分證正反面影像，並同意以本簽名完成簽署。</span></label>
    <button class="button primary" id="submit-signature" type="button" disabled>送出簽名</button>
  </section>
  <section class="card" id="party-a-sign-panel" hidden>
    <div class="inspection-banner" id="party-a-inspection-banner" hidden>簽署檢查模式（唯讀）：這是個人甲方指定簽署人會看到的甲方簽名區，只有指定的甲方 LINE 帳號可以簽名與送出。</div>
    <h2>個人甲方正式簽名</h2>
    <div class="signature-instruction">甲方請在下面整個大格內簽名。此簽名只適用於這一份凍結合約，不會存成日後可重複使用的簽名檔。</div>
    <p class="hint">甲方不需填寫乙方資料或上傳乙方證件；系統會以 LINE 身分、群組資格、合約版本雜湊及本次同意紀錄綁定簽署證據。</p>
    <div class="signature-wrap"><div class="signature-inspection-label" id="party-a-signature-inspection-label" hidden>個人甲方要在這個大框內直接簽名</div><canvas id="party-a-signature" aria-label="個人甲方大尺寸正式簽名區"></canvas></div>
    <div class="actions"><button class="button" id="party-a-clear-signature" type="button">清除並重新簽名</button></div>
    <label class="consent"><input id="party-a-consent" type="checkbox" disabled><span>我是本合約指定的個人甲方，已詳閱本工程合約及其附件，確認內容與版本無誤，並同意以本次簽名完成甲方簽署。</span></label>
    <button class="button primary" id="party-a-submit-signature" type="button" disabled>送出甲方簽名</button>
  </section>
</main>
<script nonce="${nonce}">${script}</script>
</body></html>`;
}

export function createContractSigningWebHandler(options = {}) {
  const service = options.service;
  const saveSignature = options.saveSignature;
  if (!service || typeof service.openSigningRequest !== 'function' || typeof service.submitSignature !== 'function'
      || typeof service.submitPartyASignature !== 'function') {
    throw new Error('contract signing web service with openSigningRequest/submitSignature/submitPartyASignature is required');
  }
  if (typeof saveSignature !== 'function') throw new Error('contract signing web saveSignature is required');
  const liffId = requireText(options.liffId, 'liffId', 300);
  const resolveDocumentUrl = typeof options.resolveDocumentUrl === 'function' ? options.resolveDocumentUrl : null;
  const loadDocument = typeof options.loadDocument === 'function' ? options.loadDocument : null;
  if (typeof loadDocument !== 'function') throw new Error('contract signing web loadDocument is required');
  const bodyLimit = positiveInteger(options.bodyLimit, DEFAULT_CONTRACT_SIGNING_BODY_LIMIT, 'bodyLimit');
  const signatureLimit = positiveInteger(options.signatureLimit, DEFAULT_SIGNATURE_DATA_LIMIT, 'signatureLimit');
  const identityPhotoLimit = positiveInteger(options.identityPhotoLimit, DEFAULT_IDENTITY_PHOTO_LIMIT, 'identityPhotoLimit');
  const saveIdentityDocuments = options.saveIdentityDocuments;
  if (typeof saveIdentityDocuments !== 'function') throw new Error('contract signing web saveIdentityDocuments is required');
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
    const isPartyASubmit = route === CONTRACT_SIGNING_PARTY_A_SUBMIT_PATH;
    const isDocument = route === CONTRACT_SIGNING_DOCUMENT_PATH;
    const isPdfViewerAsset = PDF_VIEWER_ASSETS.has(route);
    if (!isPage && !isOpen && !isSubmit && !isPartyASubmit && !isDocument && !isPdfViewerAsset) return false;
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
      if (isPdfViewerAsset) {
        if (!['GET', 'HEAD'].includes(req.method)) throw error('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
        const asset = await bundledPdfViewerAsset(route);
        writeResponse(res, 200, javascriptAssetHeaders(asset.length), asset, req.method === 'HEAD');
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
      if (isPartyASubmit) {
        const opened = await service.openSigningRequest({ token, liffCredential, requestMeta });
        if (opened?.canSignPartyA !== true) {
          throw error('PARTY_A_SIGNER_MISMATCH', '目前 LINE 帳號不是本合約指定的個人甲方簽署人。', 403);
        }
        if (String(opened.documentHash || '').toLowerCase() !== documentHash) {
          throw error('DOCUMENT_VERSION_MISMATCH', '合約版本已改變，請重新開啟簽署連結。', 409);
        }
        const sessionId = String(opened.sessionId || '').trim();
        if (!sessionId || sessionId.length > 500) {
          throw error('SIGNING_SESSION_INVALID', '簽署工作階段無效。', 500);
        }
        const saved = await saveSignature({
          sessionId,
          idempotencyKey: `party-a:${idempotencyKey}`,
          documentHash,
          reviewAcknowledged: true,
          contentType: signature.contentType,
          bytes: signature.bytes,
          role: 'party_a',
        });
        const signatureHash = String(saved?.hash || '').trim().toLowerCase();
        const submissionRef = String(saved?.ref || '').trim();
        if (!SHA256_PATTERN.test(signatureHash) || !submissionRef) {
          throw error('SIGNATURE_STORAGE_FAILED', '甲方簽名儲存結果不完整。', 500);
        }
        const result = await service.submitPartyASignature({
          token, liffCredential, idempotencyKey, documentHash, signatureHash, submissionRef,
          signatureByteSize: signature.bytes.length, signatureContentType: signature.contentType,
          reviewAcknowledged: true, consent: true, requestMeta,
        });
        sendJson(res, 200, { ok: true, signing: publicSubmitPayload(result) }, nonce);
        return true;
      }
      const counterpartyDetails = normalizeCounterpartyDetails(body.counterpartyDetails);
      const identityFront = decodeIdentityPhotoDataUrl(body.identityDocuments?.frontDataUrl, 'front', identityPhotoLimit);
      const identityBack = decodeIdentityPhotoDataUrl(body.identityDocuments?.backDataUrl, 'back', identityPhotoLimit);

      // Authenticate and bind the upload to the exact signing session and
      // document version before persisting signature evidence.
      const opened = await service.openSigningRequest({ token, liffCredential, requestMeta });
      if (opened?.canSign !== true) {
        throw error('SIGNER_MISMATCH', '目前 LINE 帳號不是指定簽署人，只能檢視合約。', 403);
      }
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
      const identityDocuments = await saveIdentityDocuments({
        sessionId,
        idempotencyKey,
        front: identityFront,
        back: identityBack,
      });
      for (const side of ['front', 'back']) {
        const item = identityDocuments?.[side];
        if (!SHA256_PATTERN.test(String(item?.hash || '')) || !String(item?.ref || '').trim()) {
          throw error('IDENTITY_DOCUMENT_STORAGE_FAILED', '身分證正反面儲存結果不完整。', 500);
        }
      }
      const result = await service.submitSignature({
        token,
        liffCredential,
        idempotencyKey,
        documentHash,
        signatureHash,
        submissionRef,
        counterpartyDetails,
        identityDocuments,
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

export const __test = Object.freeze({ decodeSignatureDataUrl, decodeIdentityPhotoDataUrl, normalizeCounterpartyDetails });

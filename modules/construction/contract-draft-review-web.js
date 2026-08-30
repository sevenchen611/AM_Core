import crypto from 'node:crypto';

import { createContractDraftReviewService } from './contract-draft-review.js';

const MAX_BODY_BYTES = 64 * 1024;

function nonce() { return crypto.randomUUID().replaceAll('-', ''); }
function html(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function headers(res, contentType, pageNonce = '') {
  const policy = pageNonce
    ? `default-src 'none'; script-src 'nonce-${pageNonce}'; style-src 'nonce-${pageNonce}'; img-src 'self' data: blob:; connect-src 'self'; frame-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
    : `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Security-Policy', policy);
}

function sendJson(res, statusCode, payload) {
  headers(res, 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('資料過大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('資料格式錯誤'), { statusCode: 400 }); }
}

function pageScript() {
  return `
const state={token:'',review:null,previewUrl:''};
const $=id=>document.getElementById(id);
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function show(message,error=false){$('message').textContent=message;$('message').className=error?'message error':'message';}
async function call(path,body){const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',body:JSON.stringify(body)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'操作失敗');return result.data;}
function categoryLabel(value){return ({contract_body:'合約本文',construction_drawing:'施工圖',quotation:'報價單',acceptance_attachment:'驗收附件',other:'其他附件'})[value]||'附件';}
function render(review){state.review=review;$('title').textContent=(review.contractNumber||'')+' '+(review.title||'工程合約草約');$('version').textContent='V'+review.versionNo+' 草約';$('missing').innerHTML=(review.missingSections||[]).length?'尚待雙方確認：'+review.missingSections.map(esc).join('、'):'目前五項資料均已具備，仍以最後正式簽署版為準。';const list=$('attachment-files');list.replaceChildren();(review.attachments||[]).forEach(item=>{const button=document.createElement('button');button.className='secondary';button.textContent='單獨開啟｜'+categoryLabel(item.category)+'：'+item.name;button.addEventListener('click',()=>openDocument('attachment',item.id));list.append(button);});$('content').hidden=false;if(['no_changes','changes_requested'].includes(review.status)){$('response-form').hidden=true;$('completed').hidden=false;$('completed').textContent=review.status==='no_changes'?'已回覆：目前暫無修改意見':'已回覆：已提出修改意見';}}
async function fetchDocument(kind,attachmentId=''){const query=new URLSearchParams({kind});if(attachmentId!=='')query.set('attachment',attachmentId);const response=await fetch('/contract-review/api/document?'+query.toString(),{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',body:JSON.stringify({token:state.token})});if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'無法開啟文件');}return response.blob();}
async function loadPreview(){try{show('正在載入合約與附件內容…');const blob=await fetchDocument('draft');if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=URL.createObjectURL(blob);$('draft-preview').src=state.previewUrl;$('draft-preview').hidden=false;show('合約與附件已完整載入，請逐頁檢查。');}catch(error){show(error.message,true);}}
async function openReview(){state.token=new URLSearchParams(location.hash.slice(1)).get('token')||'';history.replaceState(null,'',location.pathname);if(!state.token)throw new Error('草約審閱連結不完整');const review=await call('/contract-review/api/open',{token:state.token});render(review);await loadPreview();}
async function openDocument(kind,attachmentId=''){const target=window.open('about:blank','_blank');try{const blob=await fetchDocument(kind,attachmentId);target.location.replace(URL.createObjectURL(blob));}catch(error){if(target)target.close();show(error.message,true);}}
async function submit(){const reviewerName=$('reviewer-name').value.trim();const decision=document.querySelector('input[name=decision]:checked')?.value||'';const notes=$('notes').value.trim();if(!reviewerName)return show('請填寫回覆人姓名。',true);if(!decision)return show('請選擇審閱結果。',true);if(decision==='changes_requested'&&notes.length<2)return show('請填寫希望修改的內容。',true);if(!$('ack').checked)return show('請確認這只是草約意見，不是正式簽署。',true);$('submit').disabled=true;try{const review=await call('/contract-review/api/respond',{token:state.token,reviewerName,decision,notes});render(review);show('意見已送回工程 AM。');}catch(error){$('submit').disabled=false;show(error.message,true);}}
$('draft-pdf').addEventListener('click',()=>openDocument('draft'));
$('submit').addEventListener('click',submit);
openReview().catch(error=>show(error.message,true));`;
}

function renderPage() {
  const pageNonce = nonce();
  return { pageNonce, body: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>工程合約草約審閱</title><style nonce="${pageNonce}">
*{box-sizing:border-box}body{margin:0;background:#f4f7f5;color:#24322b;font-family:system-ui,'Noto Sans TC',sans-serif}.bar{background:#216942;color:#fff;padding:16px 20px;font-weight:800}.wrap{max-width:980px;margin:24px auto;padding:0 14px}.card{background:#fff;border:1px solid #dce5df;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 4px 16px #153b2610}.draft{border:2px solid #dc2626;background:#fff7f7;color:#991b1b}.draft h1{font-size:22px;margin:0 0 8px}.badge{display:inline-block;background:#fee2e2;color:#991b1b;border-radius:999px;padding:5px 10px;font-weight:800}.hint{color:#617269;font-size:14px;line-height:1.7}.files{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}button{font:inherit;border:0;border-radius:10px;padding:11px 15px;cursor:pointer;background:#287c52;color:#fff;font-weight:700}button.secondary{background:#eaf3ee;color:#225c40}button:disabled{opacity:.5}.preview{width:100%;height:72vh;min-height:560px;border:1px solid #bdccc3;border-radius:10px;margin-top:14px;background:#eef2f0}label{display:block;margin:12px 0;font-weight:700}input[type=text],textarea{display:block;width:100%;margin-top:6px;border:1px solid #bdccc3;border-radius:10px;padding:11px;font:inherit}textarea{min-height:120px;resize:vertical}.choice{font-weight:500;border:1px solid #dce5df;border-radius:10px;padding:11px}.message{padding:12px;border-radius:10px;background:#eaf3ee;color:#225c40}.message.error{background:#fee2e2;color:#991b1b}.complete{background:#ecfdf5;color:#166534;padding:14px;border-radius:10px;font-weight:800}@media(max-width:640px){.preview{height:65vh;min-height:440px}.files button{width:100%}}
</style></head><body><div class="bar">📑 工程 AM｜草約審閱</div><main class="wrap"><section class="card draft"><span class="badge">草約｜不得簽署</span><h1 id="title">工程合約草約</h1><p id="version"></p><p>本頁僅供閱覽與提出修改意見，不是正式簽署程序；任何閱覽或回覆均不構成簽約、承諾或電子簽章。</p></section><div id="message" class="message">正在驗證草約連結…</div><div id="content" hidden><section class="card"><h2>合約與附件完整預覽</h2><p id="missing" class="hint"></p><p class="hint">合約本文、施工圖與報價單會依序合併顯示；下方也可分別開啟原始附件核對。</p><div class="files"><button id="draft-pdf">在新分頁開啟完整合併草約</button></div><iframe id="draft-preview" class="preview" title="合約與附件完整預覽" hidden></iframe><h3>原始附件</h3><div id="attachment-files" class="files"></div></section><section id="response-form" class="card"><h2>提供意見</h2><label>回覆人姓名<input id="reviewer-name" type="text" maxlength="240" autocomplete="name"></label><label class="choice"><input type="radio" name="decision" value="no_changes"> 已閱覽，目前暫無修改意見，仍以最後正式簽署版為準</label><label class="choice"><input type="radio" name="decision" value="changes_requested"> 有修改意見</label><label>修改內容<textarea id="notes" maxlength="8000" placeholder="請註明條款、段落或希望調整的內容"></textarea></label><label class="choice"><input id="ack" type="checkbox"> 我了解這只是草約意見回覆，不是正式簽署或同意締約。</label><button id="submit">送出意見</button></section><div id="completed" class="complete" hidden></div></div></main><script nonce="${pageNonce}">${pageScript()}</script></body></html>` };
}

export function createContractDraftReviewWebHandler(deps) {
  const service = createContractDraftReviewService(deps);
  return async function handle(req, res, pathname) {
    try {
      if (req.method === 'GET' && pathname === '/contract-review') {
        const page = renderPage(); headers(res, 'text/html; charset=utf-8', page.pageNonce); res.statusCode = 200; res.end(page.body); return true;
      }
      if (req.method === 'POST' && pathname === '/contract-review/api/open') {
        return sendJson(res, 200, { ok: true, data: await service.openReview(deps.tenant, await readJson(req), req) }) || true;
      }
      if (req.method === 'POST' && pathname === '/contract-review/api/respond') {
        return sendJson(res, 200, { ok: true, data: await service.respond(deps.tenant, await readJson(req), req) }) || true;
      }
      if (req.method === 'POST' && pathname === '/contract-review/api/document') {
        const query = new URL(req.url, 'https://local.invalid').searchParams;
        const requestedKind = query.get('kind');
        const kind = requestedKind === 'source' ? 'source' : (requestedKind === 'attachment' ? 'attachment' : 'draft');
        const input = await readJson(req); input.attachmentId = query.get('attachment') || '';
        const document = await service.loadDocument(deps.tenant, input, kind);
        headers(res, document.mimeType || 'application/octet-stream');
        const inline = kind === 'draft' || /^(application\/pdf|image\/png|image\/jpeg)$/i.test(document.mimeType || '');
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(document.fileName)}`);
        res.setHeader('Content-Length', String(document.buffer.length));
        res.statusCode = 200; res.end(document.buffer); return true;
      }
      return false;
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      sendJson(res, status, { ok: false, error: status >= 500 ? '草約審閱服務暫時無法使用' : String(error.message || '操作失敗') });
      return true;
    }
  };
}

export const __test = { renderPage, pageScript };

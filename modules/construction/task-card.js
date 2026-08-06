// 工程待辦的行動版任務卡。
// LINE 提醒直接開 /task?tenant=<key>&doc=<page>,不需進 Notion 或先穿過工程後臺。
// 任務建立來由、處理紀錄、狀態與圖片均寫回該工程租戶自己的 Notion 任務頁。

import { plain, sameId, pageName, sendJson, parseScope, assertProjectInScope } from './common.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_REQUEST_BYTES = 34 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function handleTaskCardRequest(req, res, pathname, url, deps) {
  const scope = parseScope(url);
  try {
    if (req.method === 'GET' && pathname === '/task') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderTaskCardPage(deps.tenantKey, url.searchParams.get('doc') || ''));
    }
    if (req.method === 'GET' && pathname === '/task/api/card') {
      return sendJson(res, 200, await buildTaskCard(deps, url.searchParams.get('page'), scope));
    }
    if (req.method === 'POST' && pathname === '/task/api/update') {
      const body = await readJsonBodyLimited(req, MAX_REQUEST_BYTES);
      return sendJson(res, 200, await updateTaskCard(deps, body, scope));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Task card error:', error);
    return sendJson(res, Number(error.statusCode) || 500, { error: error.message || '處理失敗' });
  }
}

async function buildTaskCard(deps, pageId, scope) {
  const task = await loadTaskPage(deps, pageId, scope);
  const p = task.properties || {};
  const projectId = p['專案']?.relation?.[0]?.id || '';
  const schema = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.tasks)}`, { method: 'GET' });
  const statusOptions = (schema.properties?.['狀態']?.select?.options || []).map((option) => option.name);
  const blocks = await listBlockChildren(deps, task.id);
  const history = blocks.map(normalizeHistoryBlock).filter(Boolean);
  let sourceEvidence = plain(p['來源證據']?.rich_text);
  // 早期會議待辦將來源證據寫在任務內文，沒有同步到欄位。
  // 卡片自動辨識這種舊資料，放回「任務來由」，並避免在處理時間軸重複。
  if (!sourceEvidence) {
    const evidenceIndex = history.findIndex((block) => /^來源證據\s*[:：]/.test(historyBlockText(block)));
    if (evidenceIndex >= 0) {
      sourceEvidence = historyBlockText(history[evidenceIndex]).replace(/^來源證據\s*[:：]\s*/, '');
      history.splice(evidenceIndex, 1);
    }
  }
  const origin = await resolveTaskOrigin(deps, task, sourceEvidence);

  return {
    id: task.id,
    title: plain(p['內容']?.title) || '未命名任務',
    status: p['狀態']?.select?.name || '',
    statusOptions,
    owner: plain(p['負責人']?.rich_text),
    due: p['期限']?.date?.start || '',
    source: p['來源']?.select?.name || '',
    sourceEvidence,
    origin,
    project: projectId ? await pageName(deps, projectId) : '',
    createdAt: task.created_time || '',
    updatedAt: task.last_edited_time || '',
    history,
  };
}

async function resolveTaskOrigin(deps, task, sourceEvidence) {
  const properties = task.properties || {};
  const meetingUrl = sourceUrl(sourceEvidence);
  const meetingRelationId = properties['會議記錄']?.relation?.[0]?.id || '';
  const meetingId = meetingRelationId || meetingIdFromUrl(meetingUrl);
  const groupRelationId = properties['負責群組']?.relation?.[0]?.id || '';
  const legacyGroupId = sourceLineGroupId(sourceEvidence);
  const groupPage = await resolveGroupPage(deps, groupRelationId, legacyGroupId);
  const groupMeetingsDataSource = plain(groupPage?.properties?.['會議資料庫']?.rich_text);
  if (groupMeetingsDataSource && deps.registerTenantDataSource && deps.tenant) {
    try {
      await deps.registerTenantDataSource(deps.tenant, groupMeetingsDataSource);
    } catch (error) {
      console.warn(`Task origin meeting data source registration failed: ${error.message}`);
    }
  }
  // Engineering meetings may live in a per-group data source rather than the
  // tenant's central meetings data source. Dynamic registration above verifies
  // that source before the tenant-scoped page read is allowed.
  const meetingPage = await safeRelatedPage(deps, meetingId);

  const meeting = meetingId || meetingUrl ? {
    date: meetingPage?.properties?.['日期']?.date?.start
      || meetingPage?.properties?.['會議日期']?.date?.start
      || '',
    name: pageTitle(meetingPage) || '會議記錄',
    url: meetingUrl,
  } : null;
  const groupName = pageTitle(groupPage);
  const lineGroup = groupName
    ? { name: groupName }
    : (groupRelationId || legacyGroupId ? { name: '來源 LINE 群組（名稱尚未設定）' } : null);

  return {
    summary: sourceSummary(sourceEvidence),
    meeting,
    lineGroup,
  };
}

async function safeRelatedPage(deps, pageId, expectedDataSourceId) {
  if (!pageId) return null;
  try {
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
    if (expectedDataSourceId && !sameId(page.parent?.data_source_id, expectedDataSourceId)) return null;
    return page;
  } catch {
    return null;
  }
}

async function resolveGroupPage(deps, relationId, legacyGroupId) {
  const groupBindings = deps.dataSources.groupBindings;
  if (!groupBindings) return null;
  const related = await safeRelatedPage(deps, relationId, groupBindings);
  if (related || !legacyGroupId) return related;
  try {
    const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(groupBindings)}/query`, {
      method: 'POST',
      body: {
        filter: { property: 'LINE 群組 ID', rich_text: { equals: legacyGroupId } },
        page_size: 1,
      },
    });
    return result.results?.[0] || null;
  } catch {
    return null;
  }
}

function pageTitle(page) {
  if (!page) return '';
  for (const property of Object.values(page.properties || {})) {
    if (property.type === 'title') return plain(property.title);
  }
  return '';
}

function sourceUrl(value) {
  return String(value || '').match(/https?:\/\/[^\s；;]+/i)?.[0]?.replace(/[)）\]}>,，。]+$/, '') || '';
}

function meetingIdFromUrl(value) {
  return String(value || '').match(/\/m\/([0-9a-f]{32})(?:-|[/?#]|$)/i)?.[1] || '';
}

function sourceLineGroupId(value) {
  return String(value || '').match(/LINE\s*群組\s*[:：]\s*([^；;\s]+)/i)?.[1] || '';
}

function sourceSummary(value) {
  return String(value || '')
    .split(/[；;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^會議記錄\s*[:：]/.test(part) && !/^LINE\s*群組\s*[:：]/i.test(part))
    .join('\n');
}

async function updateTaskCard(deps, body, scope) {
  const task = await loadTaskPage(deps, body?.page, scope);
  const p = task.properties || {};
  const oldStatus = p['狀態']?.select?.name || '';
  const requestedStatus = String(body?.status ?? oldStatus).trim();
  const note = String(body?.note || '').trim();
  const imageInputs = Array.isArray(body?.images) ? body.images : [];
  const schema = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.tasks)}`, { method: 'GET' });
  const statusOptions = (schema.properties?.['狀態']?.select?.options || []).map((option) => option.name);

  if (requestedStatus && !statusOptions.includes(requestedStatus)) throw httpError(400, '無效的任務狀態。');
  if (!note && !imageInputs.length && requestedStatus === oldStatus) throw httpError(400, '請填寫本次處理紀錄、附上圖片，或變更狀態。');
  if (requestedStatus === '完成' && !note) throw httpError(400, '將任務設為完成時，必須填寫完成結果。');
  if (note.length > 4000) throw httpError(400, '處理紀錄不得超過 4,000 字。');

  const images = decodeImages(imageInputs);
  const uploaded = [];
  for (const image of images) {
    const file = await deps.uploadFileToNotion(image.buffer, image.name, image.type);
    uploaded.push({ id: file.id, name: image.name });
  }

  const actor = String(deps.actor || '網頁使用者').trim() || '網頁使用者';
  const stamp = taipeiStamp();
  const children = [{
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: richText(`[處理紀錄] ${stamp}｜${actor}`) },
  }];
  const statusLine = requestedStatus !== oldStatus ? `狀態：${oldStatus || '未設定'} → ${requestedStatus}` : `狀態：${oldStatus || '未設定'}（未變更）`;
  children.push(...paragraphBlocks(`${statusLine}${note ? `\n${note}` : ''}`));
  for (const file of uploaded) {
    children.push({
      object: 'block',
      type: 'image',
      image: {
        type: 'file_upload',
        file_upload: { id: file.id },
        caption: richText(file.name),
      },
    });
  }

  await deps.notionRequest(`/v1/blocks/${encodeURIComponent(task.id)}/children`, {
    method: 'PATCH',
    body: { children },
  });
  if (requestedStatus !== oldStatus) {
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      body: { properties: { '狀態': { select: requestedStatus ? { name: requestedStatus } : null } } },
    });
  }

  return { ok: true, status: requestedStatus, imageCount: uploaded.length, recordedAt: stamp };
}

async function loadTaskPage(deps, pageId, scope) {
  if (!pageId) throw httpError(400, '缺少任務編號。');
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  if (!sameId(page.parent?.data_source_id, deps.dataSources.tasks)) throw httpError(404, '找不到這張任務卡。');
  const projectId = page.properties?.['專案']?.relation?.[0]?.id || '';
  if (scope) {
    if (!projectId) throw httpError(403, '您沒有權限查看此任務。');
    await assertProjectInScope(deps, scope, projectId);
  }
  return page;
}

async function listBlockChildren(deps, blockId) {
  const results = [];
  let cursor = '';
  do {
    const suffix = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '';
    const response = await deps.notionRequest(`/v1/blocks/${encodeURIComponent(blockId)}/children?page_size=100${suffix}`, { method: 'GET' });
    results.push(...(response.results || []));
    cursor = response.has_more ? response.next_cursor : '';
  } while (cursor && results.length < 500);
  return results;
}

function normalizeHistoryBlock(block) {
  if (block.type === 'image') {
    const image = block.image || {};
    return {
      id: block.id,
      type: 'image',
      url: image.file?.url || image.external?.url || '',
      caption: plain(image.caption),
    };
  }
  const value = block[block.type];
  if (!value?.rich_text) return null;
  const spans = value.rich_text.map((item) => ({ text: item.plain_text || '', href: item.href || '' }));
  if (!spans.some((span) => span.text)) return null;
  return { id: block.id, type: block.type, checked: Boolean(value.checked), spans };
}

function historyBlockText(block) {
  return (block?.spans || []).map((span) => span.text || '').join('');
}

function decodeImages(inputs) {
  if (inputs.length > MAX_IMAGES) throw httpError(400, `一次最多上傳 ${MAX_IMAGES} 張圖片。`);
  const output = [];
  let total = 0;
  for (const item of inputs) {
    const type = String(item?.type || '').toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) throw httpError(400, '只支援 JPG、PNG、WebP 與 GIF 圖片。');
    const base64 = String(item?.data || '');
    if (!base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) throw httpError(413, '單張圖片不得超過 8 MB。');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw httpError(413, '單張圖片不得超過 8 MB。');
    total += buffer.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw httpError(413, '單次上傳圖片總計不得超過 24 MB。');
    const fallback = `task-${Date.now()}-${output.length + 1}.${extensionFor(type)}`;
    const name = safeFilename(item?.name, fallback);
    output.push({ type, name, buffer });
  }
  return output;
}

function extensionFor(type) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'jpg';
}

function safeFilename(value, fallback) {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 120);
  return cleaned || fallback;
}

function richText(content) {
  return [{ type: 'text', text: { content: String(content).slice(0, 1900) } }];
}

function paragraphBlocks(content) {
  const value = String(content || '');
  const blocks = [];
  for (let start = 0; start < value.length || (start === 0 && !value); start += 1900) {
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(value.slice(start, start + 1900)) } });
  }
  return blocks;
}

function taipeiStamp() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJsonBodyLimited(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, '上傳內容過大。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, '無效的請求內容。');
  }
}

export function renderTaskCardPage(tenantKey, initialDoc = '') {
  const tenant = JSON.stringify(tenantKey);
  const doc = JSON.stringify(initialDoc);
  const tenantQs = encodeURIComponent(tenantKey);
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#285f48">
<title>工程任務卡</title>
<style>
:root{--green:#285f48;--green2:#3f7d61;--pale:#edf5f0;--bg:#f3f5f3;--card:#fff;--line:#dce4df;--ink:#1f2c26;--dim:#69776f;--red:#a03e33;--gold:#9a6b22;--shadow:0 8px 24px rgba(34,58,46,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;line-height:1.6;padding-bottom:40px}
header{background:linear-gradient(135deg,var(--green),#1e4937);color:#fff;padding:16px 18px 28px}header .brand{font-size:13px;color:#d6e8de}header h1{font-size:20px;line-height:1.35;margin:8px 0 0;word-break:break-word}
main{width:min(720px,100%);margin:-14px auto 0;padding:0 12px}.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px;margin-bottom:12px}
.meta{display:flex;flex-wrap:wrap;gap:7px}.chip{display:inline-flex;align-items:center;border-radius:999px;background:#edf1ef;padding:3px 10px;color:#516058;font-size:12px}.chip.status{background:var(--pale);color:var(--green);font-weight:700}.chip.overdue{background:#fbe9e7;color:var(--red)}
h2{font-size:16px;margin:0 0 10px}.label{display:block;color:var(--dim);font-size:12px;font-weight:700;margin-bottom:5px}.origin{word-break:break-word;font-size:14px}.source-list{display:grid;gap:10px}.source-item{border:1px solid #e0e8e3;border-radius:11px;background:#fafcfb;padding:11px 12px}.source-kind{color:var(--dim);font-size:12px;font-weight:700;margin-bottom:2px}.source-title{font-weight:750;color:var(--ink)}.source-link{display:inline-block;margin-top:5px;color:var(--green);font-weight:700;text-decoration:none}.source-link:hover{text-decoration:underline}.source-summary{white-space:pre-wrap}.muted{color:var(--dim);font-size:13px}
.timeline{border-left:2px solid #cfe0d7;margin-left:7px;padding-left:16px}.event{position:relative;padding:4px 0 13px;white-space:pre-wrap;word-break:break-word;font-size:14px}.event::before{content:'';position:absolute;left:-22px;top:12px;width:10px;height:10px;background:var(--green2);border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #bfd3c7}.event.heading_3{font-weight:750;color:var(--green);padding-top:10px}.event.image{white-space:normal}.event img{display:block;width:100%;max-height:520px;object-fit:contain;background:#eef1ef;border:1px solid var(--line);border-radius:12px}.caption{font-size:12px;color:var(--dim);margin-top:4px}.event a{color:var(--green);word-break:break-all}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}label.field{display:block;font-size:13px;font-weight:700;color:#4c5a52}select,textarea,input[type=file],button{font:inherit}select,textarea{width:100%;margin-top:5px;border:1px solid #bccbc2;border-radius:10px;background:#fff;padding:10px;color:var(--ink)}textarea{min-height:130px;resize:vertical;line-height:1.6}.help{font-size:12px;color:var(--dim);margin-top:5px}.upload{border:1px dashed #a8bdb1;border-radius:12px;background:#fafcfb;padding:12px;margin-top:12px}.upload input{display:block;width:100%}.previews{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.preview{position:relative;aspect-ratio:1;background:#edf1ef;border-radius:9px;overflow:hidden}.preview img{width:100%;height:100%;object-fit:cover}.preview button{position:absolute;right:4px;top:4px;border:0;border-radius:999px;width:25px;height:25px;background:#000a;color:#fff;padding:0}
.save{width:100%;margin-top:14px;border:0;border-radius:11px;background:var(--green);color:#fff;font-weight:750;padding:13px;cursor:pointer}.save:disabled{opacity:.55;cursor:wait}.result{display:none;margin-top:10px;border-radius:10px;padding:10px 12px;font-size:13px}.result.show{display:block;background:#e9f5ee;color:#24553f}.result.error{background:#fbe9e7;color:#8d352d}
.backend{display:flex;justify-content:center;padding:8px 0}.backend a{color:var(--green);font-size:13px;text-decoration:none;border:1px solid #b9cbc1;border-radius:9px;padding:8px 12px;background:#fff}
@media(max-width:520px){header{padding:14px 14px 26px}main{padding:0 9px}.panel{border-radius:14px;padding:14px}.form-grid{grid-template-columns:1fr}.previews{grid-template-columns:repeat(2,1fr)}textarea{min-height:150px}}
</style>
</head>
<body>
<header><div class="brand">🐌 葉小蝸工程 AM</div><h1 id="title">任務卡載入中…</h1></header>
<main>
  <section class="panel"><div class="meta" id="meta"></div></section>
  <section class="panel"><h2>📌 任務來由</h2><div class="origin" id="origin">載入中…</div></section>
  <section class="panel"><h2>🗂️ 處理過程</h2><div class="timeline" id="history"><div class="muted">載入中…</div></div></section>
  <section class="panel" id="update-panel">
    <h2>✍️ 新增處理紀錄</h2>
    <div class="form-grid">
      <label class="field">新的任務狀態<select id="status"></select></label>
      <div><span class="label">紀錄人</span><div class="muted">使用目前 AM Portal 登入身分自動紀錄</div></div>
    </div>
    <label class="field" style="margin-top:12px">本次更新／完成結果
      <textarea id="note" maxlength="4000" placeholder="例：已完成現場檢查，確認……；檔案放在……；尚待……"></textarea>
    </label>
    <div class="help">設為「完成」時必須填寫完成結果。</div>
    <div class="upload">
      <label class="field">📷 附上圖片（最多 6 張，單張 8 MB）
        <input id="images" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
      </label>
      <div class="previews" id="previews"></div>
    </div>
    <button class="save" id="save">💾 儲存本次更新</button>
    <div class="result" id="result"></div>
  </section>
  <div class="backend"><a href="/dashboard?tenant=${tenantQs}">需要時前往工程後臺 ↗</a></div>
</main>
<script>
const TENANT=${tenant};
const PAGE=${doc};
const MAX_FILE=8*1024*1024;
let task=null;
let selectedFiles=[];
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmt(value){if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value).slice(0,16):new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:value.includes('T')?'short':undefined}).format(d)}
function safeLink(href){if(!href)return '';try{const u=new URL(href,location.origin);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
function renderSpans(spans){return (spans||[]).map(s=>{const text=esc(s.text);const href=safeLink(s.href);return href?'<a href="'+esc(href)+'" target="_blank" rel="noopener">'+text+'</a>':text}).join('')}
function renderHistory(items){if(!items.length)return '<div class="muted">尚無處理紀錄。本次更新後會從這裡開始保留。</div>';return items.map(item=>{if(item.type==='image'&&item.url)return '<div class="event image"><a href="'+esc(item.url)+'" target="_blank" rel="noopener"><img src="'+esc(item.url)+'" alt="'+esc(item.caption||'處理照片')+'"></a><div class="caption">'+esc(item.caption||'處理照片')+'</div></div>';const prefix=item.type==='to_do'?(item.checked?'☑ ':'☐ '):'';return '<div class="event '+esc(item.type)+'">'+prefix+renderSpans(item.spans)+'</div>'}).join('')}
function renderOrigin(origin){const rows=[];const o=origin||{};if(o.meeting){const date=(o.meeting.date||'').slice(0,10);const name=o.meeting.name||'會議記錄';const link=safeLink(o.meeting.url);rows.push('<div class="source-item"><div class="source-kind">會議記錄</div><div class="source-title">'+(date?esc(date)+'｜':'')+esc(name)+'</div>'+(link?'<a class="source-link" href="'+esc(link)+'" target="_blank" rel="noopener">開啟完整會議記錄 ↗</a>':'<div class="muted">原始會議連結尚未建立</div>')+'</div>')}if(o.lineGroup?.name)rows.push('<div class="source-item"><div class="source-kind">LINE 群組</div><div class="source-title">'+esc(o.lineGroup.name)+'</div></div>');if(o.summary)rows.push('<div class="source-item source-summary">'+esc(o.summary)+'</div>');return rows.length?'<div class="source-list">'+rows.join('')+'</div>':'<span class="muted">此任務尚未填寫來源證據。</span>'}
async function load(){
 if(!PAGE){showResult('缺少任務編號。',true);return}
 const r=await fetch('/task/api/card?tenant='+encodeURIComponent(TENANT)+'&page='+encodeURIComponent(PAGE));
 const d=await r.json();if(!r.ok)throw new Error(d.error||'載入失敗');task=d;
 document.title=d.title+' · 工程任務卡';document.getElementById('title').textContent=d.title;
 const due=(d.due||'').slice(0,10);const overdue=due&&due<new Date().toISOString().slice(0,10)&&!['完成','取消'].includes(d.status);
 document.getElementById('meta').innerHTML='<span class="chip status">'+esc(d.status||'未設定')+'</span>'+(d.owner?'<span class="chip">👤 '+esc(d.owner)+'</span>':'')+(due?'<span class="chip '+(overdue?'overdue':'')+'">📅 '+esc(due)+'</span>':'')+(d.project?'<span class="chip">📁 '+esc(d.project)+'</span>':'')+(d.source?'<span class="chip">來源 '+esc(d.source)+'</span>':'');
 document.getElementById('origin').innerHTML=renderOrigin(d.origin);
 document.getElementById('history').innerHTML=renderHistory(d.history||[]);
 const opts=(d.statusOptions||[]).filter(Boolean);if(d.status&&!opts.includes(d.status))opts.unshift(d.status);
 document.getElementById('status').innerHTML=opts.map(o=>'<option '+(o===d.status?'selected':'')+'>'+esc(o)+'</option>').join('');
}
function showResult(message,error=false){const el=document.getElementById('result');el.className='result show'+(error?' error':'');el.textContent=message}
function renderPreviews(){const box=document.getElementById('previews');box.innerHTML='';selectedFiles.forEach((file,i)=>{const item=document.createElement('div');item.className='preview';const img=document.createElement('img');img.src=URL.createObjectURL(file);img.onload=()=>URL.revokeObjectURL(img.src);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.onclick=()=>{selectedFiles.splice(i,1);renderPreviews()};item.append(img,remove);box.append(item)})}
document.getElementById('images').addEventListener('change',event=>{const incoming=Array.from(event.target.files||[]);for(const file of incoming){if(selectedFiles.length>=6){showResult('一次最多上傳 6 張圖片。',true);break}if(file.size>MAX_FILE){showResult(file.name+' 超過 8 MB。',true);continue}selectedFiles.push(file)}event.target.value='';renderPreviews()});
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('無法讀取 '+file.name));reader.readAsDataURL(file)})}
document.getElementById('save').addEventListener('click',async()=>{
 const button=document.getElementById('save');const status=document.getElementById('status').value;const note=document.getElementById('note').value.trim();
 if(status==='完成'&&!note){showResult('請先填寫完成結果。',true);return}
 if(!note&&!selectedFiles.length&&status===task.status){showResult('請填寫處理紀錄、附上圖片，或變更狀態。',true);return}
 if(status==='完成'&&!confirm('確定已完成此任務，並將下方內容作為完成結果？'))return;
 button.disabled=true;button.textContent='儲存中…';
 try{
   const images=[];for(const file of selectedFiles)images.push({name:file.name,type:file.type,data:await fileData(file)});
   const r=await fetch('/task/api/update?tenant='+encodeURIComponent(TENANT),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:PAGE,status,note,images})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||'儲存失敗');
   showResult('✅ 已儲存本次更新'+(d.imageCount?'，包含 '+d.imageCount+' 張圖片':'')+'。');selectedFiles=[];renderPreviews();document.getElementById('note').value='';await load();
 }catch(error){showResult('❌ '+error.message,true)}finally{button.disabled=false;button.textContent='💾 儲存本次更新'}
});
load().catch(error=>{document.getElementById('title').textContent='無法開啟任務';document.getElementById('origin').textContent=error.message;document.getElementById('history').innerHTML='';document.getElementById('update-panel').style.display='none'});
</script>
</body></html>`;
}

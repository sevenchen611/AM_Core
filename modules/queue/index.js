// AM Platform 模組:queue(確認佇列 — 通用部分)
// ─────────────────────────────────────────────────────────────────────────
// PM 的「確認佇列」網頁 + API:待確認/已確認列表、照片縮圖代理、把訊息掛載到
//   空間/工項、佇列內新增工項、選專案掛載(總管群跨專案)、雙向連帶掛載相鄰照片、
//   批次確認高信心、把 LINE 回覆/複驗照片掛到既有回饋單。
//   確認瞬間把附件搬進 Drive 四層正式目錄(專案/空間/工項/日期)。
//
// 從 BuildAM src/queue.js 抽出,只搬「通用佇列」——不含「開單/單據狀態邏輯」
//   (回饋單開立、變更單、核准/銷項/催辦…那些屬 construction 模組)。
//   本模組「掛到回饋單」是把訊息掛上『既有』單據(mount),屬佇列;
//   「開立回饋單」(create)則委派給 construction 提供的 platform.createFeedbackTicket。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(所有租戶相同):notionRequest / pushLineMessage / Drive 助手 / Portal 授權。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」:自己的 Notion 資料源、Drive 根資料夾。
//   - 模組狀態(名稱/館別代碼快取)一律以租戶為鍵,不同租戶不互相污染。
//   - web routes 走 core 的 Portal 授權(pin cookie / hozo SSO);資料只讀該租戶 dataSources,
//     再依 ?scope= 做子專案 scope 過濾。

import { sendJson, readBody } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

// tenant-locked notionRequest(帶 tenantKey 讓 core 資料隔離守衛比對)
const nreq = (tenant, path, opts = {}) => platform.notionRequest(path, { ...opts, tenantKey: tenant.key });
const ds = (tenant) => tenant.dataSources || {};

// ── 純工具 ──────────────────────────────────────────────
const plain = (items) => (items || []).map((x) => x.plain_text || '').join('');

// 台北時間好讀格式:2026-07-07 11:15(單據內文顯示;Notion 日期欄位仍存 ISO)
function taipeiStamp(iso) {
  const t = iso ? Date.parse(iso) : Date.now();
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
const blueText = (content) => ({ type: 'text', text: { content: String(content) }, annotations: { color: 'blue' } });
const normalText = (content) => ({ type: 'text', text: { content: String(content) } });

// 頁面標題名稱快取:Notion page id 全域唯一,跨租戶共用安全。
const nameCache = new Map();
async function pageName(tenant, pageId, titleProperty) {
  if (nameCache.has(pageId)) return nameCache.get(pageId);
  try {
    const page = await nreq(tenant, `/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
    let name = '';
    for (const [prop, value] of Object.entries(page.properties || {})) {
      if (value.type === 'title') { name = plain(value.title); break; }
      if (titleProperty && prop === titleProperty) name = plain(value.title);
    }
    nameCache.set(pageId, name);
    return name;
  } catch {
    return '';
  }
}

// ── 子專案 scope(per-tenant)──────────────────────────────
// null=全部;Set(館別代碼)=只看勾選的專案(由 ?scope= 帶入,對應 Portal 授權可見範圍)
function parseScope(url) {
  const raw = url.searchParams.get('scope');
  if (!raw || raw === 'all') return null;
  if (raw === 'none') return new Set();
  return new Set(raw.split(',').filter(Boolean));
}
// 專案 id → 館別代碼 快取(per-tenant,10 分鐘)
const projectCodeCache = new Map();
async function projectCodeMap(tenant) {
  const cached = projectCodeCache.get(tenant.key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.map;
  const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).projects)}/query`, {
    method: 'POST', body: { page_size: 100 },
  });
  const map = {};
  for (const page of result.results || []) {
    map[page.id] = plain(page.properties['館別代碼']?.rich_text);
  }
  projectCodeCache.set(tenant.key, { at: Date.now(), map });
  return map;
}
async function inScope(tenant, scope, projectId) {
  if (!scope) return true;
  if (!projectId) return false;
  const map = await projectCodeMap(tenant);
  return scope.has(map[projectId] || '');
}

async function bindingMeta(tenant, bindingId) {
  if (!bindingId) return null;
  // 授權資料不得做跨請求 TTL 快取；停用／撤權要在下一次請求立即生效。
  const page = await nreq(tenant, `/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
  return {
    id: page.id,
    status: page.properties?.['狀態']?.select?.name || '停用',
    role: page.properties?.['群組角色']?.select?.name || '',
    projectId: page.properties?.['專案']?.relation?.[0]?.id || '',
  };
}

async function bindingAllowed(tenant, access, bindingId, action = 'queue.read') {
  if (!bindingId) return Boolean(access?.can?.('unassigned.read'));
  const meta = await bindingMeta(tenant, bindingId);
  return Boolean(access?.can?.(action, bindingId, { status: meta?.status || '停用' }));
}

async function assertMessagePageAccess(tenant, access, page, action = 'queue.manage') {
  const bindingId = page?.properties?.['群組綁定']?.relation?.[0]?.id || '';
  if (bindingId) {
    const meta = await bindingMeta(tenant, bindingId);
    access.assert(action, bindingId, { status: meta?.status || '停用' });
  } else {
    access.assert('unassigned.manage');
  }
  return bindingId;
}

async function accessibleBindingSummary(tenant, access) {
  if (access?.isTenantAll) return { allProjects: true, projectIds: new Set() };
  const projectIds = new Set();
  let allProjects = false;
  for (const id of access?.groupBindingIds || []) {
    try {
      const meta = await bindingMeta(tenant, id);
      if (!access.can('queue.read', id, { status: meta?.status || '停用' })) continue;
      if (meta.role === '總管') allProjects = true;
      if (meta.projectId) projectIds.add(meta.projectId);
    } catch {}
  }
  return { allProjects, projectIds };
}

async function assertProjectAccess(tenant, access, projectId) {
  if (access?.isTenantAll) return true;
  const summary = await accessibleBindingSummary(tenant, access);
  if (summary.allProjects || summary.projectIds.has(projectId)) return true;
  throw Object.assign(new Error('找不到可存取的專案。'), { statusCode: 404 });
}

async function fallbackAccess(req, tenant, portal) {
  if (typeof portal?.resolveAccess === 'function') return portal.resolveAccess(req, tenant);
  const user = await portal?.userAuthed?.(req, tenant);
  const allowed = Boolean(user && (typeof portal?.tenantAuthorized === 'function' ? portal.tenantAuthorized(user, tenant) : true));
  return {
    user,
    allowed,
    actor: String(user?.displayName || user?.username || 'Portal 使用者'),
    isTenantAll: allowed,
    groupBindingIds: [],
    can: () => allowed,
    assert: () => { if (!allowed) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 }); },
  };
}

// ── 路由(routes handler)────────────────────────────────
// server.js 以 { prefix:'/queue', handler } 登記;此 handler 自行依 method+pathname 分派。
// ctx: { pathname, url, tenant, tenants, portal, platform }
async function handleQueueRequest(req, res, ctx) {
  const { pathname, url, tenant, portal } = ctx;
  if (!tenant) return sendJson(res, 400, { error: 'unknown tenant' });

  // 授權由 Core 統一完成；模組不提供日常 PIN 或自己的登入 cookie。
  const access = ctx.access || await fallbackAccess(req, tenant, portal);
  if (!access.allowed) {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  // 群組 relation 已是主要資料範圍；舊工程館別 suffix 不能把合法群組資料濾掉，也不能擴權。
  // 專案選單另由 accessibleBindingSummary 限縮。
  const scope = null;

  // 舊工程服務 API 名稱的短期相容層；307 保留原 method/body，實作仍由 construction 擁有。
  const legacyTicketRoutes = {
    '/queue/api/tickets': '/tickets/api/list',
    '/queue/api/change-orders': '/tickets/api/change-orders',
    '/queue/api/create-co': '/tickets/api/create-co',
    '/queue/api/ticket-action': '/tickets/api/action',
  };
  if (legacyTicketRoutes[pathname]) {
    res.writeHead(307, { Location: `${legacyTicketRoutes[pathname]}${url.search}` });
    return res.end();
  }
  try {
    if (req.method === 'GET' && pathname === '/queue') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderQueuePage(tenant, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/pending') {
      return sendJson(res, 200, await listMessages(tenant, ['AI初判待確認', '未掛載'], 100, scope, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/confirmed') {
      return sendJson(res, 200, await listMessages(tenant, ['已確認', '一般對話'], 30, scope, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/options') {
      const projectId = url.searchParams.get('project');
      if (!projectId) return sendJson(res, 400, { error: 'project required' });
      await assertProjectAccess(tenant, access, projectId);
      return sendJson(res, 200, await loadOptions(tenant, projectId, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/projects') {
      return sendJson(res, 200, await listProjects(tenant, scope, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/trades') {
      // 工種清單為工程領域(construction/trades 提供);未提供/非工程租戶則回空,前端可自由輸入新工種。
      const trades = typeof platform.listTrades === 'function' ? await platform.listTrades({ tenant }) : [];
      return sendJson(res, 200, { trades });
    }
    if (req.method === 'POST' && pathname === '/queue/api/confirm') {
      const body = JSON.parse(await readBody(req));
      body.operator = access.actor;
      return sendJson(res, 200, await confirmMessage(tenant, body, access));
    }
    if (req.method === 'POST' && pathname === '/queue/api/batch-confirm') {
      const body = JSON.parse(await readBody(req));
      body.operator = access.actor;
      return sendJson(res, 200, await batchConfirm(tenant, body, access));
    }
    if (req.method === 'GET' && pathname === '/queue/api/photo') {
      return await servePhoto(tenant, res, url, access);
    }
    // 開立回饋單:屬 construction「開單」。queue 不含開單邏輯,只呼叫其提供的能力。
    if (req.method === 'POST' && pathname === '/queue/api/create-ticket') {
      const body = JSON.parse(await readBody(req));
      const sourcePage = await nreq(tenant, `/v1/pages/${encodeURIComponent(body.pageId || '')}`, { method: 'GET' });
      await assertMessagePageAccess(tenant, access, sourcePage, 'queue.manage');
      for (const extraId of Array.isArray(body.alsoMount) ? body.alsoMount.slice(0, 20) : []) {
        const extraPage = await nreq(tenant, `/v1/pages/${encodeURIComponent(extraId)}`, { method: 'GET' });
        await assertMessagePageAccess(tenant, access, extraPage, 'queue.manage');
      }
      body.operator = access.actor;
      // 開單屬 construction:未載入該模組、或此租戶未啟用工程 → 一律 501(非工程租戶不服務開單)。
      if (typeof platform.createFeedbackTicket !== 'function' || !(tenant.modules || []).includes('construction')) {
        return sendJson(res, 501, { error: '開立回饋單由 construction 模組提供,尚未啟用' });
      }
      return sendJson(res, 200, await platform.createFeedbackTicket({ tenant, access, ...body }));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) console.error('Queue error:', error);
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

// ── 資料查詢 ────────────────────────────────────────────
async function listMessages(tenant, statuses, pageSize = 100, scope = null, access = null) {
  const statusFilter = { or: statuses.map((s) => ({ property: '掛載狀態', select: { equals: s } })) };
  const selectedIds = !access?.isTenantAll ? (access?.groupBindingIds || []) : [];
  const filter = selectedIds.length
    ? { and: [statusFilter, { or: selectedIds.map((id) => ({ property: '群組綁定', relation: { contains: id } })) }] }
    : statusFilter;
  const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).messages)}/query`, {
    method: 'POST',
    body: {
      filter,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: pageSize,
    },
  });

  const items = [];
  for (const page of result.results || []) {
    const p = page.properties;
    let judgement = null;
    try { judgement = JSON.parse(plain(p['AI 初判結果']?.rich_text)); } catch {}
    const projectId = p['專案']?.relation?.[0]?.id || null;
    if (!(await inScope(tenant, scope, projectId))) continue;
    const bindingId = p['群組綁定']?.relation?.[0]?.id || null;
    if (access && !(await bindingAllowed(tenant, access, bindingId, 'queue.read'))) continue;
    const item = {
      id: page.id,
      title: plain(p['訊息']?.title),
      content: plain(p['內容']?.rich_text),
      sender: plain(p['發送者']?.rich_text),
      time: p['時間']?.date?.start || '',
      messageType: p['訊息類型']?.select?.name || '',
      mountStatus: p['掛載狀態']?.select?.name || '',
      aiType: p['AI 訊息類型']?.select?.name || null,
      aiConfidence: p['AI 信心度']?.select?.name || null,
      judgement,
      groupBindingId: bindingId,
      projectId,
      projectName: projectId ? await pageName(tenant, projectId) : '',
      groupName: bindingId ? await pageName(tenant, bindingId) : '',
      spaceName: p['空間']?.relation?.[0]?.id ? await pageName(tenant, p['空間'].relation[0].id) : '',
      workItemName: p['工項']?.relation?.[0]?.id ? await pageName(tenant, p['工項'].relation[0].id) : '',
      confirmedBy: plain(p['確認者']?.rich_text),
      confirmedAt: p['確認時間']?.date?.start || '',
      photos: [],
    };
    if (item.messageType === '照片') {
      item.photos = await attachmentPhotos(tenant, page.id);
    }
    items.push(item);
  }
  return { items };
}

async function attachmentPhotos(tenant, messagePageId) {
  if (!ds(tenant).attachments) return [];
  try {
    const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).attachments)}/query`, {
      method: 'POST',
      body: { filter: { property: '訊息', relation: { contains: messagePageId } }, page_size: 10 },
    });
    return (result.results || [])
      .map((page) => {
        const url = page.properties['Drive 連結']?.url || '';
        const fileId = (url.match(/\/file\/d\/([^/]+)/) || [])[1] || '';
        return fileId ? { url, attachmentId: page.id } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// 縮圖代理:瀏覽器不需登入 Google,由伺服器以自己的授權取 Drive 縮圖回傳
async function servePhoto(tenant, res, url, access) {
  const attachmentId = url.searchParams.get('attachment') || '';
  if (!/^[0-9a-f-]{32,36}$/i.test(attachmentId)) return sendJson(res, 400, { error: 'bad attachment id' });
  const attachment = await nreq(tenant, `/v1/pages/${encodeURIComponent(attachmentId)}`, { method: 'GET' });
  const messageId = attachment.properties?.['訊息']?.relation?.[0]?.id || '';
  if (!messageId) return sendJson(res, 404, { error: 'Attachment message not found' });
  const message = await nreq(tenant, `/v1/pages/${encodeURIComponent(messageId)}`, { method: 'GET' });
  await assertMessagePageAccess(tenant, access, message, 'queue.read');
  const driveUrl = attachment.properties?.['Drive 連結']?.url || '';
  const fileId = (driveUrl.match(/\/file\/d\/([^/]+)/) || [])[1] || '';
  if (!/^[\w-]+$/.test(fileId) || !platform.driveConfigured) {
    return sendJson(res, 400, { error: 'bad file id' });
  }
  const token = await platform.getDriveAccessToken();
  let target = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  try {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    if (metaRes.ok && meta.thumbnailLink) {
      target = meta.thumbnailLink.replace(/=s\d+([^\d]|$)/, '=s512$1');
    }
  } catch {}
  const imageRes = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
  if (!imageRes.ok) {
    return sendJson(res, 502, { error: `photo fetch failed: ${imageRes.status}` });
  }
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
  });
  res.end(buffer);
}

async function loadOptions(tenant, projectId, access) {
  const load = async (dataSourceId, titleProperty) => {
    const items = [];
    let cursor;
    do {
      const body = { filter: { property: '專案', relation: { contains: projectId } }, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: 'POST', body });
      for (const page of result.results || []) {
        const name = plain(page.properties?.[titleProperty]?.title);
        if (name) items.push({ id: page.id, name });
      }
      cursor = result.has_more ? result.next_cursor : null;
    } while (cursor);
    return items;
  };

  // 未銷項的回饋單(供佇列把回覆/複驗照片掛回『既有』單據)。無回饋單庫(非工程租戶)則略過。
  let tickets = [];
  if (ds(tenant).feedbackTickets) {
    const ticketsResult = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).feedbackTickets)}/query`, {
      method: 'POST',
      body: {
        filter: { and: [
          { property: '專案', relation: { contains: projectId } },
          { or: [
            { property: '狀態', select: { equals: '開立' } },
            { property: '狀態', select: { equals: '回覆中' } },
          ] },
        ] },
        page_size: 100,
      },
    });
    const visible = [];
    for (const page of ticketsResult.results || []) {
      const bindingId = page.properties?.['負責群組']?.relation?.[0]?.id || '';
      if (access && !(await bindingAllowed(tenant, access, bindingId, 'queue.read'))) continue;
      visible.push({
        id: page.id,
        label: `${plain(page.properties['編號']?.title)} ${plain(page.properties['問題描述']?.rich_text).slice(0, 20)}`,
      });
    }
    tickets = visible;
  }

  return {
    spaces: ds(tenant).spaces ? await load(ds(tenant).spaces, '名稱') : [],
    workItems: ds(tenant).workItems ? await load(ds(tenant).workItems, '工項') : [],
    tickets,
  };
}

async function listProjects(tenant, scope = null, access = null) {
  const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).projects)}/query`, {
    method: 'POST', body: { page_size: 100 },
  });
  const summary = access ? await accessibleBindingSummary(tenant, access) : { allProjects: true, projectIds: new Set() };
  return {
    projects: (result.results || []).map((page) => ({
      id: page.id,
      name: plain(page.properties['專案名稱']?.title),
      code: plain(page.properties['館別代碼']?.rich_text),
    })).filter((x) => x.name
      && (!scope || scope.has(x.code))
      && (summary.allProjects || summary.projectIds.has(x.id))),
  };
}

// ── 確認動作(掛載)────────────────────────────────────────
async function confirmMessage(tenant, { pageId, action, spaceId, workItemId, messageType, operator, isCorrection, newWorkItem, alsoMount, ticketId, projectId }, access) {
  if (!pageId || !action || !operator) throw new Error('pageId/action/operator required');
  const now = new Date().toISOString();
  const page = await nreq(tenant, `/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  await assertMessagePageAccess(tenant, access, page, 'queue.manage');
  let judgement = null;
  try { judgement = JSON.parse(plain(page.properties['AI 初判結果']?.rich_text)); } catch {}

  const properties = {
    '確認者': { rich_text: [{ type: 'text', text: { content: operator } }] },
    '確認時間': { date: { start: now } },
  };

  let finalSpaceId = null;
  let finalWorkItemId = null;

  if (action === 'general') {
    properties['掛載狀態'] = { select: { name: '一般對話' } };
    properties['空間'] = { relation: [] };
    properties['工項'] = { relation: [] };
    properties['AI 訊息類型'] = { select: { name: '一般對話' } };
  } else if (action === 'confirm') {
    finalSpaceId = spaceId !== undefined ? spaceId : (judgement?.space?.id || null);
    finalWorkItemId = workItemId !== undefined ? workItemId : (judgement?.work_item?.id || null);
    // 總管群訊息原本無專案:掛載時由佇列選定的專案補上(一般群沿用訊息既有專案)
    const mountProjectId = page.properties['專案']?.relation?.[0]?.id || projectId || null;
    if (projectId) await assertProjectAccess(tenant, access, projectId);
    // 佇列內直接新增工項:名稱+工種,自動帶入空間與專案
    if (newWorkItem?.name) {
      const created = await nreq(tenant, '/v1/pages', {
        method: 'POST',
        body: {
          parent: { type: 'data_source_id', data_source_id: ds(tenant).workItems },
          properties: {
            '工項': { title: [{ type: 'text', text: { content: String(newWorkItem.name).slice(0, 100) } }] },
            '空間': { relation: finalSpaceId ? [{ id: finalSpaceId }] : [] },
            '專案': { relation: mountProjectId ? [{ id: mountProjectId }] : [] },
            '工種': { select: { name: newWorkItem.trade || '其他' } },
            '狀態': { select: { name: '未開始' } },
          },
        },
      });
      finalWorkItemId = created.id;
    }
    const finalType = messageType || judgement?.message_type || page.properties['AI 訊息類型']?.select?.name || '一般對話';
    properties['掛載狀態'] = { select: { name: '已確認' } };
    properties['空間'] = { relation: finalSpaceId ? [{ id: finalSpaceId }] : [] };
    properties['工項'] = { relation: finalWorkItemId ? [{ id: finalWorkItemId }] : [] };
    properties['AI 訊息類型'] = { select: { name: finalType } };
    // 總管群:原本無專案,補上佇列選定的專案
    if (!page.properties['專案']?.relation?.[0]?.id && mountProjectId) {
      properties['專案'] = { relation: [{ id: mountProjectId }] };
    }
  } else {
    throw new Error(`unknown action: ${action}`);
  }

  await nreq(tenant, `/v1/pages/${encodeURIComponent(pageId)}`, { method: 'PATCH', body: { properties } });

  // 修正記錄:審核視圖的修改在頁面內留下不可刪的軌跡
  if (isCorrection) {
    const summary = action === 'general'
      ? '改標為一般對話'
      : `掛載修正 → 空間:${finalSpaceId ? await pageName(tenant, finalSpaceId) : '無'} / 工項:${finalWorkItemId ? await pageName(tenant, finalWorkItemId) : '無'}`;
    await nreq(tenant, `/v1/blocks/${encodeURIComponent(pageId)}/children`, {
      method: 'PATCH',
      body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText(`[修正記錄] ${taipeiStamp(now)} ${operator}:${summary}`)] } }] },
    });
  }

  // 附件同步掛載 + Drive 歸檔搬移
  let archived = 0;
  if (action === 'confirm') {
    archived = await archiveAttachments(tenant, pageId, page, finalSpaceId, finalWorkItemId);
  }

  // 連帶掛載:相鄰照片訊息套用同一掛載目標(由前端依「文字配照片」慣例挑選),並行處理
  let mounted = 0;
  if (action === 'confirm' && Array.isArray(alsoMount) && alsoMount.length) {
    const finalType = properties['AI 訊息類型']?.select?.name;
    const results = await Promise.all(alsoMount.slice(0, 20).map((extraId) =>
      confirmMessage(tenant, {
        pageId: extraId, action: 'confirm',
        spaceId: finalSpaceId, workItemId: finalWorkItemId,
        messageType: finalType, operator,
      }, access).catch((error) => {
        console.warn(`alsoMount failed for ${extraId}: ${error.message}`);
        return null;
      })
    ));
    for (const extra of results) {
      if (extra) { mounted++; archived += extra.archived || 0; }
    }
  }

  // 掛到回饋單:設計師/工班在 LINE 的回覆與複驗照片,一鍵寫回『既有』單據
  let linkedTicket = null;
  if (action === 'confirm' && ticketId) {
    try {
      linkedTicket = await linkMessageToTicket(tenant, { messagePageId: pageId, messagePage: page, ticketId, operator, alsoMountIds: Array.isArray(alsoMount) ? alsoMount.slice(0, 20) : [] }, access);
    } catch (error) {
      console.warn(`linkMessageToTicket failed: ${error.message}`);
    }
  }
  return { ok: true, archived, mounted, linkedTicket };
}

// 把訊息(含連帶照片)掛上『既有』回饋單:文字→設計師回覆(開立→回覆中);照片→單據照片。
async function linkMessageToTicket(tenant, { messagePageId, messagePage, ticketId, operator, alsoMountIds }, access) {
  const now = new Date().toISOString();
  const p = messagePage.properties;
  const text = plain(p['內容']?.rich_text) || (p['訊息類型']?.select?.name === '文字' ? plain(p['訊息']?.title) : '');
  const sender = plain(p['發送者']?.rich_text);

  const ticket = await nreq(tenant, `/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
  const ticketBindingId = ticket.properties?.['負責群組']?.relation?.[0]?.id || '';
  if (ticketBindingId) {
    const meta = await bindingMeta(tenant, ticketBindingId);
    access.assert('queue.manage', ticketBindingId, { status: meta?.status || '停用' });
  } else {
    access.assert('unassigned.manage');
  }
  const number = plain(ticket.properties['編號']?.title);
  const currentStatus = ticket.properties['狀態']?.select?.name || '';

  // 訊息(含連帶照片)標上回饋單關聯
  const messageIds = [messagePageId, ...alsoMountIds];
  await Promise.all(messageIds.map((id) =>
    nreq(tenant, `/v1/pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { properties: { '回饋單': { relation: [{ id: ticketId }] } } },
    }).catch((error) => console.warn(`ticket relation failed for ${id}: ${error.message}`))
  ));

  const ticketProperties = {};

  // 文字 → 寫入設計師回覆並轉「回覆中」
  if (text.trim()) {
    const existing = plain(ticket.properties['設計師回覆']?.rich_text);
    const entry = `[${taipeiStamp(now)} ${sender}] ${text.trim()}`;
    const combined = existing ? `${existing}\n${entry}` : entry;
    ticketProperties['設計師回覆'] = { rich_text: [{ type: 'text', text: { content: combined.slice(0, 1900) } }] };
    if (currentStatus === '開立') {
      ticketProperties['狀態'] = { select: { name: '回覆中' } };
    }
    await appendHistory(tenant, ticketId, [normalText(`[回覆] ${taipeiStamp(now)} 來自 LINE,由 ${operator} 掛入。`), blueText(`${sender}:「${text.trim().slice(0, 400)}」`)]);
  }

  // 照片 → 加入單據照片(複驗/補充佐證)
  const photoUrls = [];
  for (const id of messageIds) {
    for (const photo of await attachmentPhotos(tenant, id)) photoUrls.push(photo.url);
  }
  if (photoUrls.length) {
    const existingFiles = ticket.properties['照片']?.files || [];
    const existingUrls = new Set(existingFiles.map((f) => f.external?.url || f.file?.url));
    const newFiles = photoUrls.filter((url) => !existingUrls.has(url))
      .map((url, index) => ({ type: 'external', name: `照片${existingFiles.length + index + 1}`, external: { url } }));
    if (newFiles.length) {
      ticketProperties['照片'] = { files: [...existingFiles.filter((f) => f.external || f.file), ...newFiles].slice(0, 20) };
      await appendHistory(tenant, ticketId, `[照片] ${taipeiStamp(now)} 新增 ${newFiles.length} 張(來自 LINE,由 ${operator} 掛入)`);
    }
  }

  if (Object.keys(ticketProperties).length) {
    await nreq(tenant, `/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'PATCH', body: { properties: ticketProperties } });
  }
  return { number, becameReplying: currentStatus === '開立' && Boolean(text.trim()) };
}

async function appendHistory(tenant, pageId, content) {
  const richText = Array.isArray(content) ? content : [normalText(content)];
  await nreq(tenant, `/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText } }] },
  });
}

async function archiveAttachments(tenant, messagePageId, messagePage, spaceId, workItemId) {
  if (!ds(tenant).attachments) return 0;
  const result = await nreq(tenant, `/v1/data_sources/${encodeURIComponent(ds(tenant).attachments)}/query`, {
    method: 'POST',
    body: { filter: { property: '訊息', relation: { contains: messagePageId } }, page_size: 20 },
  });
  const attachments = result.results || [];
  if (!attachments.length) return 0;

  const projectId = messagePage.properties['專案']?.relation?.[0]?.id || null;
  const [projectName, spaceName, workItemName] = await Promise.all([
    projectId ? pageName(tenant, projectId) : '未分專案',
    spaceId ? pageName(tenant, spaceId) : '未分空間',
    workItemId ? pageName(tenant, workItemId) : '未分工項',
  ]);

  // Notion 掛載並行處理(這部分要等,回應時掛載已完成)
  await Promise.all(attachments.map((attachment) =>
    nreq(tenant, `/v1/pages/${encodeURIComponent(attachment.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '空間': { relation: spaceId ? [{ id: spaceId }] : [] },
        '工項': { relation: workItemId ? [{ id: workItemId }] : [] },
      } },
    })
  ));

  // Drive 歸檔搬移改背景執行:不阻塞確認回應,失敗記 log(可用 rejudge 或手動補搬)
  const moves = attachments.map((attachment) => ({
    fileId: ((attachment.properties['Drive 連結']?.url || '').match(/\/file\/d\/([^/]+)/) || [])[1],
    dateStr: (attachment.properties['日期']?.date?.start || new Date().toISOString()).slice(0, 10),
  })).filter((m) => m.fileId);

  if (moves.length && platform.driveConfigured && tenant.driveRootFolderId) {
    (async () => {
      for (const move of moves) {
        try {
          const projectFolder = await platform.ensureDriveFolder(projectName, tenant.driveRootFolderId);
          const spaceFolder = await platform.ensureDriveFolder(spaceName, projectFolder);
          const workItemFolder = await platform.ensureDriveFolder(workItemName, spaceFolder);
          const dateFolder = await platform.ensureDriveFolder(move.dateStr, workItemFolder);
          await moveDriveFile(move.fileId, dateFolder);
        } catch (error) {
          console.warn(`Drive archive failed for ${move.fileId}: ${error.message}`);
        }
      }
    })();
  }
  return attachments.length;
}

async function moveDriveFile(fileId, newParentId) {
  const token = await platform.getDriveAccessToken();
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaJson = await meta.json();
  if (!meta.ok) throw new Error(`Drive file lookup failed: ${JSON.stringify(metaJson).slice(0, 200)}`);
  const oldParents = (metaJson.parents || []).join(',');
  if (metaJson.parents?.includes(newParentId)) return;
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}&removeParents=${encodeURIComponent(oldParents)}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' },
  );
  if (!response.ok) throw new Error(`Drive move failed: ${response.status} ${await response.text()}`);
}

async function batchConfirm(tenant, { operator }, access) {
  if (!operator) throw new Error('operator required');
  const pending = await listMessages(tenant, ['AI初判待確認'], 100, null, access);
  const targets = pending.items.filter((item) => item.aiConfidence === '高');
  let confirmed = 0;
  for (const item of targets) {
    const action = (item.judgement?.message_type || item.aiType) === '一般對話' ? 'general' : 'confirm';
    await confirmMessage(tenant, { pageId: item.id, action, operator }, access);
    confirmed++;
  }
  return { ok: true, confirmed };
}

// ── 佇列頁(待確認 / 已確認;開單/單據管理屬 construction,不在此)──
function renderQueuePage(tenant, access) {
  const TENANT = JSON.stringify(tenant.key);
  const ACTOR = JSON.stringify(access?.actor || 'Portal 使用者');
  const tenantParam = encodeURIComponent(tenant.key);
  const constructionEnabled = (tenant.modules || []).includes('construction');
  const ticketsLink = constructionEnabled ? `<a href="/tickets?tenant=${tenantParam}">回饋單／變更單</a>` : '';
  const dashboardLink = constructionEnabled && access?.isTenantAll ? `<a href="/dashboard?tenant=${tenantParam}">工程儀表板</a>` : '';
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>葉小蝸確認佇列</title>
<style>
  :root { --green:#2e7d52; --bg:#f5f7f6; --card:#fff; --line:#e0e6e3; --dim:#6b7a72; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif; background:var(--bg); color:#22302a; padding-bottom:60px; }
  header { background:var(--green); color:#fff; padding:12px 16px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; position:sticky; top:0; z-index:5; }
  header h1 { font-size:17px; font-weight:700; }
  header a { color:#fff; font-size:13px; text-decoration:none; border:1px solid rgba(255,255,255,.55); border-radius:7px; padding:5px 8px; }
  header .op { margin-left:auto; display:flex; align-items:center; gap:6px; font-size:13px; }
  header .actor { border-radius:6px; padding:5px 8px; background:rgba(255,255,255,.16); font-weight:600; }
  .tabs { display:flex; background:var(--card); border-bottom:1px solid var(--line); position:sticky; top:48px; z-index:4; }
  .tabs button { flex:1; padding:11px; border:none; background:none; font-size:14px; color:var(--dim); border-bottom:2px solid transparent; }
  .tabs button.active { color:var(--green); border-bottom-color:var(--green); font-weight:700; }
  .toolbar { padding:10px 14px; display:flex; gap:8px; align-items:center; }
  .toolbar .count { font-size:13px; color:var(--dim); }
  .toolbar .batch { margin-left:auto; background:var(--green); color:#fff; border:none; border-radius:8px; padding:8px 12px; font-size:13px; }
  .list { padding:0 12px; display:flex; flex-direction:column; gap:10px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px; }
  .meta { display:flex; gap:6px; flex-wrap:wrap; font-size:12px; color:var(--dim); margin-bottom:6px; align-items:center; }
  .chip { border-radius:20px; padding:2px 9px; font-size:12px; background:#eef2f0; }
  .chip.proj { background:#e3efe8; color:var(--green); font-weight:600; }
  .chip.hi { background:#e3efe8; color:#1d6b41; }
  .chip.mid { background:#fdf3dc; color:#8a6d1a; }
  .chip.lo { background:#fbe5e2; color:#a03e33; }
  .chip.type-issue { background:#fbe5e2; color:#a03e33; font-weight:600; }
  .text { font-size:14px; line-height:1.55; white-space:pre-wrap; word-break:break-word; margin:6px 0; }
  .ai { font-size:13px; background:#f4f8f6; border-radius:8px; padding:8px 10px; margin:8px 0; color:#33463c; }
  .ai b { color:var(--green); }
  .photos { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
  .photos img { width:96px; height:96px; object-fit:cover; border-radius:8px; border:1px solid var(--line); background:#eee; }
  .actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  .actions button { border:1px solid var(--line); background:#fff; border-radius:8px; padding:8px 14px; font-size:13px; }
  .actions .ok { background:var(--green); color:#fff; border-color:var(--green); font-weight:600; }
  .actions .chat { color:var(--dim); }
  .actions .ticket { background:#a03e33; color:#fff; border-color:#a03e33; font-weight:600; }
  .edit { display:none; margin-top:10px; gap:8px; flex-direction:column; }
  .edit.open { display:flex; }
  .edit select { padding:9px; border-radius:8px; border:1px solid var(--line); font-size:14px; width:100%; background:#fff; }
  .edit .save { background:var(--green); color:#fff; border:none; border-radius:8px; padding:10px; font-size:14px; font-weight:600; }
  .confirmed-note { font-size:12px; color:var(--dim); margin-top:6px; }
  .empty { text-align:center; color:var(--dim); padding:50px 0; font-size:14px; }
  .toast { position:fixed; bottom:14px; left:50%; transform:translateX(-50%); background:#22302a; color:#fff; border-radius:20px; padding:9px 18px; font-size:13px; opacity:0; transition:opacity .25s; pointer-events:none; }
  .toast.show { opacity:.95; }
</style>
</head>
<body>
<header>
  <h1>🐌 葉小蝸確認佇列</h1>
  ${ticketsLink}
  ${dashboardLink}
  <div class="op">操作人 <span class="actor" id="operatorLabel"></span></div>
</header>
<div class="tabs">
  <button id="tabPending" class="active">待確認</button>
  <button id="tabConfirmed">已確認</button>
</div>
<div class="toolbar">
  <span class="count" id="count"></span>
  <button class="batch" id="batchBtn" style="display:none">批次確認高信心</button>
</div>
<div class="list" id="list"><div class="empty">載入中…</div></div>
<datalist id="qTradeList"></datalist>
<div class="toast" id="toast"></div>
<script>
const TENANT = ${TENANT};
const ACTOR = ${ACTOR};
let tab = 'pending';
const optionsCache = {};
let projectsList = null;
async function ensureProjects() { if (!projectsList) { const d = await api('projects'); projectsList = d.projects || []; } return projectsList; }
document.getElementById('operatorLabel').textContent = ACTOR;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}
function operator() {
  return ACTOR;
}
async function api(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/queue/api/' + path + sep + 'tenant=' + encodeURIComponent(TENANT), opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function confChip(c) { return c ? '<span class="chip ' + (c==='高'?'hi':c==='中'?'mid':'lo') + '">信心 ' + c + '</span>' : ''; }

let currentItems = [];
async function load() {
  const listEl = document.getElementById('list');
  listEl.innerHTML = '<div class="empty">載入中…</div>';
  const data = await api(tab === 'pending' ? 'pending' : 'confirmed');
  const items = data.items;
  currentItems = items;
  for (const it of items) { it._adjAbove = 0; it._adjBelow = 0; }
  for (let k = 0; k < items.length; k++) {
    if (items[k].messageType !== '文字') continue;
    for (let j = k + 1; j < items.length; j++) {
      const it = items[j];
      if (it.messageType === '照片' && it.groupName === items[k].groupName && it.sender === items[k].sender) items[k]._adjBelow++;
      else break;
    }
    for (let j = k - 1; j >= 0; j--) {
      const it = items[j];
      if (it.messageType === '照片' && it.groupName === items[k].groupName && it.sender === items[k].sender) items[k]._adjAbove++;
      else break;
    }
  }
  document.getElementById('count').textContent = '共 ' + items.length + ' 筆';
  document.getElementById('batchBtn').style.display =
    (tab === 'pending' && items.some(i => i.aiConfidence === '高')) ? '' : 'none';
  if (!items.length) { listEl.innerHTML = '<div class="empty">' + (tab==='pending' ? '佇列清空了 🎉' : '尚無已確認項目') + '</div>'; return; }
  listEl.innerHTML = items.map(render).join('');
}

function render(i) {
  const j = i.judgement || {};
  const time = (i.time || '').replace('T',' ').slice(5,16);
  const typeChip = i.aiType ? '<span class="chip' + (i.aiType==='問題反映'?' type-issue':'') + '">' + esc(i.aiType) + '</span>' : '';
  const photoLinks = (i.photos||[]).map(p =>
    '<a href="' + esc(p.url) + '" target="_blank"><img loading="lazy" src="/queue/api/photo?attachment=' + encodeURIComponent(p.attachmentId) + '&tenant=' + encodeURIComponent(TENANT) + '" alt="照片"></a>'
  ).join('');
  const ai = (i.judgement || i.aiType) ? \`<div class="ai">AI 初判:空間 <b>\${esc(j.space?.name || '—')}</b> ・ 工項 <b>\${esc(j.work_item?.name || '—')}</b> \${j.reason ? '<br>' + esc(j.reason) : ''}</div>\` : '';
  const adjParts = [];
  if (i._adjAbove) adjParts.push('上方 ' + i._adjAbove + ' 張');
  if (i._adjBelow) adjParts.push('下方 ' + i._adjBelow + ' 張');
  const adjNote = (tab === 'pending' && adjParts.length)
    ? '<div style="font-size:12px;color:var(--green);margin-top:4px">📎 ' + adjParts.join('、') + '照片可一併掛載（按「✓ 確認」或「改掛載」時會逐向詢問）</div>'
    : '';
  const confirmedNote = tab === 'confirmed'
    ? \`<div class="confirmed-note">狀態 \${esc(i.mountStatus)} ・ 掛載:\${esc(i.spaceName || '—')} / \${esc(i.workItemName || '—')} ・ \${esc(i.confirmedBy)} 於 \${esc((i.confirmedAt||'').replace('T',' ').slice(5,16))}</div>\`
    : '';
  const ticketBtn = (tab === 'pending' && i.aiType === '問題反映' && i.projectId)
    ? \`<button class="ticket" onclick="createTicket('\${i.id}')">⚠ 開立回饋單</button>\`
    : '';
  const actions = tab === 'pending'
    ? \`<div class="actions">
        <button class="ok" onclick="act('\${i.id}','confirm',this)">✓ 確認</button>
        \${ticketBtn}
        <button onclick="toggleEdit('\${i.id}','\${i.projectId||''}')">改掛載</button>
        <button class="chat" onclick="act('\${i.id}','general',this)">一般對話</button>
      </div>\`
    : \`<div class="actions"><button onclick="toggleEdit('\${i.id}','\${i.projectId||''}',true)">修正</button></div>\`;
  return \`<div class="card" id="card-\${i.id}">
    <div class="meta"><span class="chip proj">\${esc(i.projectName || '未綁定')}</span><span>\${esc(i.groupName)}</span><span>\${esc(i.sender)}</span><span>\${time}</span>\${typeChip}\${confChip(i.aiConfidence)}</div>
    <div class="text">\${esc(i.content || i.title)}</div>
    <div class="photos">\${photoLinks}</div>
    \${ai}\${adjNote}\${confirmedNote}\${actions}
    <div class="edit" id="edit-\${i.id}">
      \${!i.projectId ? \`<select id="proj-\${i.id}" onchange="onPickProject('\${i.id}')"><option value="">（總管群：先選專案）</option></select>\` : ''}
      <select id="space-\${i.id}"><option value="">（不掛空間）</option></select>
      <select id="wi-\${i.id}"><option value="">（不掛工項）</option></select>
      <select id="tk-\${i.id}"><option value="">（不掛回饋單）</option></select>
      <div style="display:flex;gap:8px">
        <input id="nwi-\${i.id}" placeholder="＋或新增工項（輸入名稱）" style="flex:1;padding:9px;border-radius:8px;border:1px solid var(--line);font-size:14px">
        <input id="nwt-\${i.id}" list="qTradeList" value="其他" placeholder="工種(可打新的)" style="width:110px;padding:9px;border-radius:8px;border:1px solid var(--line);font-size:14px">
      </div>
      <select id="type-\${i.id}">
        <option>進度回報</option><option>問題反映</option><option>提問</option><option>一般對話</option>
      </select>
      <button class="save" onclick="saveEdit('\${i.id}')">儲存並確認</button>
    </div>
  </div>\`;
}

// 「文字配照片」慣例:文字訊息上下兩側、同群組同發送者的連續照片視為候選同組
// (現場有時先發文字再補照片、有時先照片再補說明,兩個方向都要支援)
function adjacentPhotos(id) {
  const idx = currentItems.findIndex(x => x.id === id);
  if (idx < 0 || currentItems[idx].messageType !== '文字') return { above: [], below: [] };
  const me = currentItems[idx];
  const same = (it) => it.messageType === '照片' && it.groupName === me.groupName && it.sender === me.sender;
  const above = [];
  const below = [];
  for (let k = idx - 1; k >= 0 && same(currentItems[k]); k--) above.push(currentItems[k].id);
  for (let k = idx + 1; k < currentItems.length && same(currentItems[k]); k++) below.push(currentItems[k].id);
  return { above, below };
}
function askAlsoMount(id) {
  if (tab !== 'pending') return [];
  const adj = adjacentPhotos(id);
  const picked = [];
  if (adj.above.length && window.confirm('這則訊息「上方」有 ' + adj.above.length + ' 張相鄰照片,要一併掛載到同一目標嗎?')) picked.push(...adj.above);
  if (adj.below.length && window.confirm('這則訊息「下方」有 ' + adj.below.length + ' 張相鄰照片,要一併掛載到同一目標嗎?')) picked.push(...adj.below);
  return picked;
}

const editState = {};
async function toggleEdit(id, projectId, correction) {
  editState[id] = { correction: Boolean(correction), projectId: projectId || '' };
  const box = document.getElementById('edit-' + id);
  if (box.classList.contains('open')) { box.classList.remove('open'); return; }
  if (projectId) {
    await fillOptions(id, projectId);
  } else {
    // 總管群訊息無專案:先選專案,再載入該專案的空間/工項
    const projSel = document.getElementById('proj-' + id);
    if (projSel && projSel.length <= 1) {
      (await ensureProjects()).forEach(x => projSel.add(new Option(x.name + '(' + x.code + ')', x.id)));
    }
  }
  box.classList.add('open');
}
async function fillOptions(id, projectId) {
  if (!optionsCache[projectId]) optionsCache[projectId] = await api('options?project=' + projectId);
  const opt = optionsCache[projectId];
  const fill = (sel, items) => { sel.length = 1; items.forEach(x => sel.add(new Option(x.name || x.label, x.id))); };
  fill(document.getElementById('space-' + id), opt.spaces);
  fill(document.getElementById('wi-' + id), opt.workItems);
  fill(document.getElementById('tk-' + id), opt.tickets || []);
}
async function onPickProject(id) {
  const pid = document.getElementById('proj-' + id).value;
  editState[id] = Object.assign({}, editState[id], { projectId: pid });
  if (pid) { await fillOptions(id, pid); }
  else { ['space-', 'wi-', 'tk-'].forEach(pfx => { const s = document.getElementById(pfx + id); if (s) s.length = 1; }); }
}
async function saveEdit(id) {
  const body = {
    pageId: id, action: 'confirm', operator: operator(),
    spaceId: document.getElementById('space-' + id).value || null,
    workItemId: document.getElementById('wi-' + id).value || null,
    ticketId: document.getElementById('tk-' + id).value || null,
    messageType: document.getElementById('type-' + id).value,
    isCorrection: editState[id]?.correction || false,
  };
  const newName = document.getElementById('nwi-' + id).value.trim();
  if (newName) {
    body.newWorkItem = { name: newName, trade: document.getElementById('nwt-' + id).value };
  }
  // 總管群:掛載必須先指定專案
  const projSel = document.getElementById('proj-' + id);
  if (projSel) {
    if (!projSel.value) { toast('總管群訊息請先選擇專案'); return; }
    body.projectId = projSel.value;
  }
  body.alsoMount = askAlsoMount(id);
  // 樂觀更新:先收起卡片讓操作不中斷,失敗再還原
  const cards = [id, ...body.alsoMount];
  hideCards(cards, true);
  try {
    const r = await api('confirm', { method: 'POST', body: JSON.stringify(body) });
    removeCards(cards);
    let msg = '已確認' + (r.mounted ? ',連帶掛載 ' + r.mounted + ' 張照片' : '');
    if (r.linkedTicket) msg += ';已掛入 ' + r.linkedTicket.number + (r.linkedTicket.becameReplying ? '(轉回覆中)' : '');
    toast(msg);
  } catch (e) {
    hideCards(cards, false);
    toast('失敗:' + e.message);
  }
}
function hideCards(ids, hidden) {
  ids.forEach(x => { const el = document.getElementById('card-' + x); if (el) el.style.display = hidden ? 'none' : ''; });
}
function removeCards(ids) {
  ids.forEach(x => document.getElementById('card-' + x)?.remove());
}
async function act(id, action, btn) {
  let cards = [id];
  try {
    const op = operator();
    const alsoMount = action === 'confirm' ? askAlsoMount(id) : [];
    cards = [id, ...alsoMount];
    // 樂觀更新:先收起卡片,後台完成掛載;失敗會跳回來
    hideCards(cards, true);
    const r = await api('confirm', { method: 'POST', body: JSON.stringify({ pageId: id, action, operator: op, alsoMount }) });
    removeCards(cards);
    toast(action === 'general' ? '已標為一般對話' : '已確認' + (r.mounted ? ',連帶掛載 ' + r.mounted + ' 張照片' : r.archived ? ',掛載 ' + r.archived + ' 張照片' : ''));
  } catch (e) {
    hideCards(cards, false);
    if (e.message !== 'no operator') toast('失敗:' + e.message);
  }
}
// 開立回饋單:委派 construction(platform.createFeedbackTicket);未啟用則回 501。
async function createTicket(id) {
  let cards = [id];
  try {
    const op = operator();
    const alsoMount = askAlsoMount(id);
    if (!window.confirm('確定以這則訊息開立回饋單?(自動編號並帶入內容與照片)')) return;
    const announce = window.confirm('要同時把開單公告發到群組嗎?(讓負責人知道有這件待辦)');
    cards = [id, ...alsoMount];
    hideCards(cards, true);
    toast('開立中…');
    const body = { pageId: id, operator: op, alsoMount, announce };
    const edit = document.getElementById('edit-' + id);
    if (edit && edit.classList.contains('open')) {
      body.spaceId = document.getElementById('space-' + id).value || null;
      body.workItemId = document.getElementById('wi-' + id).value || null;
    }
    const r = await api('create-ticket', { method: 'POST', body: JSON.stringify(body) });
    removeCards(cards);
    toast('已開立回饋單 ' + r.number);
  } catch (e) {
    hideCards(cards, false);
    if (e.message !== 'no operator') toast('失敗:' + e.message);
  }
}

document.getElementById('batchBtn').addEventListener('click', async () => {
  const r = await api('batch-confirm', { method: 'POST', body: JSON.stringify({ operator: operator() }) });
  toast('批次確認 ' + r.confirmed + ' 筆');
  load();
});

document.getElementById('tabPending').addEventListener('click', () => { tab='pending'; setTab(); });
document.getElementById('tabConfirmed').addEventListener('click', () => { tab='confirmed'; setTab(); });
function setTab() {
  document.getElementById('tabPending').classList.toggle('active', tab==='pending');
  document.getElementById('tabConfirmed').classList.toggle('active', tab==='confirmed');
  load();
}
// 工種候選:載入已知工種餵給新增工項的 datalist(可直接打新工種,Notion 自動建立)
async function loadTrades() {
  try {
    const d = await api('trades');
    document.getElementById('qTradeList').innerHTML = (d.trades || []).map(t =>
      '<option value="' + String(t).replace(/"/g, '&quot;') + '">').join('');
  } catch (e) {}
}
loadTrades();
load();
</script>
</body>
</html>`;
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'queue',
  init,
  routes: [
    { prefix: '/queue', access: { kind: 'group', capability: 'queue.manage' }, handler: handleQueueRequest }, // /queue、/queue/api/*
  ],
};

// 測試用內部匯出(不影響正式流程)
export const __test = { listMessages, confirmMessage, linkMessageToTicket, batchConfirm, loadOptions, listProjects, parseScope, inScope, handleQueueRequest };

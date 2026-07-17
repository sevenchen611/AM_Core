// 回饋單 / 變更單狀態機(SPEC F2/F5)——抽自 BuildAM src/queue.js「單據部分」
//   開立 → 回覆中 → 已銷項;擱置(待時機) / 復活;催辦 / 變更公告;變更單核准/退回。
// 改為多租戶:所有函式吃 deps(該租戶 dataSources / notionRequest 已鎖定 tenantKey)。
// 編號用該租戶專案的「館別代碼」(ZS-2026-001 / -CO-001),各租戶各自序號、不撞號。

import {
  plain, taipeiStamp, normalText, blueText, pageName,
  inScope, appendHistory, attachmentPhotos, archiveAttachments,
  parseScope, readJsonBody, sendJson,
} from './common.js';

// ── 編號生成(序列化,保證不重複)──────────────────────────
// 全域鏈只保證「同時只有一個編號在產」;查詢範圍仍是各租戶自己的庫,故跨租戶不撞號。
let ticketNumberChain = Promise.resolve();

const relationId = (page, property) => page?.properties?.[property]?.relation?.[0]?.id || '';

async function bindingMeta(deps, bindingId) {
  // 群組狀態屬授權資料；不做跨請求快取，停用後下一次操作立即拒絕。
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
  return {
    id: page.id,
    status: page.properties?.['狀態']?.select?.name || '',
    role: page.properties?.['群組角色']?.select?.name || '',
    projectIds: (page.properties?.['專案']?.relation || []).map((item) => item.id),
  };
}

async function assertGroupPage(deps, page, relationProperty, action = 'construction.tickets.read') {
  if (!deps.access) return true; // webhook/scheduler stays system-scoped and tenant-isolated.
  const groupBindingId = relationId(page, relationProperty);
  if (!groupBindingId) {
    deps.access.assert(action.includes('read') ? 'unassigned.read' : 'unassigned.manage');
    return true;
  }
  const binding = await bindingMeta(deps, groupBindingId);
  deps.access.assert(action, groupBindingId, { status: binding.status });
  return binding;
}

async function accessibleProjectIds(deps) {
  if (!deps.access || deps.access.isTenantAll) return null;
  const ids = new Set();
  for (const bindingId of deps.access.groupBindingIds || []) {
    const binding = await bindingMeta(deps, bindingId);
    if (binding.status !== '啟用') continue;
    for (const projectId of binding.projectIds) ids.add(String(projectId).replace(/-/g, '').toLowerCase());
  }
  return ids;
}

async function assertProjectAccess(deps, projectId) {
  const allowed = await accessibleProjectIds(deps);
  if (allowed === null) return true;
  if (allowed.has(String(projectId || '').replace(/-/g, '').toLowerCase())) return true;
  const error = new Error('找不到可存取的專案資料。');
  error.statusCode = 404;
  throw error;
}

export function nextTicketNumber(deps, projectPageId, kind = 'feedback') {
  const result = ticketNumberChain.then(() => generateTicketNumber(deps, projectPageId, kind));
  ticketNumberChain = result.catch(() => {});
  return result;
}

async function generateTicketNumber(deps, projectPageId, kind = 'feedback') {
  const projectPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(projectPageId)}`, { method: 'GET' });
  const code = plain(projectPage.properties['館別代碼']?.rich_text) || 'XX';
  // 回饋單:{館別}-{年}-{三位流水};變更單:{館別}-CO-{三位流水}
  const prefix = kind === 'co' ? `${code}-CO-` : `${code}-${new Date().getFullYear()}-`;
  const dataSourceId = kind === 'co' ? deps.dataSources.changeOrders : deps.dataSources.feedbackTickets;

  let max = 0;
  let cursor;
  do {
    const body = { filter: { property: '專案', relation: { contains: projectPageId } }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: 'POST', body });
    for (const page of result.results || []) {
      const number = plain(page.properties['編號']?.title);
      if (number.startsWith(prefix)) {
        const seq = Number(number.slice(prefix.length));
        if (Number.isFinite(seq) && seq > max) max = seq;
      }
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// ── 開回饋單(供 queue 呼叫的「開單」)──────────────────────
// body: { pageId, operator, spaceId?, workItemId?, alsoMount?, announce?, projectId? }
export async function createTicket(deps, { pageId, operator, spaceId, workItemId, alsoMount, announce, projectId: bodyProjectId }) {
  if (!pageId || !operator) throw new Error('pageId/operator required');
  const now = new Date().toISOString();
  const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  const p = page.properties;
  const sourceBindingId = p['群組綁定']?.relation?.[0]?.id || null;
  const sourceBinding = await assertGroupPage(deps, page, '群組綁定', 'construction.tickets.create');
  const extraPages = new Map();
  for (const extraId of Array.isArray(alsoMount) ? alsoMount.slice(0, 20) : []) {
    const extraPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(extraId)}`, { method: 'GET' });
    await assertGroupPage(deps, extraPage, '群組綁定', 'construction.tickets.create');
    extraPages.set(extraId, extraPage);
  }
  // 總管群訊息可能尚無專案:改用佇列選定的專案
  const projectId = p['專案']?.relation?.[0]?.id || bodyProjectId;
  if (!projectId) throw new Error('此訊息未綁定專案,無法開立回饋單(請先在佇列選專案)');
  if (deps.access && !deps.access.isTenantAll && sourceBinding && sourceBinding !== true
    && sourceBinding.role !== '總管'
    && !sourceBinding.projectIds.some((id) => String(id).replace(/-/g, '').toLowerCase() === String(projectId).replace(/-/g, '').toLowerCase())) {
    const error = new Error('找不到可存取的目的專案。');
    error.statusCode = 404;
    throw error;
  }

  let judgement = null;
  try { judgement = JSON.parse(plain(p['AI 初判結果']?.rich_text)); } catch {}
  const finalSpaceId = spaceId !== undefined ? spaceId : (judgement?.space?.id || null);
  const finalWorkItemId = workItemId !== undefined ? workItemId : (judgement?.work_item?.id || null);
  const description = plain(p['內容']?.rich_text) || plain(p['訊息']?.title);
  const sender = plain(p['發送者']?.rich_text);
  const messageTime = p['時間']?.date?.start || '';

  // 照片:本訊息 + 連帶照片訊息的 Drive 連結
  const photoMessageIds = [pageId, ...(Array.isArray(alsoMount) ? alsoMount.slice(0, 20) : [])];
  const photoUrls = [];
  for (const msgId of photoMessageIds) {
    for (const photo of await attachmentPhotos(deps, msgId)) photoUrls.push(photo.url);
  }

  const number = await nextTicketNumber(deps, projectId);
  const properties = {
    '編號': { title: [{ type: 'text', text: { content: number } }] },
    '負責群組': { relation: sourceBindingId ? [{ id: sourceBindingId }] : [] },
    '專案': { relation: [{ id: projectId }] },
    '空間': { relation: finalSpaceId ? [{ id: finalSpaceId }] : [] },
    '工項': { relation: finalWorkItemId ? [{ id: finalWorkItemId }] : [] },
    '問題描述': { rich_text: [{ type: 'text', text: { content: description.slice(0, 1900) } }] },
    '狀態': { select: { name: '開立' } },
    '逾期': { checkbox: false },
  };
  if (photoUrls.length) {
    properties['照片'] = { files: photoUrls.slice(0, 10).map((url, index) => ({ type: 'external', name: `照片${index + 1}`, external: { url } })) };
  }

  const ticket = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: deps.dataSources.feedbackTickets },
      properties,
      children: [
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText(`[歷程] ${taipeiStamp(now)} ${operator}:開立(來源:LINE 訊息)`)] } },
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText(`[來源證據] ${taipeiStamp(messageTime)} `), blueText(`${sender}:「${description.slice(0, 500)}」`)] } },
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText('來源訊息頁面:'), { type: 'text', text: { content: number, link: { url: page.url } } }] } },
      ],
    },
  });

  // 來源訊息連動確認並掛上回饋單
  await deps.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    body: { properties: {
      '掛載狀態': { select: { name: '已確認' } },
      '空間': { relation: finalSpaceId ? [{ id: finalSpaceId }] : [] },
      '工項': { relation: finalWorkItemId ? [{ id: finalWorkItemId }] : [] },
      '回饋單': { relation: [{ id: ticket.id }] },
      'AI 訊息類型': { select: { name: '問題反映' } },
      '確認者': { rich_text: [{ type: 'text', text: { content: operator } }] },
      '確認時間': { date: { start: now } },
    } },
  });
  await archiveAttachments(deps, pageId, page, finalSpaceId, finalWorkItemId);

  // 連帶照片訊息:掛載 + 連上回饋單
  if (Array.isArray(alsoMount)) {
    await Promise.all(alsoMount.slice(0, 20).map(async (extraId) => {
      try {
        const extraPage = extraPages.get(extraId)
          || await deps.notionRequest(`/v1/pages/${encodeURIComponent(extraId)}`, { method: 'GET' });
        await deps.notionRequest(`/v1/pages/${encodeURIComponent(extraId)}`, {
          method: 'PATCH',
          body: { properties: {
            '掛載狀態': { select: { name: '已確認' } },
            '空間': { relation: finalSpaceId ? [{ id: finalSpaceId }] : [] },
            '工項': { relation: finalWorkItemId ? [{ id: finalWorkItemId }] : [] },
            '回饋單': { relation: [{ id: ticket.id }] },
            '確認者': { rich_text: [{ type: 'text', text: { content: operator } }] },
            '確認時間': { date: { start: now } },
          } },
        });
        await archiveAttachments(deps, extraId, extraPage, finalSpaceId, finalWorkItemId);
      } catch (error) {
        console.warn(`ticket alsoMount failed for ${extraId}: ${error.message}`);
      }
    }));
  }

  // 開單公告:讓負責群組當下知道有這件待辦
  let announced = false;
  if (announce && sourceBindingId && deps.pushLineMessage) {
    try {
      const binding = await deps.notionRequest(`/v1/pages/${encodeURIComponent(sourceBindingId)}`, { method: 'GET' });
      const groupId = (binding.properties['LINE 群組 ID']?.rich_text || []).map((t) => t.plain_text).join('');
      const theirs = (binding.properties['對方主管']?.rich_text || []).map((t) => t.plain_text).join('');
      const ours = (binding.properties['我方主管']?.rich_text || []).map((t) => t.plain_text).join('');
      const who = theirs || ours || '負責人';
      if (groupId) {
        await deps.pushLineMessage(groupId, [
          `📋 新回饋單|${number}`,
          `問題:${description.slice(0, 120)}`,
          photoUrls.length ? `(附 ${photoUrls.length} 張現場照片)` : '',
          `請 ${who} 確認處理;影響等級與回覆期限將在單據上設定,到期前會再提醒。`,
        ].filter(Boolean).join('\n'));
        announced = true;
        await deps.notionRequest(`/v1/blocks/${encodeURIComponent(ticket.id)}/children`, {
          method: 'PATCH',
          body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText(`[推播] ${taipeiStamp(now)} 開單公告 → 負責群組`)] } }] },
        });
      }
    } catch (error) {
      console.warn(`Ticket announce failed for ${number}: ${error.message}`);
    }
  }

  return { ok: true, number, ticketUrl: ticket.url, announced };
}

// ── 掛到回饋單(供 queue 確認時把 LINE 回覆/複驗照片寫回單據)────
// { messagePageId, messagePage, ticketId, operator, alsoMountIds }
export async function linkMessageToTicket(deps, { messagePageId, messagePage, ticketId, operator, alsoMountIds = [] }) {
  const now = new Date().toISOString();
  const p = messagePage.properties;
  await assertGroupPage(deps, messagePage, '群組綁定', 'construction.tickets.update');
  const text = plain(p['內容']?.rich_text) || (p['訊息類型']?.select?.name === '文字' ? plain(p['訊息']?.title) : '');
  const sender = plain(p['發送者']?.rich_text);

  const ticket = await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
  await assertGroupPage(deps, ticket, '負責群組', 'construction.tickets.update');
  const number = plain(ticket.properties['編號']?.title);
  const currentStatus = ticket.properties['狀態']?.select?.name || '';

  for (const extraId of alsoMountIds) {
    const extraPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(extraId)}`, { method: 'GET' });
    await assertGroupPage(deps, extraPage, '群組綁定', 'construction.tickets.update');
  }
  const messageIds = [messagePageId, ...alsoMountIds];
  await Promise.all(messageIds.map((id) =>
    deps.notionRequest(`/v1/pages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { properties: { '回饋單': { relation: [{ id: ticketId }] } } },
    }).catch((error) => console.warn(`ticket relation failed for ${id}: ${error.message}`))
  ));

  const ticketProperties = {};

  if (text.trim()) {
    const existing = plain(ticket.properties['設計師回覆']?.rich_text);
    const entry = `[${taipeiStamp(now)} ${sender}] ${text.trim()}`;
    const combined = existing ? `${existing}\n${entry}` : entry;
    ticketProperties['設計師回覆'] = { rich_text: [{ type: 'text', text: { content: combined.slice(0, 1900) } }] };
    if (currentStatus === '開立') ticketProperties['狀態'] = { select: { name: '回覆中' } };
    await appendHistory(deps, ticketId, [normalText(`[回覆] ${taipeiStamp(now)} 來自 LINE,由 ${operator} 掛入。`), blueText(`${sender}:「${text.trim().slice(0, 400)}」`)]);
  }

  const photoUrls = [];
  for (const id of messageIds) {
    for (const photo of await attachmentPhotos(deps, id)) photoUrls.push(photo.url);
  }
  if (photoUrls.length) {
    const existingFiles = ticket.properties['照片']?.files || [];
    const existingUrls = new Set(existingFiles.map((f) => f.external?.url || f.file?.url));
    const newFiles = photoUrls.filter((url) => !existingUrls.has(url))
      .map((url, index) => ({ type: 'external', name: `照片${existingFiles.length + index + 1}`, external: { url } }));
    if (newFiles.length) {
      ticketProperties['照片'] = { files: [...existingFiles.filter((f) => f.external || f.file), ...newFiles].slice(0, 20) };
      await appendHistory(deps, ticketId, `[照片] ${taipeiStamp(now)} 新增 ${newFiles.length} 張(來自 LINE,由 ${operator} 掛入)`);
    }
  }

  if (Object.keys(ticketProperties).length) {
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'PATCH', body: { properties: ticketProperties } });
  }
  return { number, becameReplying: currentStatus === '開立' && Boolean(text.trim()) };
}

// ── 單據狀態機(擱置/復活條件、回覆、銷項、核准、催辦、公告)──
export async function ticketAction(deps, { ticketId, action, text, operator, workItemId, resumeDate }) {
  if (!ticketId || !action || !operator) throw new Error('ticketId/action/operator required');
  const now = new Date().toISOString();
  const trimmed = String(text || '').trim();
  // 任何狀態變更、推播預覽或實際推播，都先讀取單據並核對負責群組；
  // 因此竄改 ticketId 不會在授權檢查前發生 PATCH。
  const ticketPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
  await assertGroupPage(deps, ticketPage, '負責群組', 'construction.tickets.update');

  if (action === 'park') {
    // 擱置(待時機):觸發工項開工或重提日期到期時自動復活(由 reminders 巡邏)
    if (!trimmed) throw new Error('請填擱置原因(例:待木工進場後施作)');
    if (!workItemId && !resumeDate) throw new Error('請至少設定「觸發工項」或「重提日期」其中一項,否則單子會沉掉');
    const properties = {
      '狀態': { select: { name: '擱置(待時機)' } },
      '逾期': { checkbox: false },
      '觸發工項': { relation: workItemId ? [{ id: workItemId }] : [] },
      '重提日期': resumeDate ? { date: { start: resumeDate } } : { date: null },
    };
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'PATCH', body: { properties } });
    const triggerName = workItemId ? await pageName(deps, workItemId) : '';
    const conditions = [triggerName ? `觸發工項「${triggerName}」開工` : '', resumeDate ? `重提日期 ${resumeDate}` : ''].filter(Boolean).join(' 或 ');
    await appendHistory(deps, ticketId, [normalText(`[擱置] ${taipeiStamp(now)} ${operator}:`), blueText(`「${trimmed.slice(0, 300)}」`), normalText(`(復活條件:${conditions})`)]);
    return { ok: true, status: '擱置(待時機)' };
  }

  if (action === 'reply') {
    if (!trimmed) throw new Error('請填寫回覆內容');
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: { properties: {
        '設計師回覆': { rich_text: [{ type: 'text', text: { content: trimmed.slice(0, 1900) } }] },
        '狀態': { select: { name: '回覆中' } },
      } },
    });
    await appendHistory(deps, ticketId, [normalText(`[歷程] ${taipeiStamp(now)} ${operator}:記錄回覆,狀態 → 回覆中。`), blueText(`回覆:「${trimmed.slice(0, 300)}」`)]);
    return { ok: true, status: '回覆中' };
  }

  if (action === 'close') {
    // 銷項硬規則:必須附佐證(至少 5 字)
    if (trimmed.length < 5) throw new Error('銷項必須附佐證(複驗結果或書面回覆,至少 5 個字)');
    const photoCount = (ticketPage.properties['照片']?.files || []).length;
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: { properties: { '狀態': { select: { name: '已銷項' } }, '逾期': { checkbox: false } } },
    });
    await appendHistory(deps, ticketId, [normalText(`[銷項] ${taipeiStamp(now)} ${operator}:`), blueText(`佐證「${trimmed.slice(0, 500)}」`), normalText(`(單上照片 ${photoCount} 張)`)]);
    return { ok: true, status: '已銷項' };
  }

  if (action === 'approve' || action === 'reject') {
    // 變更單核准/退回;核准後才可施作
    const approved = action === 'approve';
    if (!approved && !trimmed) throw new Error('退回請填原因');
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: { properties: {
        '核准狀態': { select: { name: approved ? '已核准' : '退回' } },
        '核准人': { rich_text: [{ type: 'text', text: { content: operator } }] },
        '核准時間': { date: { start: now } },
        '可施作': { checkbox: approved },
      } },
    });
    await appendHistory(deps, ticketId, approved
      ? [normalText(`[歷程] ${taipeiStamp(now)} ${operator}:核准,標記可施作`)]
      : [normalText(`[歷程] ${taipeiStamp(now)} ${operator}:退回。`), blueText(`原因:「${trimmed.slice(0, 300)}」`)]);
    return { ok: true, status: approved ? '已核准' : '退回' };
  }

  if (action === 'urge' || action === 'announce-co') {
    // 催辦/變更公告:先 preview 組裝訊息,確認後才發送(見 *-send)
    const p = ticketPage.properties;
    let message = '';
    let targets = [];
    let urgeMention = null;
    if (action === 'urge') {
      const number = plain(p['編號']?.title);
      const bindingId = p['負責群組']?.relation?.[0]?.id;
      if (!bindingId) throw new Error('此單無負責群組,無法催辦');
      const binding = await deps.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
      const groupId = plain(binding.properties['LINE 群組 ID']?.rich_text);
      const who = plain(binding.properties['對方主管']?.rich_text) || plain(binding.properties['我方主管']?.rich_text) || '負責人';
      let members = {};
      try { members = JSON.parse(plain(binding.properties['成員對照']?.rich_text)) || {}; } catch {}
      urgeMention = members[who] ? { name: who, userId: members[who] } : null;
      const photoCount = (p['照片']?.files || []).length;
      message = [`📣 催辦|${number}`, p['影響等級']?.select?.name ? `等級:${p['影響等級'].select.name}` : '',
        `問題:${plain(p['問題描述']?.rich_text).slice(0, 100)}`, photoCount ? `(單上有 ${photoCount} 張照片)` : '',
        `回覆期限:${(p['回覆期限']?.date?.start || '未設').slice(0, 10)}`, `請 ${who} 儘速回覆處理。`].filter(Boolean).join('\n');
      targets = [{ groupId, name: plain(binding.properties['群組名稱']?.title) }];
    } else {
      const number = plain(p['編號']?.title);
      if (p['核准狀態']?.select?.name !== '已核准') throw new Error('變更單須先核准才能公告');
      const projectId = p['專案']?.relation?.[0]?.id;
      const groups = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.groupBindings)}/query`, {
        method: 'POST',
        body: { filter: { and: [
          { property: '專案', relation: { contains: projectId } },
          { property: '狀態', select: { equals: '啟用' } },
        ] }, page_size: 100 },
      });
      targets = (groups.results || [])
        .filter((g) => ['工班', '內部'].includes(g.properties['群組角色']?.select?.name))
        .map((g) => ({ groupId: plain(g.properties['LINE 群組 ID']?.rich_text), name: plain(g.properties['群組名稱']?.title) }));
      if (!targets.length) throw new Error('此專案沒有可公告的工班/內部群');
      message = [`📢 變更公告|${number}`, `變更內容:${plain(p['變更內容']?.rich_text).slice(0, 200)}`,
        p['費用影響']?.rich_text?.length ? `費用影響:${plain(p['費用影響'].rich_text)}` : '',
        p['工期影響']?.rich_text?.length ? `工期影響:${plain(p['工期影響'].rich_text)}` : '',
        `生效日:${trimmed || '即日起'}`, `已核准,依此施作。`].filter(Boolean).join('\n');
    }
    const mention = action === 'urge' ? urgeMention : null;
    return { ok: true, preview: message, targets: targets.map((t) => t.name), _send: async () => {
      for (const t of targets) if (t.groupId) await deps.pushLineMessage(t.groupId, message, mention);
    } };
  }

  if (action === 'urge-send' || action === 'announce-co-send') {
    // 已預覽確認 → 實際發送
    const base = await ticketAction(deps, { ticketId, action: action.replace('-send', ''), text, operator });
    await base._send();
    const label = action === 'urge-send' ? '催辦' : '變更公告';
    await appendHistory(deps, ticketId, `[推播] ${taipeiStamp(now)} ${operator}:${label} → ${base.targets.join('、')}`);
    return { ok: true, sent: base.targets };
  }

  throw new Error(`unknown action: ${action}`);
}

export async function createChangeOrder(deps, { projectId, content, reason, costImpact, scheduleImpact, operator }) {
  if (!projectId || !operator) throw new Error('projectId/operator required');
  if (deps.access && !deps.access.isTenantAll) deps.access.assert('unassigned.manage');
  await assertProjectAccess(deps, projectId);
  const trimmed = String(content || '').trim();
  if (!trimmed) throw new Error('請填寫變更內容');
  const now = new Date().toISOString();
  const number = await nextTicketNumber(deps, projectId, 'co');

  const co = await deps.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: deps.dataSources.changeOrders },
      properties: {
        '編號': { title: [{ type: 'text', text: { content: number } }] },
        '專案': { relation: [{ id: projectId }] },
        '變更內容': { rich_text: [{ type: 'text', text: { content: trimmed.slice(0, 1900) } }] },
        '原因': { select: { name: ['現場條件', '設計調整', '業主需求', '法規'].includes(reason) ? reason : '現場條件' } },
        '費用影響': { rich_text: costImpact ? [{ type: 'text', text: { content: String(costImpact).slice(0, 200) } }] : [] },
        '工期影響': { rich_text: scheduleImpact ? [{ type: 'text', text: { content: String(scheduleImpact).slice(0, 200) } }] : [] },
        '核准狀態': { select: { name: '待核准' } },
        '可施作': { checkbox: false },
      },
      children: [
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [normalText(`[歷程] ${taipeiStamp(now)} ${operator}:建立變更單,狀態 待核准。`)] } },
      ],
    },
  });
  return { ok: true, number, notionUrl: co.url };
}

// ── 清單查詢(供 dashboard 呈現 / queue 掛載選單 / reminders 巡邏)──
export async function listProjects(deps, scope = null) {
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.projects)}/query`, {
    method: 'POST', body: { page_size: 100 },
  });
  const allowedProjects = await accessibleProjectIds(deps);
  return {
    projects: (result.results || []).map((page) => ({
      id: page.id,
      name: plain(page.properties['專案名稱']?.title),
      code: plain(page.properties['館別代碼']?.rich_text),
    })).filter((x) => x.name
      && (!scope || scope.has(x.code))
      && (allowedProjects === null || allowedProjects.has(String(x.id).replace(/-/g, '').toLowerCase()))),
  };
}

export async function listTickets(deps, scope = null) {
  const selectedIds = deps.access && !deps.access.isTenantAll ? (deps.access.groupBindingIds || []) : [];
  if (deps.access && !deps.access.isTenantAll && !selectedIds.length) return { items: [] };
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.feedbackTickets)}/query`, {
    method: 'POST',
    body: {
      ...(selectedIds.length ? { filter: { or: selectedIds.map((id) => ({ property: '負責群組', relation: { contains: id } })) } } : {}),
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 100,
    },
  });
  const items = [];
  for (const page of result.results || []) {
    try {
      await assertGroupPage(deps, page, '負責群組', 'construction.tickets.read');
    } catch {
      continue;
    }
    const p = page.properties;
    const projectId = p['專案']?.relation?.[0]?.id || null;
    if (!(await inScope(deps, scope, projectId))) continue;
    const spaceId = p['空間']?.relation?.[0]?.id || null;
    items.push({
      id: page.id,
      number: plain(p['編號']?.title),
      status: p['狀態']?.select?.name || '',
      level: p['影響等級']?.select?.name || '',
      description: plain(p['問題描述']?.rich_text),
      reply: plain(p['設計師回覆']?.rich_text),
      deadline: (p['回覆期限']?.date?.start || '').slice(0, 10),
      overdue: Boolean(p['逾期']?.checkbox),
      photos: (p['照片']?.files || []).length,
      photoLinks: (p['照片']?.files || []).map((f) => f.external?.url || f.file?.url).filter(Boolean).map((url) => ({
        url,
        fileId: ((url.match(/\/file\/d\/([^/]+)/) || [])[1]) || '',
      })),
      resumeDate: (p['重提日期']?.date?.start || '').slice(0, 10),
      triggerWorkItemName: p['觸發工項']?.relation?.[0]?.id ? await pageName(deps, p['觸發工項'].relation[0].id) : '',
      projectId,
      projectName: projectId ? await pageName(deps, projectId) : '',
      spaceName: spaceId ? await pageName(deps, spaceId) : '',
      notionUrl: page.url,
    });
  }
  return { items };
}

export async function listChangeOrders(deps, scope = null) {
  // 變更單目前沒有「負責群組」relation；第一版視為待分派/專案級資料，僅全群組可見。
  if (deps.access && !deps.access.isTenantAll) return { items: [] };
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.changeOrders)}/query`, {
    method: 'POST',
    body: { sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 100 },
  });
  const items = [];
  for (const page of result.results || []) {
    const p = page.properties;
    const projectId = p['專案']?.relation?.[0]?.id || null;
    if (!(await inScope(deps, scope, projectId))) continue;
    items.push({
      id: page.id,
      number: plain(p['編號']?.title),
      status: p['核准狀態']?.select?.name || '',
      content: plain(p['變更內容']?.rich_text),
      reason: p['原因']?.select?.name || '',
      costImpact: plain(p['費用影響']?.rich_text),
      scheduleImpact: plain(p['工期影響']?.rich_text),
      approver: plain(p['核准人']?.rich_text),
      approvedAt: (p['核准時間']?.date?.start || '').slice(0, 16),
      workable: Boolean(p['可施作']?.checkbox),
      projectId,
      projectName: projectId ? await pageName(deps, projectId) : '',
      notionUrl: page.url,
    });
  }
  return { items };
}

// 某專案未銷項的回饋單(供 queue 把回覆/複驗照片掛回單據的下拉)
export async function openTicketsForProject(deps, projectId) {
  if (!projectId) throw new Error('projectId required');
  await assertProjectAccess(deps, projectId);
  const selectedIds = deps.access && !deps.access.isTenantAll ? (deps.access.groupBindingIds || []) : [];
  if (deps.access && !deps.access.isTenantAll && !selectedIds.length) return [];
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.feedbackTickets)}/query`, {
    method: 'POST',
    body: {
      filter: { and: [
        { property: '專案', relation: { contains: projectId } },
        { or: [
          { property: '狀態', select: { equals: '開立' } },
          { property: '狀態', select: { equals: '回覆中' } },
        ] },
        ...(selectedIds.length ? [{ or: selectedIds.map((id) => ({ property: '負責群組', relation: { contains: id } })) }] : []),
      ] },
      page_size: 100,
    },
  });
  const rows = [];
  for (const page of result.results || []) {
    try {
      await assertGroupPage(deps, page, '負責群組', 'construction.tickets.read');
      rows.push({
        id: page.id,
        label: `${plain(page.properties['編號']?.title)} ${plain(page.properties['問題描述']?.rich_text).slice(0, 20)}`,
      });
    } catch {}
  }
  return rows;
}

// ── 工程單據管理頁 ─────────────────────────────────────────
// 原工程服務把單據分頁塞在確認佇列內；平台化後由 construction 自己擁有 /tickets，
// queue 只負責訊息確認。功能仍涵蓋回覆、銷項、催辦、擱置、變更核准/退回/公告與新建變更單。
function renderTicketsPage(tenantKey, actor, canManageProjectData) {
  const tenant = JSON.stringify(tenantKey);
  const actorJson = JSON.stringify(actor || 'Portal 使用者');
  const canProjectJson = JSON.stringify(Boolean(canManageProjectData));
  const tenantQs = encodeURIComponent(tenantKey);
  const dashboardLink = canManageProjectData ? `<a href="/dashboard?tenant=${tenantQs}">工程儀表板</a>` : '';
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>工程單據管理</title><style>
:root{--g:#2e7d52;--bg:#f5f7f6;--line:#dfe7e3;--dim:#68776f;--red:#a03e33}*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:system-ui,'Noto Sans TC',sans-serif;color:#22302a;padding-bottom:60px}
header{background:var(--g);color:#fff;padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:5}header h1{font-size:17px;margin:0}header a{color:#fff;text-decoration:none;border:1px solid #ffffff88;border-radius:7px;padding:5px 8px;font-size:13px}.op{margin-left:auto;font-size:13px}.actor{display:inline-block;padding:5px 7px;border-radius:6px;background:#ffffff2b;font-weight:600}
.tabs{display:flex;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:49px;z-index:4}.tabs button{flex:1;border:0;background:#fff;padding:12px;color:var(--dim);font-size:14px}.tabs button.active{color:var(--g);font-weight:700;border-bottom:2px solid var(--g)}
.tools{padding:10px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tools select,.tools button{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}.tools .new{margin-left:auto;background:var(--g);color:#fff;border-color:var(--g)}#count{font-size:13px;color:var(--dim)}
.list{padding:0 12px;display:grid;gap:10px}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px}.meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--dim)}.chip{background:#eef2f0;border-radius:20px;padding:2px 8px}.chip.proj,.chip.ok{background:#e3efe8;color:#17643c}.chip.warn{background:#fdf3dc;color:#806313}.chip.bad{background:#fbe5e2;color:var(--red)}
.desc{white-space:pre-wrap;line-height:1.55;margin:8px 0;font-size:14px}.note{font-size:12px;color:var(--dim);line-height:1.6}.photos{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.photos img{width:92px;height:92px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.actions button,.actions a{padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#22302a;text-decoration:none;font-size:13px}.actions .primary{background:var(--g);border-color:var(--g);color:#fff}.actions .danger{background:var(--red);border-color:var(--red);color:#fff}.empty{text-align:center;color:var(--dim);padding:50px 0}
.toast{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:#22302a;color:#fff;padding:9px 16px;border-radius:20px;font-size:13px;opacity:0;transition:.2s;z-index:20}.toast.show{opacity:.96}
</style></head><body>
<header><h1>🐌 工程單據管理</h1>${dashboardLink}<a href="/queue?tenant=${tenantQs}">確認佇列</a><div class="op">操作人 <span class="actor" id="operatorLabel"></span></div></header>
<div class="tabs"><button id="ticketTab" class="active">回饋單</button><button id="coTab">變更單</button></div>
<div class="tools"><select id="status"></select><span id="count"></span><button id="reload">重新整理</button><button id="newCo" class="new" style="display:none">＋ 新增變更單</button></div>
<main class="list" id="list"><div class="empty">載入中…</div></main><div class="toast" id="toast"></div>
<script>
const TENANT=${tenant},ACTOR=${actorJson},CAN_PROJECT=${canProjectJson};let mode='tickets',items=[];
document.getElementById('operatorLabel').textContent=ACTOR;
function operator(){return ACTOR}
function esc(v){return String(v||'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}
function toast(v){const e=document.getElementById('toast');e.textContent=v;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
async function api(path,opts){const sep=path.includes('?')?'&':'?';const r=await fetch('/tickets/api/'+path+sep+'tenant='+encodeURIComponent(TENANT),opts);const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function queueApi(path){const sep=path.includes('?')?'&':'?';const r=await fetch('/queue/api/'+path+sep+'tenant='+encodeURIComponent(TENANT));const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
function chip(s){const c=['已銷項','已核准'].includes(s)?'ok':['逾期','退回'].includes(s)?'bad':'warn';return '<span class="chip '+c+'">'+esc(s)+'</span>'}
function ticketCard(i){
 const photos=(i.photoLinks||[]).map(p=>'<a href="'+esc(p.url)+'" target="_blank"><img src="'+esc(p.url)+'"></a>').join('');
 const actions=i.status==='已銷項'?'':'<div class="actions"><button data-do="act" data-id="'+esc(i.id)+'" data-action="reply">填回覆</button><button class="primary" data-do="act" data-id="'+esc(i.id)+'" data-action="close">銷項（需佐證）</button><button class="danger" data-do="push" data-id="'+esc(i.id)+'" data-action="urge">📣 催辦</button>'+(i.status!=='擱置(待時機)'?'<button data-do="park" data-id="'+esc(i.id)+'" data-project="'+esc(i.projectId||'')+'">擱置</button>':'')+'</div>';
 return '<article class="card"><div class="meta"><span class="chip proj">'+esc(i.projectName)+'</span><b>'+esc(i.number)+'</b>'+chip(i.status)+(i.level?'<span class="chip">'+esc(i.level)+'</span>':'')+(i.overdue?'<span class="chip bad">逾期</span>':'')+'</div><div class="desc">'+esc(i.description)+'</div><div class="photos">'+photos+'</div><div class="note">空間：'+esc(i.spaceName||'—')+' ・期限：'+esc(i.deadline||'未設')+(i.reply?'<br>回覆：'+esc(i.reply):'')+(i.status==='擱置(待時機)'?'<br>復活條件：'+esc([i.triggerWorkItemName,i.resumeDate].filter(Boolean).join(' 或 ')||'未設'):'')+'</div><div class="actions"><a href="'+esc(i.notionUrl)+'" target="_blank">開啟完整單據</a></div>'+actions+'</article>'
}
function coCard(i){
 let actions='';if(i.status==='待核准')actions='<div class="actions"><button class="primary" data-do="act" data-id="'+esc(i.id)+'" data-action="approve">核准</button><button data-do="act" data-id="'+esc(i.id)+'" data-action="reject">退回</button></div>';else if(i.status==='已核准')actions='<div class="actions"><button class="danger" data-do="push" data-id="'+esc(i.id)+'" data-action="announce-co">📢 變更公告</button></div>';
 return '<article class="card"><div class="meta"><span class="chip proj">'+esc(i.projectName)+'</span><b>'+esc(i.number)+'</b>'+chip(i.status)+(i.workable?'<span class="chip ok">可施作</span>':'<span class="chip bad">不可施作</span>')+'</div><div class="desc">'+esc(i.content)+'</div><div class="note">原因：'+esc(i.reason||'—')+' ・費用：'+esc(i.costImpact||'—')+' ・工期：'+esc(i.scheduleImpact||'—')+(i.approver?'<br>'+esc(i.approver)+' 於 '+esc(i.approvedAt)+' 處理':'')+'</div><div class="actions"><a href="'+esc(i.notionUrl)+'" target="_blank">開啟完整單據</a></div>'+actions+'</article>'
}
function statuses(){return mode==='tickets'?['全部','開立','回覆中','擱置(待時機)','已銷項']:['全部','待核准','已核准','退回']}
function draw(){const f=document.getElementById('status').value;const shown=items.filter(i=>!f||f==='全部'||i.status===f);document.getElementById('count').textContent='共 '+shown.length+' 筆';document.getElementById('list').innerHTML=shown.length?shown.map(mode==='tickets'?ticketCard:coCard).join(''):'<div class="empty">沒有符合的單據</div>'}
async function load(){document.getElementById('list').innerHTML='<div class="empty">載入中…</div>';const data=await api(mode==='tickets'?'list':'change-orders');items=data.items||[];const s=document.getElementById('status');s.innerHTML=statuses().map(x=>'<option>'+x+'</option>').join('');document.getElementById('newCo').style.display=mode==='co'&&CAN_PROJECT?'':'none';draw()}
async function act(id,action){try{const who=operator();let text='';if(action==='reply')text=prompt('回覆內容：')||'';if(action==='close')text=prompt('銷項佐證（至少 5 字）：')||'';if(action==='reject')text=prompt('退回原因：')||'';if(['reply','close','reject'].includes(action)&&!text.trim())return;if(action==='approve'&&!confirm('確定核准並標記可施作？'))return;const r=await api('action',{method:'POST',body:JSON.stringify({ticketId:id,action,text,operator:who})});toast('完成：'+r.status);load()}catch(e){if(e.message!=='no operator')toast('失敗：'+e.message)}}
async function pushDoc(id,kind){try{const who=operator();let text=kind==='announce-co'?(prompt('生效日（留空＝即日起）：')||''):'';const p=await api('action',{method:'POST',body:JSON.stringify({ticketId:id,action:kind,text,operator:who})});if(!confirm('將發送至：'+p.targets.join('、')+'\\n\\n'+p.preview+'\\n\\n確定發送？'))return;const r=await api('action',{method:'POST',body:JSON.stringify({ticketId:id,action:kind+'-send',text,operator:who})});toast('已推播至 '+r.sent.join('、'));load()}catch(e){if(e.message!=='no operator')toast('失敗：'+e.message)}}
async function park(id,projectId){try{const who=operator();const reason=prompt('擱置原因：')||'';if(!reason.trim())return;const opts=projectId?await queueApi('options?project='+encodeURIComponent(projectId)):{workItems:[]};const choices=(opts.workItems||[]).map((x,n)=>(n+1)+'. '+x.name).join('\\n');const pick=choices?(prompt('觸發工項（輸入編號；可留空改用日期）：\\n'+choices)||''):'';const wi=/^\d+$/.test(pick)?opts.workItems[Number(pick)-1]:null;const date=prompt('重提日期 YYYY-MM-DD（已有觸發工項可留空）：')||'';if(!wi&&!date)throw new Error('觸發工項或重提日期至少填一項');const r=await api('action',{method:'POST',body:JSON.stringify({ticketId:id,action:'park',text:reason,operator:who,workItemId:wi?.id||null,resumeDate:date||null})});toast('已擱置：'+r.status);load()}catch(e){if(e.message!=='no operator')toast('失敗：'+e.message)}}
async function createCo(){try{const who=operator();const data=await api('projects');if(!data.projects.length)throw new Error('沒有可用專案');const menu=data.projects.map((x,n)=>(n+1)+'. '+x.name+' ('+x.code+')').join('\\n');const pick=Number(prompt('選擇專案：\\n'+menu)||0);const p=data.projects[pick-1];if(!p)return;const content=prompt('變更內容：')||'';if(!content.trim())return;const reason=prompt('原因（設計變更／現場條件／業主需求…）：')||'';const costImpact=prompt('費用影響（可留空）：')||'';const scheduleImpact=prompt('工期影響（可留空）：')||'';const r=await api('create-co',{method:'POST',body:JSON.stringify({projectId:p.id,content,reason,costImpact,scheduleImpact,operator:who})});toast('已建立 '+r.number);load()}catch(e){if(e.message!=='no operator')toast('失敗：'+e.message)}}
document.getElementById('ticketTab').onclick=()=>{mode='tickets';document.getElementById('ticketTab').classList.add('active');document.getElementById('coTab').classList.remove('active');load()};
document.getElementById('coTab').onclick=()=>{mode='co';document.getElementById('coTab').classList.add('active');document.getElementById('ticketTab').classList.remove('active');load()};
document.getElementById('status').onchange=draw;document.getElementById('reload').onclick=load;document.getElementById('newCo').onclick=createCo;load().catch(e=>document.getElementById('list').innerHTML='<div class="empty">載入失敗：'+esc(e.message)+'</div>');
document.getElementById('list').addEventListener('click',e=>{const b=e.target.closest('button[data-do]');if(!b)return;if(b.dataset.do==='act')act(b.dataset.id,b.dataset.action);if(b.dataset.do==='push')pushDoc(b.dataset.id,b.dataset.action);if(b.dataset.do==='park')park(b.dataset.id,b.dataset.project)});
</script></body></html>`;
}

// ── 單據 API(/tickets/api/*)——沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps)。
// scope 由 index.js 的 webRoute 依 Portal 授權注入 URL(單據操作僅需已認證,不看 budget/contract)。
// 掛載 UI(選空間/工項)屬 queue;此處只負責開單與單據狀態機,供 queue 前端呼叫。
export async function handleTicketsRequest(req, res, pathname, url, deps) {
  // 授權已在 index.webRoute(core.portal)完成;此處只讀 webRoute 重算後注入的 scope,不再自檢 key。
  const scope = parseScope(url);
  try {
    if (req.method === 'GET' && pathname === '/tickets') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderTicketsPage(deps.tenantKey, deps.actor, deps.access?.isTenantAll));
    }
    if (req.method === 'GET' && pathname === '/tickets/api/list') {
      return sendJson(res, 200, await listTickets(deps, scope));
    }
    if (req.method === 'GET' && pathname === '/tickets/api/change-orders') {
      return sendJson(res, 200, await listChangeOrders(deps, scope));
    }
    if (req.method === 'GET' && pathname === '/tickets/api/projects') {
      return sendJson(res, 200, await listProjects(deps, scope));
    }
    if (req.method === 'GET' && pathname === '/tickets/api/open') {
      return sendJson(res, 200, { tickets: await openTicketsForProject(deps, url.searchParams.get('project')) });
    }
    if (req.method === 'GET' && pathname === '/tickets/api/trades') {
      return sendJson(res, 200, { trades: deps.listTrades ? await deps.listTrades() : [] });
    }
    if (req.method === 'POST' && pathname === '/tickets/api/create-ticket') {
      const body = await readJsonBody(req);
      body.operator = deps.actor;
      return sendJson(res, 200, await createTicket(deps, body));
    }
    if (req.method === 'POST' && pathname === '/tickets/api/create-co') {
      const body = await readJsonBody(req);
      body.operator = deps.actor;
      return sendJson(res, 200, await createChangeOrder(deps, body));
    }
    if (req.method === 'POST' && pathname === '/tickets/api/action') {
      // urge/announce-co 回傳含 _send() 函式;JSON 序列化自動忽略,只留 preview/targets(比照 BuildAM)。
      const body = await readJsonBody(req);
      body.operator = deps.actor;
      return sendJson(res, 200, await ticketAction(deps, body));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Construction tickets error:', error);
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

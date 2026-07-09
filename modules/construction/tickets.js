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
  // 總管群訊息可能尚無專案:改用佇列選定的專案
  const projectId = p['專案']?.relation?.[0]?.id || bodyProjectId;
  if (!projectId) throw new Error('此訊息未綁定專案,無法開立回饋單(請先在佇列選專案)');

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
  const sourceBindingId = p['群組綁定']?.relation?.[0]?.id || null;
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
        const extraPage = await deps.notionRequest(`/v1/pages/${encodeURIComponent(extraId)}`, { method: 'GET' });
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
  const text = plain(p['內容']?.rich_text) || (p['訊息類型']?.select?.name === '文字' ? plain(p['訊息']?.title) : '');
  const sender = plain(p['發送者']?.rich_text);

  const ticket = await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
  const number = plain(ticket.properties['編號']?.title);
  const currentStatus = ticket.properties['狀態']?.select?.name || '';

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
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
    const photoCount = (page.properties['照片']?.files || []).length;
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
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticketId)}`, { method: 'GET' });
    const p = page.properties;
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
  return {
    projects: (result.results || []).map((page) => ({
      id: page.id,
      name: plain(page.properties['專案名稱']?.title),
      code: plain(page.properties['館別代碼']?.rich_text),
    })).filter((x) => x.name && (!scope || scope.has(x.code))),
  };
}

export async function listTickets(deps, scope = null) {
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.feedbackTickets)}/query`, {
    method: 'POST',
    body: { sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 100 },
  });
  const items = [];
  for (const page of result.results || []) {
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
  const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(deps.dataSources.feedbackTickets)}/query`, {
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
  return (result.results || []).map((page) => ({
    id: page.id,
    label: `${plain(page.properties['編號']?.title)} ${plain(page.properties['問題描述']?.rich_text).slice(0, 20)}`,
  }));
}

// ── 單據 API(/tickets/api/*)——沿用 BuildAM 原簽名 handler(req,res,pathname,url,deps)。
// scope 由 index.js 的 webRoute 依 Portal 授權注入 URL(單據操作僅需已認證,不看 budget/contract)。
// 掛載 UI(選空間/工項)屬 queue;此處只負責開單與單據狀態機,供 queue 前端呼叫。
export async function handleTicketsRequest(req, res, pathname, url, deps) {
  // 授權已在 index.webRoute(core.portal)完成;此處只讀 webRoute 重算後注入的 scope,不再自檢 key。
  const scope = parseScope(url);
  try {
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
      return sendJson(res, 200, await createTicket(deps, await readJsonBody(req)));
    }
    if (req.method === 'POST' && pathname === '/tickets/api/create-co') {
      return sendJson(res, 200, await createChangeOrder(deps, await readJsonBody(req)));
    }
    if (req.method === 'POST' && pathname === '/tickets/api/action') {
      // urge/announce-co 回傳含 _send() 函式;JSON 序列化自動忽略,只留 preview/targets(比照 BuildAM)。
      return sendJson(res, 200, await ticketAction(deps, await readJsonBody(req)));
    }
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Construction tickets error:', error);
    return sendJson(res, 500, { error: error.message });
  }
}

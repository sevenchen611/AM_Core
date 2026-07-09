// modules/construction — 工程到期/擱置提醒 pass(工程領域規則)
// ─────────────────────────────────────────────────────────────────────────
// 抽自 BuildAM src/server.js 的 runDueReminders(684)/wakeParkedTickets(805)。這是**工程領域**規則:
//   回饋單(feedbackTickets)「明日預告/今日到期/逾期 + 逾期滿 N 天升級內部群」、
//   擱置單「觸發工項已開工 或 重提日期到 → 復活」+「週一擱置盤點」。故歸 construction 擁有。
//
// 邊界(與 reminders 協調):
//   - reminders 模組只保留**通用排程骨架**(tick 每次跑 / daily 每日一次 / evening 每晚一次)與待辦(tasks)提醒。
//   - 工程專屬的回饋單到期/擱置規則由本檔提供,以 `reminderPasses` 具名 pass 匯出,供 reminders 於「每日班次」呼叫。
//   - reminders 於 daily 分支:`for (const p of construction.reminderPasses) if (p.cadence==='daily') await p.run(deps, { cfg, today })`。
//     (reminders 原先內嵌的 runDueReminders/wakeParkedTickets 於整合時刪除,改呼叫本檔,避免兩份實作漂移。)
//
// 多租戶:一律吃 deps(由 reminders/整合者依 tenant + platform 每次組出)。
//   deps.notionRequest 已鎖定該租戶 tenantKey;deps.pushLineMessage 為共用 OA 推播(含真 @mention)。
//   ⚠️ 絕不使用模組級全域 deps;deps 逐呼叫傳入。

import { plain } from './common.js';

const richText = (c) => ({ type: 'text', text: { content: String(c) } });
const noteBlock = (c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [richText(c)] } });
const dayAfter = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const overdueDaysBetween = (today, deadline) => Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${deadline}T00:00:00Z`)) / 86400000);

// ══ 回饋單到期提醒 ═══════════════════════════════════════════════
// 升級邏輯:負責群組 → 逾期滿 cfg.escalationDays 天再升級該專案內部群/總管群(查該租戶自己的 groupBindings)。
// deps: { tenantKey, dataSources:{feedbackTickets, groupBindings}, notionRequest(已鎖租戶), pushLineMessage }
// cfg:  { escalationDays }
export async function runDueReminders(deps, cfg, today) {
  const ds = deps.dataSources;
  if (!ds.feedbackTickets || !ds.groupBindings) return { skipped: true, reason: 'no feedbackTickets/groupBindings' };
  const tomorrow = dayAfter(today);

  const pending = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.feedbackTickets)}/query`, {
    method: 'POST',
    body: {
      filter: { and: [
        { or: [
          { property: '狀態', select: { equals: '開立' } },
          { property: '狀態', select: { equals: '回覆中' } },
        ] },
        { property: '回覆期限', date: { is_not_empty: true } },
      ] },
      page_size: 100,
    },
  });

  const sent = [];
  for (const ticket of pending.results || []) {
    const p = ticket.properties;
    const deadline = (p['回覆期限']?.date?.start || '').slice(0, 10);
    const lastRemind = (p['最後提醒日']?.date?.start || '').slice(0, 10);
    if (!deadline || lastRemind === today) continue;

    let kind = null;
    if (deadline === tomorrow) kind = '預告';
    else if (deadline === today) kind = '到期';
    else if (deadline < today) kind = '逾期';
    if (!kind) continue;

    const overdueDays = kind === '逾期' ? overdueDaysBetween(today, deadline) : 0;
    const number = plain(p['編號']?.title);
    const description = plain(p['問題描述']?.rich_text).slice(0, 80);
    const level = p['影響等級']?.select?.name || '';

    // 負責群組
    const bindingId = p['負責群組']?.relation?.[0]?.id;
    if (!bindingId) { console.warn(`Ticket ${number} has no 負責群組, skip reminder.`); continue; }
    const binding = await deps.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
    const groupId = plain(binding.properties['LINE 群組 ID']?.rich_text);
    const groupName = plain(binding.properties['群組名稱']?.title);
    const theirs = plain(binding.properties['對方主管']?.rich_text);
    const ours = plain(binding.properties['我方主管']?.rich_text);
    const who = theirs || ours || '負責人';
    let members = {};
    try { members = JSON.parse(plain(binding.properties['成員對照']?.rich_text)) || {}; } catch {}
    const mention = members[who] ? { name: who, userId: members[who] } : null;
    if (!groupId) { console.warn(`Ticket ${number} binding has no group id, skip.`); continue; }

    const header = kind === '預告' ? `🔔 回饋單明日到期|${number}`
      : kind === '到期' ? `⏰ 回饋單今日到期|${number}`
        : `⚠ 回饋單已逾期 ${overdueDays} 天|${number}`;
    const lines = [header];
    if (level) lines.push(`等級:${level}`);
    lines.push(`問題:${description}`, `回覆期限:${deadline}`, `請 ${who} 儘速${kind === '逾期' ? '處理並回覆' : '回覆'}。`);

    // 升級:逾期滿 N 天 → 通知該專案內部管理群/總管群
    let escalated = false;
    const shouldEscalate = kind === '逾期' && overdueDays >= cfg.escalationDays;
    let escalationGroupId = '';
    if (shouldEscalate) {
      const projectId = p['專案']?.relation?.[0]?.id;
      if (projectId) {
        const internal = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
          method: 'POST',
          body: {
            filter: { and: [
              { property: '專案', relation: { contains: projectId } },
              { or: [
                { property: '群組角色', select: { equals: '內部' } },
                { property: '群組角色', select: { equals: '總管' } },
              ] },
              { property: '狀態', select: { equals: '啟用' } },
            ] },
            page_size: 1,
          },
        });
        escalationGroupId = plain(internal.results?.[0]?.properties['LINE 群組 ID']?.rich_text);
      }
    }

    try {
      if (shouldEscalate && escalationGroupId === groupId) {
        // 負責群組本身就是內部群:合併為一則升級訊息
        await deps.pushLineMessage(groupId, `🚨 升級通知|${lines.join('\n')}\n(已逾期 ${overdueDays} 天未處理,請 Seven 介入)`, mention);
        escalated = true;
      } else {
        await deps.pushLineMessage(groupId, lines.join('\n'), mention);
        if (shouldEscalate && escalationGroupId) {
          await deps.pushLineMessage(escalationGroupId, `🚨 升級通知|回饋單 ${number} 已逾期 ${overdueDays} 天未處理\n負責群組:${groupName}(${who})\n問題:${description}\n請 Seven 介入。`);
          escalated = true;
        }
      }
    } catch (error) {
      console.warn(`Reminder push failed for ${number}: ${error.message}`);
      continue;
    }

    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticket.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '最後提醒日': { date: { start: today } },
        '逾期': { checkbox: kind === '逾期' },
      } },
    });
    await deps.notionRequest(`/v1/blocks/${encodeURIComponent(ticket.id)}/children`, {
      method: 'PATCH',
      body: { children: [noteBlock(`[提醒] ${today} ${kind}${overdueDays ? `(${overdueDays}天)` : ''} → 推播至「${groupName}」${escalated ? ' + 內部群升級通知' : ''}`)] },
    });
    sent.push({ number, kind, overdueDays, group: groupName, escalated });
  }
  // 擱置單復活檢查:觸發工項已開工 或 重提日期到期
  const woken = await wakeParkedTickets(deps, today);

  console.log(`Reminder run ${today} (tenant=${deps.tenantKey}): ${sent.length} sent, ${woken.length} woken.`);
  return { ok: true, today, sent, woken };
}

// ══ 擱置單復活 + 週一盤點 ════════════════════════════════════════
export async function wakeParkedTickets(deps, today) {
  const ds = deps.dataSources;
  const parked = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.feedbackTickets)}/query`, {
    method: 'POST',
    body: { filter: { property: '狀態', select: { equals: '擱置(待時機)' } }, page_size: 100 },
  });
  const woken = [];
  const stillParked = [];

  for (const ticket of parked.results || []) {
    const p = ticket.properties;
    const number = plain(p['編號']?.title);
    const description = plain(p['問題描述']?.rich_text).slice(0, 60);
    const resumeDate = (p['重提日期']?.date?.start || '').slice(0, 10);
    const triggerWorkItemId = p['觸發工項']?.relation?.[0]?.id;

    let reason = '';
    if (resumeDate && resumeDate <= today) {
      reason = `重提日期(${resumeDate})已到`;
    } else if (triggerWorkItemId) {
      try {
        const workItem = await deps.notionRequest(`/v1/pages/${encodeURIComponent(triggerWorkItemId)}`, { method: 'GET' });
        const wiStatus = workItem.properties['狀態']?.select?.name || '';
        const wiName = plain(workItem.properties['工項']?.title);
        if (['進行中', '待複驗', '完成'].includes(wiStatus)) {
          reason = `觸發工項「${wiName}」已${wiStatus}`;
        }
      } catch (error) {
        console.warn(`Trigger work item check failed for ${number}: ${error.message}`);
      }
    }

    if (!reason) {
      stillParked.push({ ticket, number, description });
      continue;
    }

    // 復活:轉回開立,通知負責群組,請 PM 重設回覆期限
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(ticket.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '狀態': { select: { name: '開立' } },
        '重提日期': { date: null },
        '最後提醒日': { date: { start: today } },
      } },
    });
    await deps.notionRequest(`/v1/blocks/${encodeURIComponent(ticket.id)}/children`, {
      method: 'PATCH',
      body: { children: [noteBlock(`[復活] ${today} ${reason},狀態 → 開立`)] },
    });
    const bindingId = p['負責群組']?.relation?.[0]?.id;
    if (bindingId) {
      try {
        const binding = await deps.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
        const groupId = plain(binding.properties['LINE 群組 ID']?.rich_text);
        if (groupId) {
          await deps.pushLineMessage(groupId, `⏰ 擱置單復活|${number}\n${reason}\n問題:${description}\n此單重新列入追蹤,請安排處理(回覆期限將重新設定)。`);
        }
      } catch (error) {
        console.warn(`Wake push failed for ${number}: ${error.message}`);
      }
    }
    woken.push({ number, reason });
  }

  // 週一擱置摘要:仍在睡的單彙總推播到各專案內部群,防止遺忘
  if (stillParked.length && new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
    const byProject = new Map();
    for (const item of stillParked) {
      const projectId = item.ticket.properties['專案']?.relation?.[0]?.id;
      if (!projectId) continue;
      if (!byProject.has(projectId)) byProject.set(projectId, []);
      byProject.get(projectId).push(item);
    }
    for (const [projectId, items] of byProject) {
      try {
        const internal = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
          method: 'POST',
          body: { filter: { and: [
            { property: '專案', relation: { contains: projectId } },
            { property: '群組角色', select: { equals: '內部' } },
            { property: '狀態', select: { equals: '啟用' } },
          ] }, page_size: 1 },
        });
        const groupId = plain(internal.results?.[0]?.properties['LINE 群組 ID']?.rich_text);
        if (groupId) {
          const lines = items.map((x) => `・${x.number} ${x.description}`);
          await deps.pushLineMessage(groupId, `📌 每週擱置單盤點(${items.length} 張仍待時機)\n${lines.join('\n')}\n如時機已到,請將對應工項改為「進行中」或直接處理。`);
        }
      } catch (error) {
        console.warn(`Weekly parked summary failed: ${error.message}`);
      }
    }
  }
  return woken;
}

// ── 對外:供 reminders 呼叫的工程 pass ─────────────────────────
// 每個 pass:{ name, cadence, run(deps, { cfg, today }) }。
//   cadence='daily' → reminders 於每日班次(≥ reminderHour,當日一次)呼叫。
//   run 的 deps 需含 { tenantKey, dataSources, notionRequest(已鎖租戶), pushLineMessage };cfg 需含 { escalationDays }。
// 註:runDueReminders 內部已串接 wakeParkedTickets(復活+週一盤點),故僅需註冊一個 daily pass。
export const reminderPasses = [
  {
    name: 'feedbackDue',
    cadence: 'daily',
    async run(deps, { cfg, today }) { return runDueReminders(deps, cfg, today); },
  },
];

// 測試用內部匯出(不影響正式流程)
export const __test = { dayAfter, overdueDaysBetween };

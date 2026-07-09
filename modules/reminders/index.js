// AM Platform 模組:reminders
// ─────────────────────────────────────────────────────────────────────────
// 週期性提醒巡邏(通用排程骨架)。由三處觸發、同一入口:
//   1. core 的 10 分鐘 setInterval → dispatcher.runTicks() → 本模組 tick(ctx)(每租戶一次)
//   2. /cron/tick?key=  → 同上
//   3. /cron/reminders?key=  → 本模組 routes 的專用端點(可 ?tenant=key 指定單一租戶)
// 每次巡邏對「一個租戶」跑所有 pass:
//   • runTaskTickPass   每次:帶時刻待辦「開始前 30 分」提醒
//   • runTaskDailyPass  每日(≥ 提醒時刻,當日一次):待辦 明日預告/今日到期/逾期 + 逾期升級點名
//   • runTaskEveningPass 每日(≥20:00,當日一次):明天帶時刻行程「前一晚」預告
//   • runDueReminders   每日:回饋單 明日/今日/逾期 + 逾期升級(工程領域;讀 construction 的回饋單庫)
//   • wakeParkedTickets 每日:擱置回饋單復活(觸發工項開工 / 重提日到)+ 週一擱置盤點
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(notionRequest / pushLineMessage(含真 @mention))。
//   - 每次巡邏由 ctx.tenant 帶租戶特定設定:自己的 Notion 資料源與 envPrefix。
//   - 模組狀態(當日已跑過的日戳)一律以「租戶」為鍵(perTenant Map),各租戶各自巡邏、互不污染。
//
// 依賴邊界(尚未抽出,先於本模組內就地讀取,行為與 BuildAM 完全等同):
//   - tasks 模組:待辦庫的查詢/提醒記錄讀寫(openTasks / taskReminderRecord / markTaskReminded)。
//     tasks 模組完成後,這些改呼叫 tasks.listOpen / tasks.markReminded。
//   - construction 模組:回饋單(feedbackTickets)到期/擱置規則屬工程領域(runDueReminders / wakeParkedTickets)。
//     construction 上線後,這兩個 pass 可改由 construction 注冊「額外 pass」給 reminders。
//   兩者目前皆以 tenant.dataSources.* 直讀,無此資料源的租戶(如森在)自動略過對應 pass。
//
// 功能與 BuildAM src/server.js 的提醒引擎完全等同,只是重組成模組形狀、狀態改以租戶為鍵。

import { sendJson } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具 ──────────────────────────────────────────────────
const richText = (c) => ({ type: 'text', text: { content: String(c) } });
const noteBlock = (c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [richText(c)] } });
const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');
const taipeiNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const dayAfter = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
const overdueDaysBetween = (today, deadline) => Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${deadline}T00:00:00Z`)) / 86400000);

// 租戶提醒設定:優先 <PREFIX>_、其次平台級 AMCORE_、再退回 BUILD_(相容原 BuildAM 全域設定)。
function tenantConfig(tenant) {
  const p = tenant.envPrefix;
  const env = process.env;
  return {
    escalationDays: Number(env[`${p}_ESCALATION_DAYS`] || env.AMCORE_ESCALATION_DAYS || env.BUILD_ESCALATION_DAYS || 2),
    reminderHour: Number(env[`${p}_REMINDER_HOUR`] || env.AMCORE_REMINDER_HOUR || env.BUILD_REMINDER_HOUR || 9),
    escalationOwner: env[`${p}_ESCALATION_OWNER`] || env.AMCORE_ESCALATION_OWNER || env.BUILD_ESCALATION_OWNER || 'Seven陳聖文',
  };
}

// ── 每租戶巡邏狀態(當日一次的日戳,以 tenant.key 為鍵)────────
const lastDailyDate = new Map();    // tenant.key → 'YYYY-MM-DD'
const lastEveningDate = new Map();  // tenant.key → 'YYYY-MM-DD'

// ══ 回饋單提醒(工程領域;讀 construction 的 feedbackTickets)══════════════
// 升級邏輯:負責群組 → 逾期滿 N 天再升級該專案內部群/總管群(per 租戶,查該租戶自己的 groupBindings)。
async function runDueReminders(tenant, cfg, today) {
  const ds = tenant.dataSources;
  if (!ds.feedbackTickets || !ds.groupBindings) return { skipped: true, reason: 'no feedbackTickets/groupBindings' };
  const tomorrow = dayAfter(today);

  const pending = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.feedbackTickets)}/query`, {
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
    const binding = await platform.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
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
        const internal = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
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
        await platform.pushLineMessage(groupId, `🚨 升級通知|${lines.join('\n')}\n(已逾期 ${overdueDays} 天未處理,請 Seven 介入)`, mention);
        escalated = true;
      } else {
        await platform.pushLineMessage(groupId, lines.join('\n'), mention);
        if (shouldEscalate && escalationGroupId) {
          await platform.pushLineMessage(escalationGroupId, `🚨 升級通知|回饋單 ${number} 已逾期 ${overdueDays} 天未處理\n負責群組:${groupName}(${who})\n問題:${description}\n請 Seven 介入。`);
          escalated = true;
        }
      }
    } catch (error) {
      console.warn(`Reminder push failed for ${number}: ${error.message}`);
      continue;
    }

    await platform.notionRequest(`/v1/pages/${encodeURIComponent(ticket.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '最後提醒日': { date: { start: today } },
        '逾期': { checkbox: kind === '逾期' },
      } },
    });
    await platform.notionRequest(`/v1/blocks/${encodeURIComponent(ticket.id)}/children`, {
      method: 'PATCH',
      body: { children: [noteBlock(`[提醒] ${today} ${kind}${overdueDays ? `(${overdueDays}天)` : ''} → 推播至「${groupName}」${escalated ? ' + 內部群升級通知' : ''}`)] },
    });
    sent.push({ number, kind, overdueDays, group: groupName, escalated });
  }
  // 擱置單復活檢查:觸發工項已開工 或 重提日期到期
  const woken = await wakeParkedTickets(tenant, today);

  console.log(`Reminder run ${today} (tenant=${tenant.key}): ${sent.length} sent, ${woken.length} woken.`);
  return { ok: true, today, sent, woken };
}

async function wakeParkedTickets(tenant, today) {
  const ds = tenant.dataSources;
  const parked = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.feedbackTickets)}/query`, {
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
        const workItem = await platform.notionRequest(`/v1/pages/${encodeURIComponent(triggerWorkItemId)}`, { method: 'GET' });
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
    await platform.notionRequest(`/v1/pages/${encodeURIComponent(ticket.id)}`, {
      method: 'PATCH',
      body: { properties: {
        '狀態': { select: { name: '開立' } },
        '重提日期': { date: null },
        '最後提醒日': { date: { start: today } },
      } },
    });
    await platform.notionRequest(`/v1/blocks/${encodeURIComponent(ticket.id)}/children`, {
      method: 'PATCH',
      body: { children: [noteBlock(`[復活] ${today} ${reason},狀態 → 開立`)] },
    });
    const bindingId = p['負責群組']?.relation?.[0]?.id;
    if (bindingId) {
      try {
        const binding = await platform.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
        const groupId = plain(binding.properties['LINE 群組 ID']?.rich_text);
        if (groupId) {
          await platform.pushLineMessage(groupId, `⏰ 擱置單復活|${number}\n${reason}\n問題:${description}\n此單重新列入追蹤,請安排處理(回覆期限將重新設定)。`);
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
        const internal = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
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
          await platform.pushLineMessage(groupId, `📌 每週擱置單盤點(${items.length} 張仍待時機)\n${lines.join('\n')}\n如時機已到,請將對應工項改為「進行中」或直接處理。`);
        }
      } catch (error) {
        console.warn(`Weekly parked summary failed: ${error.message}`);
      }
    }
  }
  return woken;
}

// ══ 待辦任務提醒(原群組推播/逾期升級 Seven/行程前一晚+30 分)══════════
// 原群組(負責群組),沒有就退回專案內部群。
async function taskGroupInfo(tenant, task) {
  const ds = tenant.dataSources;
  let bindingId = task.properties['負責群組']?.relation?.[0]?.id;
  if (!bindingId) {
    const projectId = task.properties['專案']?.relation?.[0]?.id;
    if (!projectId) return null;
    const internal = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
      method: 'POST',
      body: { filter: { and: [
        { property: '專案', relation: { contains: projectId } },
        { property: '群組角色', select: { equals: '內部' } },
        { property: '狀態', select: { equals: '啟用' } },
      ] }, page_size: 1 },
    });
    bindingId = internal.results?.[0]?.id;
    if (!bindingId) return null;
  }
  const binding = await platform.notionRequest(`/v1/pages/${encodeURIComponent(bindingId)}`, { method: 'GET' });
  let members = {};
  try { members = JSON.parse(plain(binding.properties['成員對照']?.rich_text)) || {}; } catch {}
  return {
    groupId: plain(binding.properties['LINE 群組 ID']?.rich_text),
    name: plain(binding.properties['群組名稱']?.title),
    members,
  };
}

async function openTasks(tenant) {
  const ds = tenant.dataSources;
  const result = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.tasks)}/query`, {
    method: 'POST',
    body: { filter: { and: [
      { or: [
        { property: '狀態', select: { equals: '待辦' } },
        { property: '狀態', select: { equals: '進行中' } },
      ] },
      { property: '期限', date: { is_not_empty: true } },
    ] }, page_size: 100 },
  });
  return result.results || [];
}

async function markTaskReminded(task, key, value) {
  let record = {};
  try { record = JSON.parse(plain(task.properties['提醒記錄']?.rich_text)) || {}; } catch {}
  record[key] = value;
  await platform.notionRequest(`/v1/pages/${encodeURIComponent(task.id)}`, {
    method: 'PATCH',
    body: { properties: { '提醒記錄': { rich_text: [richText(JSON.stringify(record).slice(0, 1900))] } } },
  });
}

function taskReminderRecord(task) {
  try { return JSON.parse(plain(task.properties['提醒記錄']?.rich_text)) || {}; } catch { return {}; }
}

async function pushTaskReminder(tenant, task, header, extra) {
  const info = await taskGroupInfo(tenant, task);
  if (!info?.groupId) return false;
  const content = plain(task.properties['內容']?.title);
  const owner = plain(task.properties['負責人']?.rich_text);
  const due = task.properties['期限']?.date?.start || '';
  const dueLabel = due.includes('T') ? `${due.slice(0, 10)} ${due.slice(11, 16)}` : due.slice(0, 10);
  const who = owner || '負責人';
  const mention = info.members[who] ? { name: who, userId: info.members[who] } : null;
  const text = [header, `內容:${content}`, `期限:${dueLabel}`, extra || `請 ${who} 留意。`].filter(Boolean).join('\n');
  await platform.pushLineMessage(info.groupId, text, mention);
  return true;
}

// 每日班次(09:00):明日預告/今日到期/逾期,逾期滿 N 天升級 Seven(內部群/總管群)
async function runTaskDailyPass(tenant, cfg, today) {
  const ds = tenant.dataSources;
  const tomorrow = dayAfter(today);
  const sent = [];
  for (const task of await openTasks(tenant)) {
    const record = taskReminderRecord(task);
    if (record.daily === today) continue;
    const due = (task.properties['期限']?.date?.start || '').slice(0, 10);
    if (!due) continue;
    let header = null;
    let extra = null;
    if (due === tomorrow) header = '🔔 待辦明日到期';
    else if (due === today) header = '⏰ 待辦今日到期';
    else if (due < today) {
      const overdueDays = overdueDaysBetween(today, due);
      header = `⚠ 待辦已逾期 ${overdueDays} 天`;
      if (overdueDays >= cfg.escalationDays) extra = '請儘速處理;此事項已升級通知 Seven。';
      if (overdueDays >= cfg.escalationDays) {
        // 升級:通知該專案內部群/總管群點名負責人
        const projectId = task.properties['專案']?.relation?.[0]?.id;
        if (projectId) {
          const internal = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(ds.groupBindings)}/query`, {
            method: 'POST',
            body: { filter: { and: [
              { property: '專案', relation: { contains: projectId } },
              { or: [
                { property: '群組角色', select: { equals: '內部' } },
                { property: '群組角色', select: { equals: '總管' } },
              ] },
              { property: '狀態', select: { equals: '啟用' } },
            ] }, page_size: 1 },
          });
          const ib = internal.results?.[0];
          const gid = ib ? plain(ib.properties['LINE 群組 ID']?.rich_text) : '';
          if (gid) {
            const content = plain(task.properties['內容']?.title);
            let members = {};
            try { members = JSON.parse(plain(ib.properties['成員對照']?.rich_text)) || {}; } catch {}
            const owner = cfg.escalationOwner;
            const mention = members[owner] ? { name: owner, userId: members[owner] } : null;
            await platform.pushLineMessage(gid, `🚨 升級通知|待辦逾期 ${overdueDays} 天未完成\n內容:${content}\n請 ${owner} 介入。`, mention).catch(() => {});
          }
        }
      }
    }
    if (!header) continue;
    if (await pushTaskReminder(tenant, task, header, extra).catch(() => false)) {
      await markTaskReminded(task, 'daily', today).catch(() => {});
      sent.push(header);
    }
  }
  return sent.length;
}

// 前一晚班次(20:00):明天有「帶時刻」的行程 → 預告
async function runTaskEveningPass(tenant, today) {
  const tomorrow = dayAfter(today);
  let sent = 0;
  for (const task of await openTasks(tenant)) {
    const due = task.properties['期限']?.date?.start || '';
    if (!due.includes('T') || due.slice(0, 10) !== tomorrow) continue;
    const record = taskReminderRecord(task);
    if (record.evening === today) continue;
    if (await pushTaskReminder(tenant, task, '🌙 明日行程預告', null).catch(() => false)) {
      await markTaskReminded(task, 'evening', today).catch(() => {});
      sent++;
    }
  }
  return sent;
}

// 巡邏班次(每 15 分):帶時刻行程開始前 45 分鐘內 → 半小時前提醒
async function runTaskTickPass(tenant) {
  const now = Date.now();
  let sent = 0;
  for (const task of await openTasks(tenant)) {
    const due = task.properties['期限']?.date?.start || '';
    if (!due.includes('T')) continue;
    const dueTime = Date.parse(due);
    if (!(dueTime > now && dueTime - now <= 45 * 60 * 1000)) continue;
    const record = taskReminderRecord(task);
    if (record.t30) continue;
    const minutes = Math.round((dueTime - now) / 60000);
    if (await pushTaskReminder(tenant, task, `⏳ 行程即將開始(約 ${minutes} 分鐘後)`, null).catch(() => false)) {
      await markTaskReminded(task, 't30', due).catch(() => {});
      sent++;
    }
  }
  return sent;
}

// ── 統一巡邏入口(單一租戶)─────────────────────────────────
// tick 每次跑;每日班次(≥ 提醒時刻)當日補跑一次;前一晚班次(≥20:00)當日補跑一次。
// 「當日一次」的日戳以 tenant.key 為鍵,各租戶各自累積,互不影響。
async function runPassesForTenant(tenant) {
  if (!tenant) return null;
  const cfg = tenantConfig(tenant);
  const now = taipeiNow();
  const today = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const result = { tenant: tenant.key, tick: 0, daily: null, evening: null };

  result.tick = await runTaskTickPass(tenant).catch((e) => { console.warn(`tick pass failed (tenant=${tenant.key}):`, e.message); return 0; });

  if (hour >= cfg.reminderHour && lastDailyDate.get(tenant.key) !== today) {
    lastDailyDate.set(tenant.key, today);
    const tickets = await runDueReminders(tenant, cfg, today).catch((e) => ({ error: e.message }));
    const tasks = await runTaskDailyPass(tenant, cfg, today).catch((e) => { console.warn(`task daily failed (tenant=${tenant.key}):`, e.message); return 0; });
    result.daily = { tickets: tickets?.sent?.length ?? 0, tasks };
  }
  if (hour >= 20 && lastEveningDate.get(tenant.key) !== today) {
    lastEveningDate.set(tenant.key, today);
    result.evening = await runTaskEveningPass(tenant, today).catch((e) => { console.warn(`evening failed (tenant=${tenant.key}):`, e.message); return 0; });
  }
  return result;
}

// ── 模組契約 ────────────────────────────────────────────────
// 排程觸發:core 每租戶呼叫一次 tick(ctx)。ctx = { tenant, notionRequest }。
async function tick(ctx) {
  return runPassesForTenant(ctx.tenant);
}

// /cron/reminders 端點:外部 cron(GitHub Actions)以 ?key= 觸發;可 ?tenant=key 指定單一租戶。
// 未指定則巡邏所有「啟用 reminders」的租戶。授權沿用平台佇列金鑰(與 server.js /cron/tick 一致)。
function cronAuthorized(url) {
  const key = process.env.AMCORE_QUEUE_ACCESS_KEY || process.env.BUILD_QUEUE_ACCESS_KEY || '';
  return Boolean(key) && url.searchParams.get('key') === key;
}

const routes = [
  {
    prefix: '/cron/reminders',
    async handler(req, res, ctx) {
      const { url, tenants } = ctx;
      if (!cronAuthorized(url)) return sendJson(res, 401, { error: 'Unauthorized' });
      const requested = url.searchParams.get('tenant');
      const targets = (tenants || []).filter((t) => (t.modules || []).includes('reminders') && (!requested || t.key === requested));
      try {
        const results = [];
        for (const t of targets) results.push(await runPassesForTenant(t));
        return sendJson(res, 200, { ok: true, results: results.filter(Boolean) });
      } catch (error) {
        console.error('Cron reminders failed:', error);
        return sendJson(res, 500, { error: error.message });
      }
    },
  },
];

export default {
  name: 'reminders',
  init,
  tick,      // (ctx) 單一租戶巡邏一輪(由 core runTicks 每租戶呼叫)
  routes,    // /cron/reminders 專用端點
};

// 測試用內部匯出(不影響正式流程)
export const __test = {
  tenantConfig, runPassesForTenant, runDueReminders, wakeParkedTickets,
  runTaskDailyPass, runTaskEveningPass, runTaskTickPass, taskGroupInfo, openTasks,
};

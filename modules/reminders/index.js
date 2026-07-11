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
//   • reminderPasses    每日:委派 construction 註冊的工程 pass(回饋單到期/升級、擱置復活/週一盤點)。
//                       reminders 只迭代呼叫 platform.reminderPasses,不自帶工程領域規則。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(notionRequest / pushLineMessage(含真 @mention))。
//   - 每次巡邏由 ctx.tenant 帶租戶特定設定:自己的 Notion 資料源與 envPrefix。
//   - 模組狀態(當日已跑過的日戳)一律以「租戶」為鍵(perTenant Map),各租戶各自巡邏、互不污染。
//
// 依賴邊界:
//   - tasks 模組:待辦庫的查詢/提醒記錄讀寫(openTasks / taskReminderRecord / markTaskReminded)——仍就地讀取。
//     tasks 模組完成後,這些改呼叫 tasks.listOpen / tasks.markReminded。
//   - construction 模組:回饋單(feedbackTickets)到期/擱置規則屬工程領域,已由 construction 以 `platform.reminderPasses`
//     註冊(`{name, cadence:'daily', run(deps, {cfg, today})}`);reminders 於每日班次迭代呼叫,不自帶實作。
//     無回饋單庫的租戶(如森在)由 pass 自身回 { skipped } 略過。
//
// 功能與 BuildAM src/server.js 的提醒引擎完全等同,只是重組成模組形狀、狀態改以租戶為鍵。

import { sendJson } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具 ──────────────────────────────────────────────────
const richText = (c) => ({ type: 'text', text: { content: String(c) } });
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

// ══ 工程到期/擱置提醒(委派 construction.reminderPasses)══════════════════
// reminders 不自帶工程領域規則;construction 於 init 把 pass 註冊到 platform.reminderPasses。
// 每個 pass:{ name, cadence, run(deps, { cfg, today }) }。此處逐一呼叫「每日」pass,錯誤隔離。
//   deps 由租戶 + platform 組出:notionRequest 已鎖該租戶 tenantKey;pushLineMessage 為共用 OA。
//   無回饋單庫的租戶(如森在)由 pass 自身回 { skipped } 略過,reminders 端不需再判租戶。
async function runReminderPasses(tenant, cfg, today) {
  const passes = platform.reminderPasses || [];
  const deps = {
    tenantKey: tenant.key,
    dataSources: tenant.dataSources || {},
    notionRequest: (pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: tenant.key }),
    pushLineMessage: platform.pushLineMessage,
  };
  const out = [];
  for (const pass of passes) {
    if (pass.cadence !== 'daily') continue;
    try {
      out.push({ name: pass.name, result: await pass.run(deps, { cfg, today }) });
    } catch (error) {
      console.warn(`reminderPass "${pass.name}" failed (tenant=${tenant.key}): ${error.message}`);
      out.push({ name: pass.name, result: { error: error.message } });
    }
  }
  return out;
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
    // 工程回饋單到期/擱置 pass:委派 construction.reminderPasses(每日)。sent 數彙總各 pass。
    const passes = await runReminderPasses(tenant, cfg, today).catch((e) => { console.warn(`reminder passes failed (tenant=${tenant.key}):`, e.message); return []; });
    const tasks = await runTaskDailyPass(tenant, cfg, today).catch((e) => { console.warn(`task daily failed (tenant=${tenant.key}):`, e.message); return 0; });
    const tickets = passes.reduce((n, p) => n + (p.result?.sent?.length ?? 0), 0);
    result.daily = { tickets, tasks };
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
  tenantConfig, runPassesForTenant, runReminderPasses,
  runTaskDailyPass, runTaskEveningPass, runTaskTickPass, taskGroupInfo, openTasks,
};

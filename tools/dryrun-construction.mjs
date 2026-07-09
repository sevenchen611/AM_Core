// AM Platform — construction ③ 乾跑驗證(不需真憑證、不打真 API、不碰 BuildAM)
// 用假 deps + 假 AI(mock fetch)驅動 construction 的領域檔,證明行為等同 BuildAM src/server.js:
//   classify.js  ← loadProjectContext / buildJudgePrompt / callAiJudge / extractJudgeJson 的「分類」部分
//   reminders.js ← runDueReminders(684) / wakeParkedTickets(805)
//
// 執行:node tools/dryrun-construction.mjs
import assert from 'node:assert';
import { classify, loadProjectContext, clearContextCache, enabledFor, aiConfigured, __test as C } from '../modules/construction/classify.js';
import { runDueReminders, wakeParkedTickets, reminderPasses, __test as R } from '../modules/construction/reminders.js';

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (e) => results.push([false, `${name} — ${e.message}`]),
  );
}

// ── 假 Notion:回饋單/綁定/空間/工項查詢皆可注入;記錄所有寫入 ──
function makeDeps(over = {}) {
  const calls = [];
  const deps = {
    tenantKey: 'engineering',
    dataSources: { spaces: 'DS_SPACE', workItems: 'DS_WI', feedbackTickets: 'DS_FB', groupBindings: 'DS_GB' },
    pushLineMessage: async (to, text, mention) => { calls.push({ kind: 'push', to, text, mention }); },
    notionRequest: async (pathname, opts = {}) => {
      calls.push({ kind: 'notion', pathname, method: opts.method, body: opts.body });
      return (over.notion && over.notion(pathname, opts)) ?? {};
    },
    ai: { provider: 'anthropic', anthropicApiKey: 'k', judgeModel: 'claude-x' },
    ...over.deps,
  };
  return { deps, calls };
}

// ════════════════ classify.js ════════════════

// 1) enabledFor / aiConfigured 門檻
await check('enabledFor 需空間+工項;aiConfigured 依 provider', () => {
  assert.equal(enabledFor({ spaces: 'a', workItems: 'b' }), true);
  assert.equal(enabledFor({ spaces: 'a' }), false);
  assert.equal(aiConfigured({ provider: 'anthropic', anthropicApiKey: 'k', judgeModel: 'm' }), true);
  assert.equal(aiConfigured({ provider: 'anthropic', judgeModel: 'm' }), false);
  assert.equal(aiConfigured({ provider: 'minimax', minimaxApiKey: 'k', judgeModel: 'm' }), true);
  assert.equal(aiConfigured({ provider: 'x', judgeModel: 'm' }), false);
});

// 2) buildJudgePrompt 帶入空間/工項/別名 + 群組角色(領域知識)
await check('buildJudgePrompt 含空間/工項/別名', () => {
  const prompt = C.buildJudgePrompt({
    text: '301房木作歪了', senderName: '阿明',
    binding: { role: '工班', trade: '木作' },
    context: { spaces: [{ name: '301房', alias: '三樓A' }], workItems: [{ name: '木作' }] },
  });
  assert.match(prompt, /工種:木作/);
  assert.match(prompt, /301房/);
  assert.match(prompt, /三樓A/); // 別名對照有帶入
  assert.match(prompt, /木作/);
});

// 3) classify:mock AI → judgement,space/work_item 對回真頁 id,型別/信心正規化,且「不寫 Notion 訊息頁」
await check('classify 產 judgement 且不寫訊息頁', async () => {
  const spacesPage = { results: [{ id: 'sp1', properties: { '名稱': { title: [{ plain_text: '301房' }] }, '別名': { rich_text: [] } } }] };
  const wiPage = { results: [{ id: 'wi1', properties: { '工項': { title: [{ plain_text: '木作' }] } } }] };
  const { deps, calls } = makeDeps({
    notion: (pathname) => {
      if (pathname.includes('DS_SPACE')) return spacesPage;
      if (pathname.includes('DS_WI')) return wiPage;
      return {};
    },
  });
  clearContextCache('engineering');
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: JSON.stringify({ space: '301房', work_item: '木作', message_type: '問題反映', ticket_suggested: true, confidence: '高', reason: '牆面問題' }) }] }),
  });
  const j = await classify(deps, { text: '301房木作歪了', senderName: '阿明', binding: { role: '工班', trade: '木作', projectPageId: 'proj1' } });
  assert.deepEqual(j.space, { id: 'sp1', name: '301房' });
  assert.deepEqual(j.work_item, { id: 'wi1', name: '木作' });
  assert.equal(j.message_type, '問題反映');
  assert.equal(j.ticket_suggested, true);
  assert.equal(j.confidence, '高');
  assert.equal(j.model, 'claude-x');
  // 關鍵:classify 只查詢(空間/工項),不對訊息頁做 PATCH — 寫回歸 triage 通用管線
  assert.ok(!calls.some((c) => c.method === 'PATCH'), 'classify 不應寫 Notion 頁');
});

// 4) 非法 message_type/confidence → 退回一般對話/低;未匹配名稱 → null
await check('classify 正規化非法值 + 名稱未匹配為 null', async () => {
  const { deps } = makeDeps({
    notion: (pathname) => {
      if (pathname.includes('DS_SPACE')) return { results: [] };
      if (pathname.includes('DS_WI')) return { results: [] };
      return {};
    },
  });
  clearContextCache('engineering');
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: JSON.stringify({ space: '不存在', work_item: '不存在', message_type: '亂填', confidence: '亂填', ticket_suggested: false, reason: 'x' }) }] }),
  });
  const j = await classify(deps, { text: 'hi', senderName: 'a', binding: { role: '工班', projectPageId: 'p' } });
  assert.equal(j.space, null);
  assert.equal(j.work_item, null);
  assert.equal(j.message_type, '一般對話');
  assert.equal(j.confidence, '低');
});

// 5) 守門:無 AI / 無脈絡 / 無專案 / 空白 → 回 null(交棒通用管線)
await check('classify 守門回 null', async () => {
  const noAi = makeDeps({ deps: { ai: { provider: 'anthropic', judgeModel: 'm' } } }); // 無 key
  assert.equal(await classify(noAi.deps, { text: 'x', senderName: 'a', binding: { projectPageId: 'p' } }), null);
  const noCtx = makeDeps({ deps: { dataSources: { feedbackTickets: 'DS_FB' } } }); // 無空間/工項
  assert.equal(await classify(noCtx.deps, { text: 'x', senderName: 'a', binding: { projectPageId: 'p' } }), null);
  const { deps } = makeDeps();
  assert.equal(await classify(deps, { text: '   ', senderName: 'a', binding: { projectPageId: 'p' } }), null); // 空白
  assert.equal(await classify(deps, { text: 'x', senderName: 'a', binding: {} }), null); // 無專案
});

// ════════════════ reminders.js ════════════════

// 純函式
await check('dayAfter / overdueDaysBetween', () => {
  assert.equal(R.dayAfter('2026-07-09'), '2026-07-10');
  assert.equal(R.overdueDaysBetween('2026-07-09', '2026-07-06'), 3);
});

// 綁定頁的假回應(供回饋單提醒查「負責群組」)
const bindingPage = {
  properties: {
    'LINE 群組 ID': { rich_text: [{ plain_text: 'gGROUP' }] },
    '群組名稱': { title: [{ plain_text: '木作工班群' }] },
    '對方主管': { rich_text: [{ plain_text: '阿明' }] },
    '我方主管': { rich_text: [] },
    '成員對照': { rich_text: [{ plain_text: JSON.stringify({ 阿明: 'U_MING' }) }] },
  },
};

// 6) runDueReminders:今日到期 → 推播負責群組 + 更新最後提醒日 + 附歷程,無升級
await check('runDueReminders 今日到期→推播+更新', async () => {
  const ticket = { id: 'fb1', properties: {
    '回覆期限': { date: { start: '2026-07-09' } },
    '最後提醒日': { date: { start: '2026-07-01' } },
    '編號': { title: [{ plain_text: 'FB-001' }] },
    '問題描述': { rich_text: [{ plain_text: '牆面裂縫' }] },
    '影響等級': { select: { name: 'B' } },
    '負責群組': { relation: [{ id: 'bind1' }] },
    '專案': { relation: [{ id: 'proj1' }] },
  } };
  const { deps, calls } = makeDeps({
    notion: (pathname, opts) => {
      if (pathname.includes('DS_FB') && /\/query$/.test(pathname)) return { results: [ticket] };
      if (pathname.includes('/v1/pages/bind1')) return bindingPage;
      return {};
    },
  });
  const out = await runDueReminders(deps, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.ok, true);
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].kind, '到期');
  assert.equal(out.sent[0].escalated, false);
  const push = calls.find((c) => c.kind === 'push');
  assert.equal(push.to, 'gGROUP');
  assert.match(push.text, /回饋單今日到期.*FB-001/s);
  assert.deepEqual(push.mention, { name: '阿明', userId: 'U_MING' }); // 真 @mention
  // 更新最後提醒日 + 逾期 checkbox=false
  const patch = calls.find((c) => c.method === 'PATCH' && c.body?.properties?.['最後提醒日']);
  assert.equal(patch.body.properties['最後提醒日'].date.start, '2026-07-09');
  assert.equal(patch.body.properties['逾期'].checkbox, false);
});

// 7) runDueReminders:逾期滿 N 天 → 升級內部群
await check('runDueReminders 逾期升級內部群', async () => {
  const ticket = { id: 'fb2', properties: {
    '回覆期限': { date: { start: '2026-07-05' } }, // 逾期 4 天
    '最後提醒日': { date: {} },
    '編號': { title: [{ plain_text: 'FB-002' }] },
    '問題描述': { rich_text: [{ plain_text: '漏水' }] },
    '負責群組': { relation: [{ id: 'bind1' }] },
    '專案': { relation: [{ id: 'proj1' }] },
  } };
  const internal = { results: [{ properties: { 'LINE 群組 ID': { rich_text: [{ plain_text: 'gINTERNAL' }] } } }] };
  const { deps, calls } = makeDeps({
    notion: (pathname) => {
      if (pathname.includes('DS_FB') && /\/query$/.test(pathname)) return { results: [ticket] };
      if (pathname.includes('/v1/pages/bind1')) return bindingPage;
      if (pathname.includes('DS_GB') && /\/query$/.test(pathname)) return internal;
      return {};
    },
  });
  const out = await runDueReminders(deps, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.sent[0].kind, '逾期');
  assert.equal(out.sent[0].overdueDays, 4);
  assert.equal(out.sent[0].escalated, true);
  const pushes = calls.filter((c) => c.kind === 'push');
  assert.ok(pushes.some((p) => p.to === 'gGROUP'), '應推負責群組');
  assert.ok(pushes.some((p) => p.to === 'gINTERNAL' && /升級通知/.test(p.text)), '應升級內部群');
});

// 8) wakeParkedTickets:重提日期已到 → 復活轉開立 + 通知負責群組
await check('wakeParkedTickets 重提日到→復活', async () => {
  const parked = { id: 'fb3', properties: {
    '狀態': { select: { name: '擱置(待時機)' } },
    '編號': { title: [{ plain_text: 'FB-003' }] },
    '問題描述': { rich_text: [{ plain_text: '待泥作完成' }] },
    '重提日期': { date: { start: '2026-07-08' } },
    '負責群組': { relation: [{ id: 'bind1' }] },
    '專案': { relation: [{ id: 'proj1' }] },
  } };
  const { deps, calls } = makeDeps({
    notion: (pathname) => {
      if (pathname.includes('DS_FB') && /\/query$/.test(pathname)) return { results: [parked] };
      if (pathname.includes('/v1/pages/bind1')) return bindingPage;
      return {};
    },
  });
  const woken = await wakeParkedTickets(deps, '2026-07-09');
  assert.equal(woken.length, 1);
  assert.match(woken[0].reason, /重提日期/);
  const patch = calls.find((c) => c.method === 'PATCH' && c.body?.properties?.['狀態']);
  assert.equal(patch.body.properties['狀態'].select.name, '開立');
  assert.ok(calls.some((c) => c.kind === 'push' && /擱置單復活/.test(c.text)));
});

// 9) wakeParkedTickets:觸發工項已進行中 → 復活
await check('wakeParkedTickets 觸發工項開工→復活', async () => {
  const parked = { id: 'fb4', properties: {
    '狀態': { select: { name: '擱置(待時機)' } },
    '編號': { title: [{ plain_text: 'FB-004' }] },
    '問題描述': { rich_text: [{ plain_text: 'x' }] },
    '重提日期': { date: {} },
    '觸發工項': { relation: [{ id: 'wiTrigger' }] },
    '專案': { relation: [{ id: 'proj1' }] },
  } };
  const { deps } = makeDeps({
    notion: (pathname) => {
      if (pathname.includes('DS_FB') && /\/query$/.test(pathname)) return { results: [parked] };
      if (pathname.includes('/v1/pages/wiTrigger')) return { properties: { '狀態': { select: { name: '進行中' } }, '工項': { title: [{ plain_text: '泥作' }] } } };
      return {};
    },
  });
  const woken = await wakeParkedTickets(deps, '2026-07-09');
  assert.equal(woken.length, 1);
  assert.match(woken[0].reason, /泥作.*進行中/);
});

// 10) reminderPasses 契約形狀:daily pass 呼叫 runDueReminders
await check('reminderPasses 契約(daily → runDueReminders)', async () => {
  assert.equal(reminderPasses.length, 1);
  assert.equal(reminderPasses[0].name, 'feedbackDue');
  assert.equal(reminderPasses[0].cadence, 'daily');
  const { deps } = makeDeps({ notion: (pathname) => (/\/query$/.test(pathname) ? { results: [] } : {}) });
  const out = await reminderPasses[0].run(deps, { cfg: { escalationDays: 2 }, today: '2026-07-09' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.sent, []);
});

// 11) 無 feedbackTickets 的租戶(如森在)→ 直接略過
await check('runDueReminders 無回饋單庫→skipped', async () => {
  const { deps } = makeDeps({ deps: { dataSources: { spaces: 'x', workItems: 'y' } } });
  const out = await runDueReminders(deps, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.skipped, true);
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

// AM Platform — reminders 乾跑驗證(不需真憑證、不打真 API)
// 證明 reminders 已把工程到期/擱置規則交棒 construction.reminderPasses:
//   runReminderPasses 組出「租戶鎖定」deps、只跑 daily pass、錯誤隔離;非工程租戶由 pass 自身略過。
// 另驗 construction.init 把 reminderPasses 註冊到 platform.reminderPasses(累加)。
//
// 執行:node tools/dryrun-reminders.mjs
import assert from 'node:assert';
import reminders, { __test as R } from '../modules/reminders/index.js';
import construction from '../modules/construction/index.js';

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (e) => results.push([false, `${name} — ${e.message}`]),
  );
}

const engTenant = { key: 'engineering', envPrefix: 'ENG', modules: ['reminders', 'construction'], dataSources: { feedbackTickets: 'DS_FB', groupBindings: 'DS_GB' } };

// ── runReminderPasses:組 deps + 只跑 daily + 聚合 ──
await check('runReminderPasses 組租戶鎖定 deps、只跑 daily pass', async () => {
  const seen = [];
  const platform = {
    notionRequest: async (p, o = {}) => { seen.push({ p, tenantKey: o.tenantKey }); return {}; },
    pushLineMessage: async () => {},
    reminderPasses: [
      { name: 'feedbackDue', cadence: 'daily', run: async (deps, { cfg, today }) => {
        // deps 應帶 tenantKey + 鎖租戶 notionRequest;cfg/today 由 reminders 傳入
        assert.equal(deps.tenantKey, 'engineering');
        assert.equal(cfg.escalationDays, 2);
        assert.equal(today, '2026-07-09');
        await deps.notionRequest('/v1/data_sources/DS_FB/query', { method: 'POST' });
        return { ok: true, today, sent: [{ number: 'FB-001' }, { number: 'FB-002' }], woken: [] };
      } },
      { name: 'weeklyThing', cadence: 'weekly', run: async () => { throw new Error('不該被呼叫'); } },
    ],
  };
  reminders.init(platform);
  const out = await R.runReminderPasses(engTenant, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.length, 1, '只應跑 1 個 daily pass(weekly 略過)');
  assert.equal(out[0].name, 'feedbackDue');
  assert.equal(out[0].result.sent.length, 2);
  assert.equal(seen[0].tenantKey, 'engineering', 'notionRequest 應鎖租戶 key');
});

await check('runReminderPasses 錯誤隔離(pass 丟例外不炸整輪)', async () => {
  const platform = {
    notionRequest: async () => ({}),
    pushLineMessage: async () => {},
    reminderPasses: [
      { name: 'boom', cadence: 'daily', run: async () => { throw new Error('kaboom'); } },
      { name: 'ok', cadence: 'daily', run: async () => ({ ok: true, sent: [{ number: 'X' }] }) },
    ],
  };
  reminders.init(platform);
  const out = await R.runReminderPasses(engTenant, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.length, 2);
  assert.ok(out.find((o) => o.name === 'boom').result.error, 'boom 應記錄 error');
  assert.equal(out.find((o) => o.name === 'ok').result.sent.length, 1);
});

await check('無 platform.reminderPasses(未載 construction)→ 空陣列', async () => {
  reminders.init({ notionRequest: async () => ({}), pushLineMessage: async () => {} });
  const out = await R.runReminderPasses(engTenant, { escalationDays: 2 }, '2026-07-09');
  assert.deepEqual(out, []);
});

// ── construction.init 註冊 platform.reminderPasses(累加)──
await check('construction.init 累加 reminderPasses 到 platform', async () => {
  const platform = { logger: console, reminderPasses: [{ name: 'preexisting', cadence: 'daily', run: async () => ({}) }] };
  construction.init(platform);
  assert.ok(Array.isArray(platform.reminderPasses));
  const names = platform.reminderPasses.map((p) => p.name);
  assert.ok(names.includes('preexisting'), '既有 pass 應保留(累加,不覆蓋)');
  assert.ok(names.includes('feedbackDue'), 'construction 應註冊 feedbackDue');
  // pass 形狀符合 reminders 契約
  const fb = platform.reminderPasses.find((p) => p.name === 'feedbackDue');
  assert.equal(fb.cadence, 'daily');
  assert.equal(typeof fb.run, 'function');
});

// ── 端到端:construction 註冊 → reminders 迭代(pass 對森在自身略過)──
await check('端到端:森在租戶(無回饋單庫)pass 回 skipped', async () => {
  const platform = { logger: console, notionRequest: async () => ({}), pushLineMessage: async () => {} };
  construction.init(platform);   // 掛 platform.reminderPasses
  reminders.init(platform);
  const forest = { key: 'forest', envPrefix: 'FOREST', modules: ['reminders'], dataSources: {} };
  const out = await R.runReminderPasses(forest, { escalationDays: 2 }, '2026-07-09');
  assert.equal(out.length, 1);
  assert.equal(out[0].result.skipped, true, '無 feedbackTickets/groupBindings → pass 自身回 skipped');
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

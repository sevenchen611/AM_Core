// AM Platform — queue↔construction 掛鉤乾跑驗證(不需真憑證、不打真 API)
// 證明 construction.init 把 queue 依賴的能力掛到 platform,且簽章/容錯對齊:
//   platform.createFeedbackTicket({ tenant, ...body }) — 開單(委派 construction.createTicket)
//   platform.listTrades({ tenant })                    — 工種清單;非工程租戶容錯回 []
// 並複驗 queue 端 create-ticket 的 501 守門(租戶未啟用 construction → 501,不觸發 500)。
//
// 執行:node tools/dryrun-queue-hooks.mjs
import assert from 'node:assert';
import construction from '../modules/construction/index.js';
import { BASE_TRADES, clearTradeCache } from '../modules/construction/trades.js';

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (e) => results.push([false, `${name} — ${e.message}`]),
  );
}

const eng = { key: 'engineering', modules: ['queue', 'construction'], dataSources: { feedbackTickets: 'DS_FB', budgets: 'DS_BUD', workItems: 'DS_WI', groupBindings: 'DS_GB' } };
const forest = { key: 'forest', modules: ['queue'], dataSources: {} };

function makePlatform(notion = async () => ({})) {
  return {
    logger: console,
    notionRequest: async (p, o = {}) => notion(p, o),
    pushLineMessage: async () => {},
  };
}

// ── 註冊 ──
await check('construction.init 掛 createFeedbackTicket + listTrades', () => {
  const platform = makePlatform();
  construction.init(platform);
  assert.equal(typeof platform.createFeedbackTicket, 'function');
  assert.equal(typeof platform.listTrades, 'function');
});

// ── listTrades 容錯 ──
await check('listTrades:非工程租戶(森在)→ []', async () => {
  const platform = makePlatform();
  construction.init(platform);
  assert.deepEqual(await platform.listTrades({ tenant: forest }), []);
  assert.deepEqual(await platform.listTrades({}), []);
});

await check('listTrades:工程租戶 → BASE_TRADES(schema 無自訂工種)', async () => {
  clearTradeCache('engineering');
  // schema 查詢回無「工種」select → 只有內建工種 + 其他
  const platform = makePlatform(async (p) => (/\/data_sources\/DS_/.test(p) ? { properties: {} } : {}));
  construction.init(platform);
  const trades = await platform.listTrades({ tenant: eng });
  for (const t of BASE_TRADES) assert.ok(trades.includes(t), `應含內建工種 ${t}`);
  assert.equal(trades[trades.length - 1], '其他');
});

await check('listTrades:工程租戶 → 併入 schema 既有工種(去重)', async () => {
  clearTradeCache('engineering');
  const platform = makePlatform(async (p) => {
    if (/\/data_sources\/DS_BUD$/.test(p)) return { properties: { '工種': { select: { options: [{ name: '空調' }, { name: '木作' }] } } } };
    if (/\/data_sources\/DS_/.test(p)) return { properties: {} };
    return {};
  });
  construction.init(platform);
  const trades = await platform.listTrades({ tenant: eng });
  assert.ok(trades.includes('空調'), '應併入 schema 的新工種 空調');
  assert.equal(trades.filter((t) => t === '木作').length, 1, '既有工種不重複');
});

// ── createFeedbackTicket 路由到 construction.createTicket(deps 已組) ──
await check('createFeedbackTicket:缺 pageId/operator → 由 createTicket 擋(證明已組 deps 進入領域邏輯)', async () => {
  const platform = makePlatform();
  construction.init(platform);
  await assert.rejects(
    () => platform.createFeedbackTicket({ tenant: eng /* 無 pageId/operator */ }),
    /pageId\/operator required/,
    '應進入 createTicket 並拋出參數檢查錯誤',
  );
});

await check('createFeedbackTicket:非工程租戶 → svcDeps 租戶閘門擋下', async () => {
  const platform = makePlatform();
  construction.init(platform);
  // svcDeps 的 assertTenant 為同步拋錯(在任何 await 之前),故以 try/catch 捕捉。
  let err = null;
  try { await platform.createFeedbackTicket({ tenant: forest, pageId: 'p', operator: 'x' }); }
  catch (e) { err = e; }
  assert.ok(err && /未啟用工程模組/.test(err.message), '應被租戶閘門擋下');
});

// ── queue 端 create-ticket 守門(複製 queue/index.js 的判斷式,防回歸)──
function queueCreateTicketGate(platform, tenant) {
  // 對應 queue/index.js:未載入該模組、或此租戶未啟用工程 → 501
  if (typeof platform.createFeedbackTicket !== 'function' || !(tenant.modules || []).includes('construction')) {
    return { status: 501 };
  }
  return { status: 200 };
}

await check('queue 守門:construction 未載入 → 501', () => {
  const platform = makePlatform(); // 未 init,無掛鉤
  assert.equal(queueCreateTicketGate(platform, eng).status, 501);
});

await check('queue 守門:森在(未啟用 construction)→ 501,非 500', () => {
  const platform = makePlatform();
  construction.init(platform); // 掛鉤已在,但租戶未啟用工程
  assert.equal(queueCreateTicketGate(platform, forest).status, 501);
});

await check('queue 守門:工程租戶 → 200(放行委派)', () => {
  const platform = makePlatform();
  construction.init(platform);
  assert.equal(queueCreateTicketGate(platform, eng).status, 200);
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

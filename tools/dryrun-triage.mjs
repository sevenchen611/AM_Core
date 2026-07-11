// AM Platform — triage 乾跑驗證(不需真憑證、不打真 API)
// 證明 triage 已成「通用初判管線」:過濾層1(系統轉貼)、委派 construction.classify、
//   過濾層2(高信心閒聊自動歸檔)、寫回訊息頁、未分類交棒 queue、無分類器租戶只跑層1。
// 另驗 construction.init 把 platform.classify 掛鉤上(對非工程租戶容錯回 null)。
//
// 執行:node tools/dryrun-triage.mjs
import assert from 'node:assert';
import triage, { __test as T } from '../modules/triage/index.js';
import construction from '../modules/construction/index.js';

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (e) => results.push([false, `${name} — ${e.message}`]),
  );
}

// 假 platform:記錄 notion 寫入 + 可注入 classify。
function makePlatform(over = {}) {
  const calls = [];
  const platform = {
    logger: { warn: (m) => calls.push({ kind: 'warn', m }) },
    notionRequest: async (pathname, opts = {}) => {
      calls.push({ kind: 'notion', pathname, method: opts.method, body: opts.body, tenantKey: opts.tenantKey });
      return {};
    },
    ...over,
  };
  return { platform, calls };
}

const engTenant = { key: 'engineering', modules: ['collect', 'triage', 'construction'] };
const baseCtx = (over = {}) => ({
  tenant: engTenant,
  binding: { role: '工班', trade: '木作', projectPageId: 'proj1' },
  isMaster: false,
  senderName: '阿明',
  text: '301房木作歪了',
  messagePageId: 'msg1',
  ...over,
});

// ════════════════ 過濾層 1 ════════════════

await check('SYSTEM_ECHO_RE 命中系統轉貼/測試', () => {
  assert.equal(T.looksLikeSystemEcho('⏰ 回饋單今日到期|FB-001'), true);
  assert.equal(T.looksLikeSystemEcho('會議記錄 已產生'), true);
  assert.equal(T.looksLikeSystemEcho('測試'), true);
  assert.equal(T.looksLikeSystemEcho('301房木作歪了'), false);
});

await check('層1:系統轉貼 → 歸檔一般對話 + 短路(不呼叫 classify)', async () => {
  let classifyCalled = false;
  const { platform, calls } = makePlatform({ classify: async () => { classifyCalled = true; return null; } });
  triage.init(platform);
  const handled = await triage.onMessage(baseCtx({ text: '⏰ 回饋單今日到期|FB-001' }));
  assert.equal(handled, true, '系統轉貼應短路回 true');
  assert.equal(classifyCalled, false, '層1 不應呼叫 classify');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.body.properties['掛載狀態'].select.name, '一般對話');
  assert.equal(patch.tenantKey, 'engineering', 'notionRequest 應帶租戶隔離 key');
});

// ════════════════ 委派 construction.classify ════════════════

await check('委派 classify:高信心閒聊 → 層2 自動歸檔', async () => {
  const judgement = { space: null, work_item: null, message_type: '一般對話', ticket_suggested: false, confidence: '高', reason: '閒聊', model: 'm', judged_at: 'x' };
  let seenInput = null;
  const { platform, calls } = makePlatform({ classify: async (input) => { seenInput = input; return judgement; } });
  triage.init(platform);
  const handled = await triage.onMessage(baseCtx({ text: '今天天氣真好' }));
  assert.equal(handled, true);
  // triage 只傳通用欄位給 classify,不自讀空間/工項
  assert.deepEqual(Object.keys(seenInput).sort(), ['binding', 'senderName', 'tenant', 'text']);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.body.properties['掛載狀態'].select.name, '一般對話', '層2 高信心閒聊→歸檔');
  assert.match(patch.body.properties['確認者'].rich_text[0].text.content, /高信心自動歸檔/);
});

await check('委派 classify:問題反映 → 交 queue(掛載狀態=AI初判待確認)', async () => {
  const judgement = { space: { id: 's', name: '301房' }, work_item: { id: 'w', name: '木作' }, message_type: '問題反映', ticket_suggested: true, confidence: '高', reason: 'x', model: 'm', judged_at: 'x' };
  const { platform, calls } = makePlatform({ classify: async () => judgement });
  triage.init(platform);
  const handled = await triage.onMessage(baseCtx());
  assert.equal(handled, true);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.body.properties['掛載狀態'].select.name, 'AI初判待確認');
  assert.equal(patch.body.properties['確認者'], undefined, '非自動歸檔不應寫確認者');
});

await check('classify 回 null(無分類器脈絡)→ 不短路,交棒 queue', async () => {
  const { platform, calls } = makePlatform({ classify: async () => null });
  triage.init(platform);
  const handled = await triage.onMessage(baseCtx());
  assert.equal(handled, false, 'null judgement 應回 false 讓 queue 接手');
  assert.ok(!calls.some((c) => c.method === 'PATCH'), '未分類不應寫訊息頁');
});

await check('無 platform.classify(非工程租戶)→ 只跑層1,其餘交棒', async () => {
  const { platform, calls } = makePlatform(); // 無 classify
  triage.init(platform);
  // 一般訊息:無分類器 → false
  assert.equal(await triage.onMessage(baseCtx()), false);
  // 系統轉貼:層1 仍運作
  assert.equal(await triage.onMessage(baseCtx({ text: '測試' })), true);
  assert.ok(calls.some((c) => c.method === 'PATCH'), '層1 歸檔仍會寫頁');
});

await check('classify 丟例外 → 吞掉回 false(不影響收訊)', async () => {
  const { platform, calls } = makePlatform({ classify: async () => { throw new Error('boom'); } });
  triage.init(platform);
  const handled = await triage.onMessage(baseCtx());
  assert.equal(handled, false);
  assert.ok(calls.some((c) => c.kind === 'warn' && /classify failed/.test(c.m)));
});

// ════════════════ 守門(通用前置條件)════════════════

await check('守門:總管群/無專案/空白/無 messagePageId → false', async () => {
  const { platform } = makePlatform({ classify: async () => ({ message_type: '問題反映', confidence: '高' }) });
  triage.init(platform);
  assert.equal(await triage.onMessage(baseCtx({ isMaster: true })), false);
  assert.equal(await triage.onMessage(baseCtx({ binding: { role: '工班' } })), false); // 無 projectPageId
  assert.equal(await triage.onMessage(baseCtx({ text: '   ' })), false);
  assert.equal(await triage.onMessage(baseCtx({ messagePageId: undefined })), false);
});

// ════════════════ construction register 掛鉤 ════════════════

await check('construction.init 掛 platform.classify;非工程租戶回 null', async () => {
  const platform = { logger: console };
  construction.init(platform);
  assert.equal(typeof platform.classify, 'function', 'init 應掛上 platform.classify');
  // 非工程租戶(modules 不含 construction)→ 容錯回 null,不丟例外
  assert.equal(await platform.classify({ tenant: { key: 'forest', modules: ['collect'] } }), null);
  assert.equal(await platform.classify({}), null);
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

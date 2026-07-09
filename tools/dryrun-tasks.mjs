// AM Platform — tasks 模組乾跑驗證(不需真憑證、不打真 API、不碰 BuildAM)
// 用假 platform 驅動 tasks 模組,證明:
//   1. createTask 產出的 Notion 頁屬性 = 原 meetings 內建待辦那段(行為等同)。
//   2. 期限可帶時刻(=行程,台灣時區);純日期為整日。
//   3. 狀態機:待辦/進行中/完成/取消,非法值退回「待辦」。
//   4. expandTasks 展開多筆、單筆失敗不中斷。
//   5. 服務掛上 platform.tasks(供 meetings/construction 呼叫)。
//   6. 模組狀態以 (租戶, 群組) 為鍵,跨租戶/跨群不污染。
//
// 執行:node tools/dryrun-tasks.mjs
import assert from 'node:assert';
import tasks, { __test } from '../modules/tasks/index.js';

const ENG_TASKS = 'e0000000000000000000000000000004';
const SEN_TASKS = 's0000000000000000000000000000004';

// 假 platform:notionRequest 只記錄呼叫,不打真 API。
const calls = [];
let pageSeq = 0;
const platform = {
  logger: { ...console, warn: () => {}, log: () => {} },
  notionRequest: async (pathname, opts = {}) => {
    calls.push({ pathname, ...opts });
    if (opts.method === 'POST' && pathname === '/v1/pages') return { id: `page_${++pageSeq}` };
    if (/\/query$/.test(pathname)) return { results: [] };
    return {};
  },
};
tasks.init(platform);

const engTenant = { key: 'engineering', displayName: '工程', dataSources: { tasks: ENG_TASKS } };
const senTenant = { key: 'forest', displayName: '森在', dataSources: { tasks: SEN_TASKS } };

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (e) => results.push([false, `${name} — ${e.message}`]),
  );
}
const lastBody = () => calls[calls.length - 1].body;

// 1) createTask 屬性等同 meetings 內建待辦(含專案/會議記錄 relation、來源/狀態 select)
await check('createTask 屬性等同 meetings 待辦', async () => {
  calls.length = 0;
  const id = await tasks.createTask(
    { tenant: engTenant, groupId: 'gENG' },
    { content: '訂鋁窗', owner: '其勳', due: '2026-07-15', source: '會議', projectPageId: 'proj_1', meetingId: 'mtg_1' },
  );
  assert.equal(id, 'page_1');
  const b = lastBody();
  assert.equal(b.parent.data_source_id, ENG_TASKS);
  const p = b.properties;
  assert.equal(p['內容'].title[0].text.content, '訂鋁窗');
  assert.equal(p['負責人'].rich_text[0].text.content, '其勳');
  assert.deepEqual(p['期限'].date, { start: '2026-07-15' });
  assert.equal(p['來源'].select.name, '會議');
  assert.equal(p['狀態'].select.name, '待辦');
  assert.deepEqual(p['專案'].relation, [{ id: 'proj_1' }]);
  assert.deepEqual(p['會議記錄'].relation, [{ id: 'mtg_1' }]);
  // 嚴格綁定:服務直呼時補上 tenantKey,守衛據此擋跨租戶
  assert.equal(calls[calls.length - 1].tenantKey, 'engineering');
});

// 2) 沒給的欄位不送(避免碰租戶未定義的屬性)
await check('未給的欄位不送出', async () => {
  calls.length = 0;
  await tasks.createTask({ tenant: engTenant }, { content: '手動待辦' });
  const p = lastBody().properties;
  assert.ok(!('負責人' in p) && !('期限' in p) && !('專案' in p) && !('會議記錄' in p) && !('回饋單' in p));
  assert.equal(p['來源'].select.name, '手動'); // 預設來源
  assert.equal(p['狀態'].select.name, '待辦');
});

// 3) 期限帶時刻 = 行程(台灣時區);純日期 = 整日
await check('期限帶時刻→行程,純日期→整日', () => {
  assert.deepEqual(__test.toNotionDate('2026-07-15'), { start: '2026-07-15' });
  assert.deepEqual(__test.toNotionDate('2026-07-15 14:30'), { start: '2026-07-15T14:30:00+08:00' });
  assert.deepEqual(__test.toNotionDate('2026-07-15T09:05:00'), { start: '2026-07-15T09:05:00+08:00' });
  assert.equal(__test.toNotionDate(''), null);
});

// 4) 狀態機:合法值寫入,非法值退回「待辦」
await check('狀態機 setStatus', async () => {
  calls.length = 0;
  const name = await tasks.setStatus({ tenant: engTenant }, 'page_x', '完成');
  assert.equal(name, '完成');
  const b = lastBody();
  assert.equal(b.properties['狀態'].select.name, '完成');
  assert.match(calls[calls.length - 1].pathname, /^\/v1\/pages\/page_x$/);
  assert.equal(b.properties['狀態'].select.name, '完成');
  assert.equal(await tasks.setStatus({ tenant: engTenant }, 'page_x', '亂填'), '待辦');
});

// 5) expandTasks:展開多筆,單筆失敗不中斷
await check('expandTasks 展開多筆且容錯', async () => {
  calls.length = 0;
  pageSeq = 0;
  // 讓「內容為 BOOM」的那筆建立失敗
  const orig = platform.notionRequest;
  platform.notionRequest = async (pathname, opts = {}) => {
    if (opts.method === 'POST' && pathname === '/v1/pages' && opts.body?.properties?.['內容']?.title?.[0]?.text?.content === 'BOOM') {
      throw new Error('boom');
    }
    return orig(pathname, opts);
  };
  const ids = await tasks.expandTasks(
    { tenant: engTenant, groupId: 'gENG' },
    [{ content: 'A' }, { content: 'BOOM' }, { content: 'C', due: '2026-08-01 10:00' }],
    { source: '回饋單', projectPageId: 'proj_9', feedbackId: 'fb_9' },
  );
  platform.notionRequest = orig;
  assert.equal(ids.length, 2, `expected 2 created, got ${ids.length}`);
  // 最後一筆(C)帶行程期限 + 回饋單關聯 + 來源=回饋單
  const p = calls[calls.length - 1].body.properties;
  assert.equal(p['來源'].select.name, '回饋單');
  assert.deepEqual(p['回饋單'].relation, [{ id: 'fb_9' }]);
  assert.deepEqual(p['期限'].date, { start: '2026-08-01T10:00:00+08:00' });
});

// 6) 服務掛上 platform.tasks(meetings/construction 呼叫入口)
await check('服務掛上 platform.tasks', () => {
  for (const fn of ['createTask', 'expandTasks', 'setStatus', 'listOpen', 'markReminded']) {
    assert.equal(typeof platform.tasks[fn], 'function', `platform.tasks.${fn} 缺失`);
  }
});

// 7) 模組狀態以 (租戶, 群組) 為鍵:不同租戶/群互不污染
await check('lastTask 以(租戶,群組)為鍵', async () => {
  await tasks.createTask({ tenant: engTenant, groupId: 'gENG' }, { content: '工程A' });
  await tasks.createTask({ tenant: senTenant, groupId: 'gSEN' }, { content: '森在A' });
  assert.equal(tasks.lastTask(engTenant, 'gENG').content, '工程A');
  assert.equal(tasks.lastTask(senTenant, 'gSEN').content, '森在A');
  assert.equal(tasks.lastTask(engTenant, 'gSEN'), null); // 同租戶不同群 → 無
  assert.equal(tasks.lastTask(senTenant, 'gENG'), null); // 跨租戶不共享
});

// 8) listOpen 用租戶 tasks 庫、狀態=待辦/進行中且有期限
await check('listOpen 過濾未完成+有期限', async () => {
  calls.length = 0;
  await tasks.listOpen({ tenant: engTenant });
  const c = calls[calls.length - 1];
  assert.match(c.pathname, new RegExp(`/v1/data_sources/${ENG_TASKS}/query`));
  const and = c.body.filter.and;
  assert.ok(and[0].or.some((o) => o.property === '狀態' && o.select.equals === '待辦'));
  assert.ok(and[0].or.some((o) => o.property === '狀態' && o.select.equals === '進行中'));
  assert.deepEqual(and[1], { property: '期限', date: { is_not_empty: true } });
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

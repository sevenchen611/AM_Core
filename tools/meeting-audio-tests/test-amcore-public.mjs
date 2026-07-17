// 啟動真正的 AM_Core 平台(forest 租戶 + meetings 模組,mock 掉 Notion/LINE),
// 驗證:公開頁連結產得出、/m/ 路由被 collectRoutes 收到、簽章驗證正確。
import assert from 'node:assert';
import crypto from 'node:crypto';
import { bootstrap } from 'file:///D:/Codex_project/AM_Core/core/bootstrap.js';

const MEETING_ID = '39951c686dac817eb089c635e16b0ebb';   // 真實那份茲心園週會
const NONMEET_ID = 'ffffffffffffffffffffffffffffffff';   // 非會議頁(該被擋)
const SECRET = 'testsecret-amcore-123';
const BASE = 'https://plat.example.com';

globalThis.fetch = async (input, options = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const p = u.pathname; const method = (options.method || 'GET').toUpperCase();
  const J = (o, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(o), json: async () => o, headers: { get: () => 'application/json' } });
  if (u.host === 'api.notion.com' && method === 'GET') {
    let m = p.match(/^\/v1\/pages\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]).replace(/-/g, '');
      if (id === MEETING_ID) return J({ id, url: 'https://notion.so/x', properties: { '會議': { title: [{ plain_text: '茲心園主管週會' }] }, '日期': { date: { start: '2026-07-11' } }, '參與者': { rich_text: [{ plain_text: 'Seven、逸凡' }] }, '類型': { select: { name: '一般會議' } } } });
      return J({ id, url: 'https://notion.so/y', properties: {} }); // 非會議頁:無「會議」標題
    }
    m = p.match(/^\/v1\/blocks\/([^/]+)\/children$/);
    if (m) return J({ results: [], has_more: false });
    // 隔離守衛 metadata
    if (/^\/v1\/data_sources\//.test(p)) return J({ parent: { database_id: 'db1' }, archived: false, in_trash: false });
    if (/^\/v1\/databases\//.test(p)) return J({ parent: { page_id: 'pg1' }, archived: false, in_trash: false });
  }
  return J({ error: `unmocked ${method} ${p}` }, false, 500);
};

const tenants = [{
  key: 'forest', displayName: '森在', envPrefix: 'FOREST', modules: ['meetings'],
  parentPageId: 'bbbb2222bbbb2222bbbb2222bbbb2222',
  dataSources: { messages: 's0000000000000000000000000000001', groupBindings: 's0000000000000000000000000000002', meetings: 's0000000000000000000000000000003', tasks: 's0000000000000000000000000000004' },
  driveRootFolderId: '', driveConfigured: false, line: null, notionConfigured: true,
  config: { meetings: { types: ['一般會議'], defaultType: '一般會議' } },
}];

const env = { NOTION_TOKEN: 'test', LINE_CHANNEL_ACCESS_TOKEN: 'test', LINE_CHANNEL_SECRET: 'test', AMCORE_PUBLIC_BASE_URL: BASE + '/', AMCORE_QUEUE_ACCESS_KEY: SECRET };

const { platform, dispatcher, modules } = await bootstrap(env, { tenants, logger: { ...console, log: () => {} } });
const mod = modules.get('meetings');
const routes = dispatcher.collectRoutes();

const results = [];
const check = (name, fn) => Promise.resolve().then(fn).then(() => results.push([true, name]), (e) => results.push([false, `${name} — ${e.message}`]));

// fake req/res
function fakeRes() { const r = { status: 0, headers: {}, body: '' }; r.writeHead = (s, h) => { r.status = s; r.headers = h || {}; }; r.end = (b) => { r.body = b || ''; }; return r; }
async function hitRoute(pathname) {
  const entry = routes.find(({ route }) => route.prefix === '/m' && (pathname === route.prefix || pathname.startsWith(route.prefix + '/')));
  if (!entry) throw new Error('/m route 沒被 collectRoutes 收到');
  const res = fakeRes();
  await entry.route.handler({ method: 'GET' }, res, { pathname });
  return res;
}

await check('platform 有 publicBaseUrl(去尾斜線)', () => assert.equal(platform.publicBaseUrl, BASE));
await check('platform.publicLinkSecret = queueAccessKey', () => assert.equal(platform.publicLinkSecret, SECRET));
await check('meetings 模組匯出 routes(/m)', () => assert.ok((mod.routes || []).some((r) => r.prefix === '/m')));
await check('collectRoutes 為 forest 收到 /m 路由', () => assert.ok(routes.some(({ tenantKey, route }) => tenantKey === 'forest' && route.prefix === '/m')));

const sig = crypto.createHmac('sha256', SECRET).update(`meeting:${MEETING_ID}`).digest('hex').slice(0, 16);
const url = mod.publicMeetingUrl(MEETING_ID);
await check('publicMeetingUrl 產出正確連結(含簽章)', () => assert.equal(url, `${BASE}/m/${MEETING_ID}-${sig}`));

await check('正確簽章 → 200 + 會議標題', async () => { const res = await hitRoute(`/m/${MEETING_ID}-${sig}`); assert.equal(res.status, 200); assert.ok(res.body.includes('茲心園主管週會'), '缺標題'); assert.ok(res.body.includes('noindex'), '缺 noindex'); });
await check('錯誤簽章 → 404', async () => { const res = await hitRoute(`/m/${MEETING_ID}-0000000000000000`); assert.equal(res.status, 404); });
await check('非會議頁(簽章對)→ 404,不外洩其他頁', async () => { const nsig = crypto.createHmac('sha256', SECRET).update(`meeting:${NONMEET_ID}`).digest('hex').slice(0, 16); const res = await hitRoute(`/m/${NONMEET_ID}-${nsig}`); assert.equal(res.status, 404); });

let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);

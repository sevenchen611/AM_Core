// AM Platform core — 本地乾跑驗證(不需真憑證、不打真 API、不碰 BuildAM)
// 用假 fetch 模擬 Notion/LINE,跑「真的」bootstrap/router/notion 守衛/dispatcher/_stub-echo,
// 證明:兩租戶各自的群各發一則 → 分別落到「各自」的訊息庫,且隔離守衛擋掉越界存取。
//
// 執行:node tools/dryrun-core.mjs   (綠色全過 = core 管線 OK)

import assert from 'node:assert';
import { bootstrap } from '../core/bootstrap.js';

// ── 假 Notion 世界 ─────────────────────────────────────────
const ENG_PAGE = 'aaaa1111aaaa1111aaaa1111aaaa1111';
const SEN_PAGE = 'bbbb2222bbbb2222bbbb2222bbbb2222';
const DS = {
  engMessages: 'e0000000000000000000000000000001', engBindings: 'e0000000000000000000000000000002',
  engMeetings: 'e0000000000000000000000000000003', engTasks: 'e0000000000000000000000000000004',
  senMessages: 's0000000000000000000000000000001', senBindings: 's0000000000000000000000000000002',
};
// 每個資料源 → 其 database → database 的母頁(決定隔離歸屬)
const dsToDb = Object.fromEntries(Object.entries(DS).map(([, id]) => [id, `db_${id}`]));
const dbToPage = {};
for (const id of [DS.engMessages, DS.engBindings, DS.engMeetings, DS.engTasks]) dbToPage[`db_${id}`] = ENG_PAGE;
for (const id of [DS.senMessages, DS.senBindings]) dbToPage[`db_${id}`] = SEN_PAGE;

const GROUP_TO_TENANT = { gENG: 'engineering', gSEN: 'forest' }; // gUNBOUND → 未綁定
const stored = []; // { ds, groupId }  ← _stub-echo 寫入紀錄
const pushed = []; // { to, text }
let guardMetadataHits = 0;

function jsonResponse(obj, ok = true, status = 200) {
  const body = JSON.stringify(obj);
  return { ok, status, text: async () => body, json: async () => obj, headers: { get: () => 'application/json' } };
}

globalThis.fetch = async (input, options = {}) => {
  const urlStr = typeof input === 'string' ? input : input.url;
  const u = new URL(urlStr);
  const p = u.pathname;
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;

  // ── LINE ──
  if (u.host === 'api.line.me' && p.includes('/member/')) return jsonResponse({ displayName: '測試員' });
  if (u.host === 'api.line.me' && p.endsWith('/message/push')) {
    pushed.push({ to: body.to, text: body.messages?.[0]?.text || '' });
    return jsonResponse({});
  }
  // ── Notion 隔離守衛的 metadata 查詢 ──
  if (u.host === 'api.notion.com' && method === 'GET') {
    const dsm = p.match(/^\/v1\/data_sources\/([^/]+)$/);
    if (dsm) { guardMetadataHits++; return jsonResponse({ parent: { database_id: dsToDb[dsm[1]] }, archived: false, in_trash: false }); }
    const dbm = p.match(/^\/v1\/databases\/([^/]+)$/);
    if (dbm) return jsonResponse({ parent: { page_id: dbToPage[dbm[1]] }, archived: false, in_trash: false });
  }
  // ── Notion 群組綁定查詢 ──
  if (u.host === 'api.notion.com' && method === 'POST') {
    const qm = p.match(/^\/v1\/data_sources\/([^/]+)\/query$/);
    if (qm) {
      const dsId = qm[1];
      const gid = body?.filter?.and?.[0]?.rich_text?.equals || '';
      const wantTenant = GROUP_TO_TENANT[gid];
      const isEngBindings = dsId === DS.engBindings && wantTenant === 'engineering';
      const isSenBindings = dsId === DS.senBindings && wantTenant === 'forest';
      if (isEngBindings || isSenBindings) {
        return jsonResponse({ results: [{
          id: `binding_${gid}`,
          properties: {
            'LINE 群組 ID': { rich_text: [{ plain_text: gid }] },
            '狀態': { select: { name: '啟用' } },
            '專案': { relation: [{ id: `proj_${wantTenant}` }] },
            '群組角色': { select: { name: '內部' } },
            '工種': { select: {} },
            '成員對照': { rich_text: [] },
          },
        }] });
      }
      return jsonResponse({ results: [] });
    }
    // ── Notion 建立訊息頁 ──
    if (p === '/v1/pages') {
      stored.push({ ds: body?.parent?.data_source_id, props: body?.properties });
      return jsonResponse({ id: `page_${stored.length}` });
    }
  }
  return jsonResponse({ error: `unmocked ${method} ${urlStr}` }, false, 500);
};

// ── 假租戶(用 _stub-echo 驗管線;不動 tenants/*.json)──
const tenants = [
  {
    key: 'engineering', displayName: '工程', envPrefix: 'ENG', modules: ['_stub-echo'],
    parentPageId: ENG_PAGE,
    dataSources: { messages: DS.engMessages, groupBindings: DS.engBindings, meetings: DS.engMeetings, tasks: DS.engTasks },
    driveRootFolderId: '', driveConfigured: false, line: null, notionConfigured: true,
  },
  {
    key: 'forest', displayName: '森在', envPrefix: 'FOREST', modules: ['_stub-echo'],
    parentPageId: SEN_PAGE,
    dataSources: { messages: DS.senMessages, groupBindings: DS.senBindings },
    driveRootFolderId: '', driveConfigured: false, line: null, notionConfigured: true,
  },
];

const env = { NOTION_TOKEN: 'test', LINE_CHANNEL_ACCESS_TOKEN: 'test', LINE_CHANNEL_SECRET: 'test' };

function msgEvent(groupId, text, id) {
  return { type: 'message', message: { id, type: 'text', text }, source: { type: 'group', groupId, userId: 'U1' }, timestamp: 1 };
}

const results = [];
function check(name, fn) { return Promise.resolve().then(fn).then(() => { results.push([true, name]); }, (e) => { results.push([false, `${name} — ${e.message}`]); }); }

const { router, dispatcher, platform } = await bootstrap(env, { tenants, logger: { ...console, log: () => {} } });

async function handle(event) {
  const gid = event.source.groupId;
  const { tenant, binding } = await router.resolveGroupBinding(gid);
  if (!tenant) return null;
  await dispatcher.dispatchMessage({ tenant, binding, event });
  return tenant.key;
}

// 1) 工程群訊息 → 落工程訊息庫
await check('工程群訊息落入工程訊息庫', async () => {
  stored.length = 0;
  const t = await handle(msgEvent('gENG', '工程測試', 'm1'));
  assert.equal(t, 'engineering');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ds, DS.engMessages, `expected engMessages, got ${stored[0].ds}`);
});

// 2) 森在群訊息 → 落森在訊息庫(且不碰工程庫)
await check('森在群訊息落入森在訊息庫(隔離)', async () => {
  stored.length = 0;
  const t = await handle(msgEvent('gSEN', '森在測試', 'm2'));
  assert.equal(t, 'forest');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ds, DS.senMessages, `expected senMessages, got ${stored[0].ds}`);
  assert.notEqual(stored[0].ds, DS.engMessages);
});

// 3) 未綁定群 → 不落庫、不回話
await check('未綁定群被忽略', async () => {
  stored.length = 0;
  const t = await handle(msgEvent('gUNBOUND', '路人訊息', 'm3'));
  assert.equal(t, null);
  assert.equal(stored.length, 0);
});

// 4) 守衛:未登記的資料源 → 拒絕
await check('守衛擋下未登記資料源', async () => {
  await assert.rejects(
    () => platform.notionRequest('/v1/pages', { method: 'POST', body: { parent: { type: 'data_source_id', data_source_id: 'deadbeef00000000000000000000dead' }, properties: {} } }),
    /outside any tenant configuration/,
  );
});

// 5) 守衛:跨租戶 tenantKey 綁定不符 → 拒絕(工程寫森在庫)
await check('守衛擋下跨租戶存取', async () => {
  await assert.rejects(
    () => platform.notionRequest('/v1/pages', { method: 'POST', tenantKey: 'engineering', body: { parent: { type: 'data_source_id', data_source_id: DS.senMessages }, properties: {} } }),
    /Cross-tenant Notion access blocked/,
  );
});

// 6) 守衛真的驗證過母頁(有打 metadata)
await check('守衛驗證資料源母頁歸屬', () => {
  assert.ok(guardMetadataHits > 0, 'guard did not verify any data source metadata');
});

// ── 報告 ──
let pass = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

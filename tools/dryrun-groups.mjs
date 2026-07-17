// 群組治理後臺乾跑：不打網路、不讀 .env。
import assert from 'node:assert';
import { Readable } from 'node:stream';
import groups from '../modules/groups/index.js';
import { GROUP_BINDING_V2_PROPERTIES } from '../core/group-binding-schema.js';
import { createAccessContext } from '../core/access.js';

const calls = [];
const invalidated = [];
const tenant = { key: 'forest', displayName: '森在', modules: ['groups', 'queue', 'tasks'], dataSources: { groupBindings: 'forest-groups' } };
const portal = { userAuthed: async () => null, tenantAuthorized: () => false };
const access = createAccessContext({
  user: { id: 'forest-admin', displayName: '森在管理者', role: 'user', authzVersion: 3, amAccess: { forest: { mode: 'all', groupBindingIds: [] } } },
  tenant,
  authzMode: 'enforce',
});
const routeContext = (pathname) => ({ tenant, portal, access, pathname });
groups.init({
  logger: { warn: () => {} }, router: { invalidate: (groupId) => invalidated.push(groupId) }, portal,
  listGroupMemberIds: async (groupId) => groupId === 'gFOREST' ? ['U1', 'U2', 'U3'] : [],
  resolveGroupMemberName: async (_groupId, userId) => ({ U1: '葉小蝸', U2: '王小美', U3: '王小美' }[userId]),
  notionRequest: async (pathname, opts = {}) => {
    calls.push({ pathname, opts });
    if (pathname === '/v1/data_sources/forest-groups' && opts.method === 'GET') return { properties: GROUP_BINDING_V2_PROPERTIES };
    if (pathname.endsWith('/query')) return { results: [{ id: 'binding-1', properties: {
      '群組名稱': { title: [{ plain_text: '茲心園工務群' }] }, 'LINE 群組 ID': { rich_text: [{ plain_text: 'gFOREST' }] },
      '狀態': { select: { name: '啟用' } }, '群組角色': { select: { name: '內部' } },
      '成員對照': { rich_text: [{ plain_text: '{"葉小蝸":"U1"}' }] },
    } }], has_more: false };
    if (pathname === '/v1/pages/binding-1' && opts.method === 'PATCH') return { id: 'binding-1' };
    throw new Error(`unexpected ${opts.method} ${pathname}`);
  },
});

function response() { return { status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(value = '') { this.body += value; } }; }
function request(method, body = '') { const req = Readable.from(body ? [Buffer.from(body)] : []); req.method = method; req.headers = {}; return req; }
const route = groups.routes.find((item) => item.prefix === '/groups');
const results = [];
async function check(name, fn) { try { await fn(); results.push([true, name]); } catch (error) { results.push([false, `${name} — ${error.message}`]); } }

await check('群組頁只查 Forest 的群組資料源', async () => {
  const res = response();
  await route.handler(request('GET'), res, routeContext('/groups'));
  assert.equal(res.status, 200);
  assert.match(res.body, /茲心園工務群/);
  assert.match(res.body, /<select data-field="owner">/);
  assert.match(res.body, /<select data-field="reminderTargets" multiple size="4">/);
  assert.match(res.body, /同步成員/);
  assert.ok(calls.every((call) => call.opts.tenantKey === 'forest'));
});

await check('儲存群組設定以 tenantKey 更新既有頁並清快取', async () => {
  const res = response();
  await route.handler(request('POST', JSON.stringify({
    pageId: 'binding-1', name: '茲心園工務群', purpose: '工務協調', owner: '葉小蝸',
    capabilities: '訊息收集、待辦、案件狀態', goal: '茲心園營運', statusUpdatePolicy: '主要負責人', reminderTargets: '葉小蝸', status: '啟用',
  })), res, routeContext('/groups/api/update'));
  assert.equal(res.status, 200);
  const update = calls.find((call) => call.pathname === '/v1/pages/binding-1');
  assert.equal(update.opts.tenantKey, 'forest');
  assert.deepEqual(invalidated, ['gFOREST']);
});

await check('同步成員只讀 Forest 綁定並寫回 Forest 的成員對照', async () => {
  const res = response();
  await route.handler(request('POST', JSON.stringify({ pageId: 'binding-1' })), res, routeContext('/groups/api/sync-members'));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).memberCount, 3);
  const update = calls.filter((call) => call.pathname === '/v1/pages/binding-1').at(-1);
  assert.equal(update.opts.tenantKey, 'forest');
  const map = JSON.parse(update.opts.body.properties['成員對照'].rich_text[0].text.content);
  assert.deepEqual(map, { '葉小蝸': 'U1', '王小美（U2）': 'U2', '王小美（U3）': 'U3' });
  assert.ok(invalidated.includes('gFOREST'));
});

await check('未知功能不會寫入群組綁定', async () => {
  const res = response();
  await route.handler(request('POST', JSON.stringify({
    pageId: 'binding-1', groupId: 'gFOREST', name: '茲心園工務群', capabilities: '偷渡功能', statusUpdatePolicy: '所有成員', status: '啟用',
  })), res, routeContext('/groups/api/update'));
  assert.equal(res.status, 500);
  assert.equal(calls.some((call) => call.pathname === '/v1/pages/binding-1' && call.opts.body?.properties?.['啟用功能']?.multi_select?.some((x) => x.name === '偷渡功能')), false);
});

let passed = 0;
for (const [ok, name] of results) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (ok) passed++; }
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);

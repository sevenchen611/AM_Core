// AM Platform 全模組授權覆蓋稽核：不讀 .env、不打網路、不碰正式資料。
// 驗證租戶啟用模組、route access 分類，以及 webhook / scheduler 的 system principal。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDispatcher } from '../core/modules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALID_ROUTE_KINDS = new Set(['public', 'machine', 'tenant', 'group']);
const ROUTE_POLICY = {
  collect: [],
  triage: [],
  media: [],
  meetings: ['public'],
  reminders: ['machine'],
  groups: ['group'],
  queue: ['group'],
  tasks: ['group'],
  construction: ['tenant', 'group'],
};

const tenantFiles = fs.readdirSync(path.join(ROOT, 'tenants'))
  .filter((name) => name.endsWith('.json'))
  .sort();
const tenants = tenantFiles.map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', name), 'utf8')));
assert.ok(tenants.length > 0, '找不到租戶登記');

const requestedBy = new Map();
for (const tenant of tenants) {
  assert.ok(tenant.key && Array.isArray(tenant.modules), `租戶 ${tenant.key || '?'} modules 格式不正確`);
  if (tenant.runtimeEnabled === false) {
    assert.equal(tenant.authorizationReady, false, `遷移中租戶 ${tenant.key} 必須 fail closed`);
    assert.deepEqual(tenant.modules, [], `遷移中租戶 ${tenant.key} 不得啟動 AI 模組`);
    continue;
  }
  assert.ok(tenant.modules.includes('groups'), `租戶 ${tenant.key} 未啟用 groups，無法管理群組設定`);
  for (const name of tenant.modules) {
    if (!requestedBy.has(name)) requestedBy.set(name, []);
    requestedBy.get(name).push(tenant.key);
  }
}

const coverage = [];
for (const [name, tenantKeys] of [...requestedBy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  assert.ok(Object.prototype.hasOwnProperty.call(ROUTE_POLICY, name), `模組 ${name} 尚未定義授權政策`);
  const entry = path.join(ROOT, 'modules', name, 'index.js');
  assert.ok(fs.existsSync(entry), `模組 ${name} 缺少 index.js`);
  const mod = (await import(pathToFileURL(entry).href)).default;
  assert.equal(mod?.name, name, `模組 ${name} default export 名稱不一致`);
  const routes = Array.isArray(mod.routes) ? mod.routes : [];
  const actualKinds = new Set();
  for (const route of routes) {
    assert.equal(typeof route.handler, 'function', `${name} route 缺少 handler`);
    assert.ok(route.prefix || typeof route.match === 'function', `${name} route 缺少 prefix/match`);
    assert.ok(route.access && VALID_ROUTE_KINDS.has(route.access.kind), `${name} route 未宣告有效 access.kind`);
    if (route.access.kind !== 'public') {
      assert.ok(String(route.access.capability || '').trim(), `${name} ${route.access.kind} route 缺少 capability`);
    }
    actualKinds.add(route.access.kind);
  }
  const expectedKinds = new Set(ROUTE_POLICY[name]);
  assert.deepEqual([...actualKinds].sort(), [...expectedKinds].sort(), `${name} route 授權種類與政策不一致`);
  assert.ok(routes.length || typeof mod.onMessage === 'function' || typeof mod.onAudio === 'function' || typeof mod.tick === 'function', `${name} 沒有可執行介面`);
  coverage.push({ name, tenants: tenantKeys, routeKinds: [...actualKinds].sort(), eventHooks: ['onMessage', 'onAudio', 'tick'].filter((key) => typeof mod[key] === 'function') });
}

// 用最小探針確認 Core 注入的 principal 與 tenant-locked notionRequest，不靠模組自行約定。
let lineCtx = null;
let tickCtx = null;
let notionTenantKey = null;
const probeTenant = { key: 'audit', modules: ['probe'] };
const probe = {
  name: 'probe',
  async onMessage(ctx) {
    lineCtx = ctx;
    await ctx.notionRequest('/audit', { method: 'GET' });
    return true;
  },
  async tick(ctx) { tickCtx = ctx; },
  routes: [
    { prefix: '/valid', access: { kind: 'group', capability: 'audit.read' }, handler() {} },
    { prefix: '/invalid', handler() {} },
  ],
};
const dispatcher = createDispatcher({
  tenants: [probeTenant],
  modules: new Map([['probe', probe]]),
  platform: {
    resolveSenderName: async () => '測試者',
    notionRequest: async (_pathname, opts = {}) => { notionTenantKey = opts.tenantKey; return {}; },
    pushLineMessage: async () => {},
    downloadLineContent: async () => ({ buffer: Buffer.alloc(0), contentType: 'application/octet-stream' }),
  },
  logger: { log() {}, warn() {} },
});
await dispatcher.dispatchMessage({
  tenant: probeTenant,
  binding: { pageId: 'binding-a', role: '一般' },
  event: { source: { groupId: 'group-a', userId: 'user-a' }, message: { id: 'message-a', type: 'text', text: 'test' } },
});
await dispatcher.runTicks();
assert.equal(lineCtx?.principal?.kind, 'system');
assert.equal(lineCtx?.principal?.source, 'line-webhook');
assert.equal(tickCtx?.principal?.kind, 'system');
assert.equal(tickCtx?.principal?.source, 'scheduler');
assert.equal(notionTenantKey, 'audit');
assert.equal(dispatcher.collectRoutes().length, 1, '未宣告 access 的 route 必須 fail closed');

for (const item of coverage) {
  console.log(`✅ ${item.name}: tenants=${item.tenants.join(',')} routes=${item.routeKinds.join(',') || 'none'} hooks=${item.eventHooks.join(',') || 'none'}`);
}
for (const tenant of tenants.filter((item) => item.runtimeEnabled === false)) {
  console.log(`⏸ ${tenant.key}: migration-pending, modules disabled, authorization fail closed`);
}
console.log(`✅ system principal: webhook + scheduler；tenant-locked notionRequest；invalid route fail closed`);
console.log(`\n${coverage.length}/${coverage.length} enabled modules covered.`);

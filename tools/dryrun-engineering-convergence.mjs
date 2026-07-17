// AM Platform — 工程服務收斂乾跑（不打 LINE / Notion / Drive）。
// 驗證：ENG_* 載入、舊 Portal 相容但不跨租戶、模組短路順序、單據頁與路由完整。

import assert from 'node:assert/strict';
import { loadTenants } from '../core/tenants.js';
import { createPortal } from '../core/portal.js';
import { createDispatcher, loadModules } from '../core/modules.js';
import { handleTicketsRequest } from '../modules/construction/tickets.js';

const env = {
  AMCORE_QUEUE_ACCESS_KEY: 'platform-key',
  AMCORE_PORTAL_PIN: 'platform-pin',
  MINIMAX_API_KEY: 'global-mm',
  ENG_NOTION_PARENT_PAGE_ID: '11111111111111111111111111111111',
  ENG_MESSAGES_DATA_SOURCE_ID: '22222222222222222222222222222222',
  ENG_GROUP_BINDINGS_DATA_SOURCE_ID: '33333333333333333333333333333333',
  ENG_QUEUE_ACCESS_KEY: 'engineering-key',
  ENG_PORTAL_PIN: 'engineering-pin',
  ENG_CAL_ZS: 'zs-calendar',
  ENG_AI_PROVIDER: 'minimax',
  ENG_AI_JUDGE_MODEL: 'MiniMax-M3',
  ENG_MINIMAX_API_KEY: 'engineering-mm',
};

const tenants = loadTenants(env, { warn() {} });
const engineering = tenants.find((tenant) => tenant.key === 'engineering');
const forest = tenants.find((tenant) => tenant.key === 'forest');
assert.ok(engineering, 'engineering tenant should load');
assert.deepEqual(engineering.modules, ['collect', 'meetings', 'media', 'triage', 'queue', 'tasks', 'reminders', 'construction', 'groups']);
assert.equal(engineering.queueAccessKey, 'engineering-key');
assert.equal(engineering.portalPin, 'engineering-pin');
assert.equal(engineering.calendars.ZS, 'zs-calendar');
assert.equal(engineering.ai.minimaxApiKey, 'engineering-mm');
assert.equal(engineering.ai.judgeModel, 'MiniMax-M3');

const portal = createPortal({ queueAccessKey: 'platform-key', portalPin: 'platform-pin', logger: { warn() {} } });
const scopedCookie = portal.pinCookieHeader(engineering).split(';')[0];
assert.equal(portal.checkPin('engineering-pin', engineering), true);
assert.equal(portal.pinAuthed({ headers: { cookie: scopedCookie } }, engineering), true);
assert.equal(portal.pinAuthed({ headers: { cookie: scopedCookie } }, forest), false, 'engineering PIN cookie must not open forest');

// 舊工程 cookie / Portal feature 在切換期仍可用，但只映射到 engineering。
const legacyValue = portal.pinCookieValue();
assert.equal(portal.pinAuthed({ headers: { cookie: `buildam_auth=${legacyValue}` } }, engineering), false,
  'legacy cookie with platform key must not match tenant key');
const tenantLegacyPortal = createPortal({ queueAccessKey: 'engineering-key', portalPin: 'engineering-pin', logger: { warn() {} } });
assert.equal(tenantLegacyPortal.pinAuthed({ headers: { cookie: `buildam_auth=${tenantLegacyPortal.pinCookieValue()}` } }, engineering), true);
const legacyUser = { role: 'member', active: true, allowedFeatures: ['am-buildam', 'am-buildam-zs', 'am-buildam-budget'], projectIds: ['buildam'] };
assert.equal(portal.tenantAuthorized(legacyUser, engineering), true);
assert.equal(portal.tenantAuthorized(legacyUser, forest), false);
assert.equal(portal.tenantScope(legacyUser, engineering), 'ZS');
assert.equal(portal.featureGranted(legacyUser, engineering, 'budget'), true);

// 模組順序守住舊行為：會議 roster 回覆先於 AI 初判；一般文字才進 triage。
function fakeModule(name, handled = false, calls = []) {
  return { name, async onMessage() { calls.push(name); return typeof handled === 'function' ? handled() : handled; } };
}
const calls = [];
const registry = new Map(engineering.modules.map((name) => [name, fakeModule(name, false, calls)]));
registry.set('meetings', fakeModule('meetings', true, calls));
registry.set('triage', fakeModule('triage', true, calls));
const dispatcher = createDispatcher({
  tenants: [engineering], modules: registry,
  platform: {
    resolveSenderName: async () => '測試者',
    downloadLineContent: async () => ({ buffer: new ArrayBuffer(0), contentType: 'text/plain' }),
    notionRequest: async () => ({}), pushLineMessage: async () => {},
  },
  logger: { warn() {}, log() {} },
});
await dispatcher.dispatchMessage({
  tenant: engineering,
  binding: { role: '工班', projectPageId: 'project' },
  event: { source: { groupId: 'group' }, message: { id: 'm1', type: 'text', text: '與會者是小明' } },
});
assert.deepEqual(calls, ['collect', 'meetings']);

calls.length = 0;
registry.set('meetings', fakeModule('meetings', false, calls));
const ordinaryDispatcher = createDispatcher({
  tenants: [engineering], modules: registry,
  platform: {
    resolveSenderName: async () => '測試者',
    downloadLineContent: async () => ({ buffer: new ArrayBuffer(0), contentType: 'text/plain' }),
    notionRequest: async () => ({}), pushLineMessage: async () => {},
  },
  logger: { warn() {}, log() {} },
});
await ordinaryDispatcher.dispatchMessage({
  tenant: engineering,
  binding: { role: '工班', projectPageId: 'project' },
  event: { source: { groupId: 'group' }, message: { id: 'm2', type: 'text', text: '301 房漏水' } },
});
assert.deepEqual(calls, ['collect', 'meetings', 'media', 'triage']);

// 真模組可載入，且工程單據頁的瀏覽器程式可被 JavaScript parser 接受。
const loaded = await loadModules({
  tenants: [engineering],
  platform: {
    logger: { log() {}, warn() {} },
    notionRequest: async () => ({}), pushLineMessage: async () => {}, lineGet: async () => ({}),
    llm: { available: false }, llmForTenant: () => ({ available: false }),
  },
  logger: { log() {}, warn() {} },
});
for (const name of engineering.modules) assert.ok(loaded.has(name), `${name} should load`);

let ticketHtml = '';
await handleTicketsRequest({ method: 'GET' }, {
  writeHead() {}, end(value = '') { ticketHtml += value; },
}, '/tickets', new URL('https://platform.test/tickets?tenant=engineering'), { tenantKey: 'engineering' });
assert.match(ticketHtml, /工程單據管理/);
assert.match(ticketHtml, /回饋單/);
assert.match(ticketHtml, /變更單/);
const script = ticketHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] || '';
assert.ok(script, 'tickets page should contain client script');
new Function(script); // compile only; no browser globals are executed

console.log('engineering convergence dryrun: 18/18 checks passed');

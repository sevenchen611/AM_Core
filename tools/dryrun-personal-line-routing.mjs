import assert from 'node:assert/strict';
import { createRouter } from '../core/router.js';
import { createDispatcher } from '../core/modules.js';
import { routeDirectLineEvent } from '../core/direct-line.js';
import { responseFor } from '../modules/personal-assistant/index.js';

function text(value) {
  return value ? { rich_text: [{ plain_text: value }] } : { rich_text: [] };
}

function title(value) {
  return value ? { title: [{ plain_text: value }] } : { title: [] };
}

function groupPage({ id, groupId, groupName, status = '啟用', members = {} }) {
  return {
    id,
    properties: {
      'LINE 群組 ID': text(groupId),
      '群組名稱': title(groupName),
      '狀態': { select: { name: status } },
      '成員對照': text(JSON.stringify(members)),
    },
  };
}

const hozo = {
  key: 'hozo-am-2-0', displayName: 'HOZO AM 2.0', runtimeEnabled: true, notionConfigured: true,
  modules: ['personal-assistant', 'group-spy'],
  config: { personalAssistant: { enabled: true } },
  dataSources: { groupBindings: 'ds-hozo' },
};
const seven = {
  key: '7am', displayName: 'Seven AM', runtimeEnabled: true, notionConfigured: true,
  modules: ['personal-assistant'],
  config: { personalAssistant: { enabled: true } },
  dataSources: { groupBindings: 'ds-seven' },
};
const disabled = {
  key: 'disabled', displayName: 'Disabled', runtimeEnabled: true, notionConfigured: true,
  modules: ['personal-assistant'],
  config: { personalAssistant: { enabled: false } },
  dataSources: { groupBindings: 'ds-disabled' },
};

const pages = {
  'ds-hozo': [
    groupPage({ id: 'h1', groupId: 'g-h1', groupName: 'HOZO 營運', members: { Maggie: 'U_HOZO', Seven: 'U_CROSS' } }),
    groupPage({ id: 'h2', groupId: 'g-h2', groupName: 'HOZO 財務', members: { 'Maggie 新名稱': 'U_HOZO' } }),
    groupPage({ id: 'h3', groupId: 'g-h3', groupName: 'HOZO 影子', status: '影子記錄', members: { Shadow: 'U_SHADOW' } }),
    groupPage({ id: 'h4', groupId: 'g-h4', groupName: 'HOZO 子字串', members: { Other: 'U_HOZO_EXTRA' } }),
  ],
  'ds-seven': [
    groupPage({ id: 's1', groupId: 'g-s1', groupName: 'Seven 營運', members: { Seven: 'U_CROSS' } }),
  ],
  'ds-disabled': [
    groupPage({ id: 'd1', groupId: 'g-d1', groupName: 'Disabled', members: { Disabled: 'U_DISABLED' } }),
  ],
};

let failSevenLookup = false;
const queryCalls = [];
async function notionRequest(pathname, options = {}) {
  const match = pathname.match(/^\/v1\/data_sources\/([^/]+)\/query$/);
  assert.ok(match, `unexpected Notion path ${pathname}`);
  const dataSourceId = decodeURIComponent(match[1]);
  queryCalls.push({ dataSourceId, tenantKey: options.tenantKey, body: options.body });
  if (failSevenLookup && dataSourceId === 'ds-seven') throw new Error('temporary Notion failure');
  // 刻意回傳所有頁面，證明 router 仍會解析 JSON 並完整比對 userId，不能只信 contains 候選。
  return { results: pages[dataSourceId] || [] };
}

const warnings = [];
const logger = { log() {}, warn(message) { warnings.push(String(message)); } };
const router = createRouter({ tenants: [hozo, seven, disabled], notionRequest, logger });

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ ok: true, name });
  } catch (error) {
    checks.push({ ok: false, name, error: error.message });
  }
}

await check('唯一 HOZO userId 建立私人身分並合併同租戶群組', async () => {
  const result = await router.resolveDirectBinding('U_HOZO');
  assert.equal(result.reason, 'bound');
  assert.equal(result.tenant?.key, 'hozo-am-2-0');
  assert.deepEqual(result.binding.groupBindingIds, ['h1', 'h2']);
  assert.deepEqual(result.binding.groupIds, ['g-h1', 'g-h2']);
  assert.equal(result.binding.source, 'active-group-member-map');
});

await check('子字串候選與影子群組都不能授予私人身分', async () => {
  router.invalidateDirect();
  assert.equal((await router.resolveDirectBinding('U_HOZO_EX')).reason, 'not_found');
  router.invalidateDirect();
  assert.equal((await router.resolveDirectBinding('U_SHADOW')).reason, 'not_found');
});

await check('未啟用私人助理的租戶不參與身分判斷', async () => {
  router.invalidateDirect();
  assert.equal((await router.resolveDirectBinding('U_DISABLED')).reason, 'not_found');
  assert.equal(queryCalls.some((call) => call.dataSourceId === 'ds-disabled'), false);
});

await check('同一 userId 跨租戶時 fail closed', async () => {
  router.invalidateDirect();
  const result = await router.resolveDirectBinding('U_CROSS');
  assert.equal(result.reason, 'ambiguous');
  assert.equal(result.tenant, null);
});

await check('任一租戶查核失敗時不快取錯誤且拒絕路由', async () => {
  failSevenLookup = true;
  router.invalidateDirect();
  const failed = await router.resolveDirectBinding('U_HOZO');
  assert.equal(failed.reason, 'lookup_failed');
  failSevenLookup = false;
  const retried = await router.resolveDirectBinding('U_HOZO');
  assert.equal(retried.reason, 'bound');
});

await check('私人分派只呼叫 onDirectMessage，不呼叫群組 onMessage', async () => {
  let directCalls = 0;
  let groupCalls = 0;
  const modules = new Map([
    ['personal-assistant', { name: 'personal-assistant', async onDirectMessage(ctx) {
      directCalls += 1;
      assert.equal(ctx.conversationType, 'direct');
      assert.equal(ctx.principal.kind, 'line-user');
      assert.equal(ctx.tenant.key, 'hozo-am-2-0');
      return true;
    } }],
    ['group-spy', { name: 'group-spy', async onMessage() { groupCalls += 1; return true; } }],
  ]);
  const dispatcher = createDispatcher({
    tenants: [hozo], modules, logger,
    platform: {
      resolveSenderName: async () => 'Maggie',
      notionRequest,
      pushLineMessage: async () => {},
      replyLineMessage: async () => {},
    },
  });
  const handled = await dispatcher.dispatchDirectMessage({
    tenant: hozo,
    personalBinding: { source: 'active-group-member-map', displayName: 'Maggie' },
    event: { type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'U_HOZO' }, message: { type: 'text', text: '我的身分' } },
  });
  assert.equal(handled, true);
  assert.equal(directCalls, 1);
  assert.equal(groupCalls, 0);
});

await check('直接事件未綁定時只回覆說明，不交給 dispatcher', async () => {
  const replies = [];
  let dispatched = false;
  const result = await routeDirectLineEvent({
    event: { type: 'message', replyToken: 'r2', source: { type: 'user', userId: 'U_NONE' }, message: { type: 'text', text: '我的今天' } },
    router: { resolveDirectBinding: async () => ({ tenant: null, binding: null, reason: 'not_found' }) },
    dispatcher: { async dispatchDirectMessage() { dispatched = true; } },
    replyLineMessage: async (_token, message) => replies.push(message),
    logger,
  });
  assert.equal(result.matched, true);
  assert.equal(result.routed, false);
  assert.equal(dispatched, false);
  assert.match(replies[0], /尚未完成 HOZO 私人助理身分綁定/);
});

await check('已綁定的一對一訊息會帶正確租戶與私人身分進入 dispatcher', async () => {
  let dispatched = null;
  const result = await routeDirectLineEvent({
    event: { type: 'message', replyToken: 'r3', source: { type: 'user', userId: 'U_HOZO' }, message: { type: 'text', text: '我的身分' } },
    router: { resolveDirectBinding: async () => ({ tenant: hozo, binding: { source: 'active-group-member-map', displayName: 'Maggie' }, reason: 'bound' }) },
    dispatcher: { async dispatchDirectMessage(input) { dispatched = input; return true; } },
    replyLineMessage: async () => { throw new Error('handled direct message must not use fallback reply'); },
    logger,
  });
  assert.equal(result.matched, true);
  assert.equal(result.routed, true);
  assert.equal(result.handled, true);
  assert.equal(dispatched.tenant.key, 'hozo-am-2-0');
  assert.equal(dispatched.personalBinding.displayName, 'Maggie');
});

await check('已綁定的 follow 事件只回覆身分確認，不進入訊息 dispatcher', async () => {
  const replies = [];
  let dispatched = false;
  const result = await routeDirectLineEvent({
    event: { type: 'follow', replyToken: 'r4', source: { type: 'user', userId: 'U_HOZO' } },
    router: { resolveDirectBinding: async () => ({ tenant: hozo, binding: { displayName: 'Maggie' }, reason: 'bound' }) },
    dispatcher: { async dispatchDirectMessage() { dispatched = true; } },
    replyLineMessage: async (_token, message) => replies.push(message),
    logger,
  });
  assert.equal(result.matched, true);
  assert.equal(result.routed, true);
  assert.equal(dispatched, false);
  assert.match(replies[0], /已確認你的 HOZO AM 2\.0 身分/);
});

await check('群組事件不會被私人入口攔截', async () => {
  const result = await routeDirectLineEvent({
    event: { type: 'message', source: { type: 'group', groupId: 'g-h1', userId: 'U_HOZO' }, message: { type: 'text', text: '群組訊息' } },
    router: { async resolveDirectBinding() { throw new Error('must not run'); } },
    dispatcher: {}, replyLineMessage: async () => {}, logger,
  });
  assert.deepEqual(result, { matched: false });
});

await check('私人助理第一階段回覆清楚標示身分與資料邊界', () => {
  const reply = responseFor({
    tenant: hozo,
    personalBinding: { displayName: 'Maggie' },
    senderName: 'Maggie', text: '我的身分',
  });
  assert.match(reply, /Maggie/);
  assert.match(reply, /HOZO AM 2.0/);
  assert.match(reply, /LINE user ID/);
});

for (const result of checks) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ` — ${result.error}` : ''}`);
}
const failed = checks.filter((item) => !item.ok);
if (failed.length) process.exitCode = 1;
else console.log(`Personal LINE routing dry-run passed: ${checks.length}/${checks.length}`);

// AM Platform — 租戶→對話群組授權 dry-run（不連正式 Portal / Notion / LINE）。
// 驗證 AccessContext、直接竄改 pageId、附件追溯與批次確認皆 fail closed。

import assert from 'node:assert/strict';
import queue, { __test as queueTest } from '../modules/queue/index.js';
import tasks from '../modules/tasks/index.js';
import { ticketAction } from '../modules/construction/tickets.js';
import { createAccessContext } from '../core/access.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MESSAGE_B = 'cccccccccccccccccccccccccccccccc';
const ATTACHMENT_B = 'dddddddddddddddddddddddddddddddd';
const FIFTH = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TASK_B = 'ffffffffffffffffffffffffffffffff';
const TICKET_B = '11111111111111111111111111111111';

const tenant = {
  key: 'forest',
  displayName: '森在 AM / Forest AM',
  modules: ['queue'],
  dataSources: { messages: 'messages-ds', groupBindings: 'bindings-ds', attachments: 'attachments-ds', tasks: 'tasks-ds' },
};

const user = {
  id: 'user-a', username: 'tony', displayName: 'Tony', role: 'user', active: true, authzVersion: 3,
  amAccess: { forest: { mode: 'selected', groupBindingIds: [A] } },
};
const selectedA = createAccessContext({ user, tenant, authzMode: 'enforce' });
const tenantAll = createAccessContext({
  user: { ...user, id: 'all', amAccess: { forest: { mode: 'all', groupBindingIds: [] } } },
  tenant,
  authzMode: 'enforce',
});
const selectedMasterOnly = createAccessContext({
  user: { ...user, id: 'master', amAccess: { forest: { mode: 'selected', groupBindingIds: [A] } } },
  tenant,
  authzMode: 'enforce',
});

const calls = [];
let lastQueryBody = null;
let lastCreatedTaskBody = null;
const bindingPage = (id, role = '一般') => ({
  id,
  properties: {
    '狀態': { select: { name: '啟用' } },
    '群組角色': { select: { name: role } },
    '專案': { relation: [] },
  },
});
const messageB = {
  id: MESSAGE_B,
  properties: {
    '群組綁定': { relation: [{ id: B }] },
    '掛載狀態': { select: { name: 'AI初判待確認' } },
    '訊息類型': { select: { name: '文字' } },
    '訊息': { title: [{ plain_text: 'B 群資料' }] },
    '時間': { date: { start: '2026-07-17T10:00:00+08:00' } },
  },
};

const fakePlatform = {
  logger: { warn() {}, error() {}, info() {} },
  driveConfigured: true,
  googleAccessToken: async () => { throw new Error('Drive 不應被呼叫'); },
  notionRequest: async (pathname, options = {}) => {
    calls.push({ pathname, method: options.method || 'GET', tenantKey: options.tenantKey });
    if (pathname.includes('/data_sources/messages-ds/query')) {
      lastQueryBody = options.body;
      // 故意模擬資料端回傳 B 群，確認應用層仍會二次過濾。
      return { results: [messageB], has_more: false };
    }
    if (pathname.endsWith(`/pages/${MESSAGE_B}`)) return messageB;
    if (pathname.endsWith(`/pages/${TASK_B}`)) {
      return { id: TASK_B, properties: { '負責群組': { relation: [{ id: B }] } } };
    }
    if (pathname.endsWith(`/pages/${TICKET_B}`)) {
      return { id: TICKET_B, properties: { '負責群組': { relation: [{ id: B }] } } };
    }
    if (pathname.endsWith(`/pages/${ATTACHMENT_B}`)) {
      return {
        id: ATTACHMENT_B,
        properties: {
          '訊息': { relation: [{ id: MESSAGE_B }] },
          'Drive 連結': { url: 'https://drive.google.com/file/d/SHOULD_NOT_BE_READ/view' },
        },
      };
    }
    if (pathname.endsWith(`/pages/${A}`)) return bindingPage(A, '總管');
    if (pathname.endsWith(`/pages/${B}`)) return bindingPage(B);
    if (pathname === '/v1/pages' && options.method === 'POST') {
      lastCreatedTaskBody = options.body;
      return { id: 'new-task-page' };
    }
    throw new Error(`unexpected Notion call: ${pathname}`);
  },
};
queue.init(fakePlatform);
tasks.init(fakePlatform);

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) { this.statusCode = statusCode; this.headers = headers; },
    end(body = '') { this.body = String(body); return this; },
  };
}

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ ok: true, name });
  } catch (error) {
    checks.push({ ok: false, name: `${name} — ${error.message}` });
  }
}

await check('指定群組 A 可讀 A，但不可讀 B', () => {
  assert.equal(selectedA.can('queue.read', A, { status: '啟用' }), true);
  assert.equal(selectedA.can('queue.read', B, { status: '啟用' }), false);
});

await check('只授權總管群不會自動擴張到其他群組', () => {
  assert.equal(selectedMasterOnly.can('queue.read', B, { status: '啟用' }), false);
});

await check('停用群組讓指定群組帳號立即失去資料', () => {
  assert.equal(selectedA.can('queue.read', A, { status: '停用' }), false);
});

await check('租戶全群組自動包含未來第五群；指定群組不包含', () => {
  assert.equal(tenantAll.can('groups.read', FIFTH, { status: '啟用' }), true);
  assert.equal(selectedA.can('groups.read', FIFTH, { status: '啟用' }), false);
});

await check('竄改 B 群訊息 pageId 回 404，且沒有任何 Notion PATCH', async () => {
  calls.length = 0;
  await assert.rejects(
    () => queueTest.confirmMessage(tenant, { pageId: MESSAGE_B, action: 'confirm', operator: 'Tony' }, selectedA),
    (error) => error?.statusCode === 404,
  );
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

await check('附件 ID 必須追溯至訊息與群組；B 群附件回 404 且不讀 Drive', async () => {
  calls.length = 0;
  const res = mockResponse();
  await queueTest.handleQueueRequest(
    { method: 'GET', headers: {} },
    res,
    {
      tenant,
      access: selectedA,
      portal: {},
      pathname: '/queue/api/photo',
      url: new URL(`https://am.example/queue/api/photo?tenant=forest&attachment=${ATTACHMENT_B}`),
    },
  );
  assert.equal(res.statusCode, 404);
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

await check('批次確認只查授權 relation，資料端誤回 B 群仍不會 PATCH', async () => {
  calls.length = 0;
  lastQueryBody = null;
  const result = await queueTest.batchConfirm(tenant, { operator: 'Tony' }, selectedA);
  assert.equal(result.confirmed, 0);
  const serialized = JSON.stringify(lastQueryBody || {});
  assert.match(serialized, new RegExp(A));
  assert.doesNotMatch(serialized, new RegExp(B));
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

await check('LINE 建立待辦預設寫入 ctx.binding.pageId', async () => {
  lastCreatedTaskBody = null;
  await tasks.createTask({ tenant, binding: { pageId: A }, groupId: 'line-group-a' }, { content: '測試待辦' });
  assert.equal(lastCreatedTaskBody?.properties?.['負責群組']?.relation?.[0]?.id, A);
});

await check('竄改 B 群待辦 ID 更新狀態回 404，且沒有 Notion PATCH', async () => {
  calls.length = 0;
  await assert.rejects(
    () => tasks.setStatus({ tenant, access: selectedA }, TASK_B, '完成'),
    (error) => error?.statusCode === 404,
  );
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

await check('竄改 B 群工程案件 ID 回 404，且沒有 Notion PATCH', async () => {
  calls.length = 0;
  await assert.rejects(
    () => ticketAction({
      tenantKey: tenant.key,
      access: selectedA,
      notionRequest: (pathname, options) => fakePlatform.notionRequest(pathname, { ...options, tenantKey: tenant.key }),
    }, { ticketId: TICKET_B, action: 'reply', text: '處理進度', operator: 'Tony' }),
    (error) => error?.statusCode === 404,
  );
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
});

let passed = 0;
for (const item of checks) {
  console.log(`${item.ok ? '✅' : '❌'} ${item.name}`);
  if (item.ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} group authorization checks passed.`);
process.exit(passed === checks.length ? 0 : 1);

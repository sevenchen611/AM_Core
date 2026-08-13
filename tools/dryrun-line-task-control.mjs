import assert from 'node:assert/strict';
import taskControl, { __test } from '../modules/task-control/index.js';

assert.equal(__test.sameId('A1B2-C3D4', 'a1b2c3d4'), true);
assert.match(__test.weekEndTaipei(), /^\d{4}-\d{2}-\d{2}$/);
await assert.rejects(
  __test.withTimeout(new Promise(() => {}), 5, '私人待辦查詢逾時'),
  (error) => error.code === 'TASK_QUERY_TIMEOUT',
);

const TENANT = { key: 'hozo-am-2-0', dataSources: { tasks: 'hz2-tasks' } };
const BINDING = { pageId: 'binding-hozo' };
const schema = { properties: {
  '內容': { title: {} }, '狀態': { select: { options: [{ name: '待辦' }, { name: '進行中' }, { name: '完成' }] } },
  '期限': { date: {} }, '負責群組': { relation: {} }, '目前進度': { rich_text: {} }, '下一步': { rich_text: {} },
  '阻礙': { rich_text: {} }, '關鍵字': { multi_select: {} }, '最近更新': { date: {} },
} };
const properties = (title, status = '待辦', owner = 'Seven') => ({
  '內容': { type: 'title', title: [{ plain_text: title }] },
  '負責人': { type: 'rich_text', rich_text: [{ plain_text: owner }] },
  '狀態': { type: 'select', select: { name: status } },
  '期限': { type: 'date', date: { start: '2026-08-13' } },
  '負責群組': { type: 'relation', relation: [{ id: BINDING.pageId }] },
  '目前進度': { type: 'rich_text', rich_text: [] }, '下一步': { type: 'rich_text', rich_text: [] },
  '阻礙': { type: 'rich_text', rich_text: [] }, '關鍵字': { type: 'multi_select', multi_select: [{ name: '招募' }] }, '最近更新': { type: 'date', date: null },
});
const pages = new Map([
  ['a1b2c3d4', { id: 'a1b2c3d4', parent: { data_source_id: 'hz2-tasks' }, properties: properties('確認門市招募文案') }],
  ['b1b2c3d4', { id: 'b1b2c3d4', parent: { data_source_id: 'hz2-tasks' }, properties: properties('回覆空調廠商') }],
  ['c1b2c3d4', { id: 'c1b2c3d4', parent: { data_source_id: 'hz2-tasks' }, properties: { ...properties('其他群組任務'), '負責群組': { type: 'relation', relation: [{ id: 'other-binding' }] } } }],
  ['d1b2c3d4', { id: 'd1b2c3d4', parent: { data_source_id: 'hz2-tasks' }, properties: { ...properties('私人未分組任務'), '負責群組': { type: 'relation', relation: [] } } }],
  ['e1b2c3d4', { id: 'e1b2c3d4', parent: { data_source_id: 'hz2-tasks' }, properties: { ...properties('其他人的任務', '待辦', 'Maggie'), '負責群組': { type: 'relation', relation: [{ id: 'other-binding' }] } } }],
]);
const calls = [];
const replies = [];
const notionRequest = async (pathname, options = {}) => {
  calls.push({ pathname, options });
  if (pathname === '/v1/data_sources/hz2-tasks' && options.method === 'GET') return schema;
  if (pathname === '/v1/data_sources/hz2-tasks/query') return { results: [...pages.values()].filter((page) => page.properties['負責群組'].relation.some((item) => item.id === BINDING.pageId)) };
  const page = pathname.match(/^\/v1\/pages\/([^/]+)$/)?.[1];
  if (page && options.method === 'GET') return pages.get(page);
  if (page && options.method === 'PATCH') {
    for (const [name, value] of Object.entries(options.body.properties || {})) {
      const target = pages.get(page).properties[name];
      Object.assign(target, value);
    }
    return pages.get(page);
  }
  if (/^\/v1\/blocks\/.+\/children$/.test(pathname) && options.method === 'PATCH') return { ok: true };
  throw new Error(`Unhandled notion request: ${pathname} ${options.method || 'GET'}`);
};
taskControl.init({
  logger: { warn() {} },
  replyLineMessages: async (_token, messages) => replies.push(messages),
  tasks: {
    listByOwner: async (_ctx, { owner }) => [...pages.values()].filter((page) => page.properties['負責人'].rich_text[0]?.plain_text === owner),
  },
});
const ctx = (overrides = {}) => ({ tenant: TENANT, binding: BINDING, groupId: 'line-group', senderName: 'Seven', notionRequest, event: { replyToken: 'reply', source: { userId: 'U1' }, timestamp: 1 }, text: '', ...overrides });

assert.equal(await taskControl.onMessage(ctx({ text: '今天待辦' })), true);
assert.equal(replies.at(-1)[0].type, 'flex');
assert.equal(replies.at(-1)[0].contents.contents.length, 2);

assert.equal(await taskControl.onPostback(ctx({ postback: { data: 'am-task-1:complete:a1b2c3d4' } })), true);
assert.equal(pages.get('a1b2c3d4').properties['狀態'].select.name, '完成');
assert.equal(await taskControl.onPostback(ctx({ postback: { data: 'am-task-1:complete:a1b2c3d4' } })), true);
assert.equal(calls.filter((call) => /\/children$/.test(call.pathname)).length, 1, 'completed task must not append duplicate events');

assert.equal(await taskControl.onPostback(ctx({ postback: { data: 'am-task-1:progress:b1b2c3d4' } })), true);
assert.equal(await taskControl.onMessage(ctx({ text: '已收到初稿，等待營運確認。' })), true);
assert.equal(pages.get('b1b2c3d4').properties['目前進度'].rich_text[0].text.content, '已收到初稿，等待營運確認。');

assert.equal(await taskControl.onPostback(ctx({ postback: { data: 'am-task-1:detail:c1b2c3d4' } })), true);
assert.match(replies.at(-1)[0].text, /不屬於目前群組/);

const directCtx = (overrides = {}) => ({
  tenant: TENANT,
  binding: null,
  personalBinding: { displayName: 'Seven', memberNames: ['Seven'], groupBindingIds: [BINDING.pageId] },
  conversationType: 'direct',
  directUserId: 'U1',
  groupId: '',
  senderName: 'Seven',
  notionRequest,
  event: { replyToken: 'reply-direct', source: { type: 'user', userId: 'U1' }, timestamp: 2 },
  text: '',
  ...overrides,
});

assert.deepEqual(__test.parseCommand('我的今天'), { type: 'list', range: 'today' });
assert.deepEqual(__test.parseCommand('我的行事曆'), { type: 'list', range: 'week' });
assert.equal(await taskControl.onDirectMessage(directCtx({ text: '我的今天' })), true);
assert.equal(replies.at(-1)[0].type, 'flex');
assert.equal(replies.at(-1)[0].contents.contents.length, 2, 'direct list contains owned allowed-group and unassigned tasks only');
assert.equal(await taskControl.onDirectPostback(directCtx({ postback: { data: 'am-task-1:detail:d1b2c3d4' } })), true);
assert.equal(replies.at(-1)[0].type, 'flex');
assert.equal(await taskControl.onDirectPostback(directCtx({ postback: { data: 'am-task-1:detail:c1b2c3d4' } })), true);
assert.match(replies.at(-1)[0].text, /不屬於你的私人待辦範圍/);
console.log('line-task-control dry run passed');

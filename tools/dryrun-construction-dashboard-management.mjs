import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleDashboardRequest } from '../modules/construction/dashboard.js';
import {
  createDashboardSpace,
  createDashboardTrade,
  createDashboardWorkItem,
  dashboardSetupOptions,
} from '../modules/construction/master-data.js';
import { clearTradeCache } from '../modules/construction/trades.js';

const PROJECT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_PROJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SPACE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DS_PROJECTS = 'ds-projects';
const DS_SPACES = 'ds-spaces';
const DS_WORK_ITEMS = 'ds-work-items';

const rt = (value) => [{ plain_text: value }];
const schemas = {
  [DS_SPACES]: { properties: {
    '名稱': { type: 'title', title: {} },
    '專案': { type: 'relation', relation: {} },
    '區/棟': { type: 'rich_text', rich_text: {} },
    '類型': { type: 'select', select: { options: [] } },
    '別名': { type: 'rich_text', rich_text: {} },
  } },
  [DS_WORK_ITEMS]: { properties: {
    '工項': { type: 'title', title: {} },
    '專案': { type: 'relation', relation: {} },
    '空間': { type: 'relation', relation: {} },
    '工種': { type: 'select', select: { options: [{ name: '拆除', color: 'red' }] } },
    '狀態': { type: 'select', select: { options: [{ name: '未開始' }] } },
    '預計開始': { type: 'date', date: {} },
    '預計完成': { type: 'date', date: {} },
    '負責工班': { type: 'rich_text', rich_text: {} },
  } },
};

function makeHarness({ spaceProject = PROJECT, spaces = [] } = {}) {
  const calls = [];
  let created = 0;
  const deps = {
    tenantKey: `engineering-test-${Math.random()}`,
    actor: 'Seven',
    dataSources: { projects: DS_PROJECTS, spaces: DS_SPACES, workItems: DS_WORK_ITEMS },
    async notionRequest(pathname, options = {}) {
      calls.push({ pathname, options });
      if (pathname === `/v1/pages/${encodeURIComponent(PROJECT)}` && options.method === 'GET') {
        return {
          id: PROJECT,
          parent: { data_source_id: DS_PROJECTS },
          properties: { '館別代碼': { rich_text: rt('HZ') } },
        };
      }
      if (pathname === `/v1/pages/${encodeURIComponent(SPACE)}` && options.method === 'GET') {
        return {
          id: SPACE,
          parent: { data_source_id: DS_SPACES },
          properties: {
            '名稱': { title: rt('3F-301浴室') },
            '專案': { relation: [{ id: spaceProject }] },
          },
        };
      }
      if (pathname === `/v1/data_sources/${encodeURIComponent(DS_SPACES)}` && options.method === 'GET') return schemas[DS_SPACES];
      if (pathname === `/v1/data_sources/${encodeURIComponent(DS_WORK_ITEMS)}` && options.method === 'GET') return schemas[DS_WORK_ITEMS];
      if (pathname === `/v1/data_sources/${encodeURIComponent(DS_SPACES)}/query` && options.method === 'POST') {
        return { results: spaces, has_more: false };
      }
      if (pathname === `/v1/data_sources/${encodeURIComponent(DS_WORK_ITEMS)}/query` && options.method === 'POST') {
        return { results: [], has_more: false };
      }
      if (pathname === `/v1/data_sources/${encodeURIComponent(DS_WORK_ITEMS)}` && options.method === 'PATCH') return { ok: true };
      if (pathname === '/v1/pages' && options.method === 'POST') {
        created += 1;
        return { id: `created-${created}`, url: `https://notion.so/created-${created}` };
      }
      throw new Error(`Unexpected Notion call: ${options.method} ${pathname}`);
    },
  };
  clearTradeCache(deps.tenantKey);
  return { deps, calls };
}

function responseCapture() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body = '') { this.body = String(body); },
  };
}

{
  const existingSpace = {
    id: SPACE,
    properties: {
      '名稱': { title: rt('3F-301浴室') },
      '區/棟': { rich_text: rt('3F') },
      '類型': { select: { name: '客房' } },
    },
  };
  const { deps } = makeHarness({ spaces: [existingSpace] });
  const options = await dashboardSetupOptions(deps, new Set(['HZ']), PROJECT);
  assert.equal(options.spaces[0].name, '3F-301浴室');
  assert.ok(options.trades.includes('拆除'));
}

{
  const { deps, calls } = makeHarness();
  const created = await createDashboardSpace(deps, new Set(['HZ']), {
    project: PROJECT,
    name: '3F-301浴室',
    zone: '3F',
    type: '客房',
    alias: '301房,三樓A房',
  });
  assert.equal(created.name, '3F-301浴室');
  const write = calls.find((call) => call.pathname === '/v1/pages' && call.options.method === 'POST');
  assert.deepEqual(write.options.body.properties['專案'].relation, [{ id: PROJECT }]);
  assert.equal(write.options.body.properties['類型'].select.name, '客房');
  assert.match(write.options.body.children[0].paragraph.rich_text[0].text.content, /Seven/);
}

{
  const { deps, calls } = makeHarness();
  const created = await createDashboardTrade(deps, { name: '空調' });
  assert.equal(created.existed, false);
  const patch = calls.find((call) => call.pathname.includes(DS_WORK_ITEMS) && call.options.method === 'PATCH');
  assert.deepEqual(patch.options.body.properties['工種'].select.options, [
    { name: '拆除', color: 'red' },
    { name: '空調' },
  ]);
}

{
  const { deps, calls } = makeHarness();
  const created = await createDashboardWorkItem(deps, new Set(['HZ']), {
    project: PROJECT,
    space: SPACE,
    name: '301浴室水電配管',
    trade: '水電',
    status: '未開始',
    plannedStart: '2026-08-20',
    plannedEnd: '2026-08-24',
    contractor: '王師傅',
  });
  assert.equal(created.start, '2026-08-20');
  const write = calls.find((call) => call.pathname === '/v1/pages' && call.options.method === 'POST');
  assert.deepEqual(write.options.body.properties['空間'].relation, [{ id: SPACE }]);
  assert.equal(write.options.body.properties['預計完成'].date.start, '2026-08-24');
  assert.equal(write.options.body.properties['負責工班'].rich_text[0].text.content, '王師傅');
}

{
  const { deps } = makeHarness({ spaceProject: OTHER_PROJECT });
  await assert.rejects(() => createDashboardWorkItem(deps, new Set(['HZ']), {
    project: PROJECT,
    space: SPACE,
    name: '錯誤跨案工項',
    trade: '水電',
    plannedStart: '2026-08-20',
    plannedEnd: '2026-08-24',
  }), /所選空間不屬於目前案件/);
}

{
  const { deps } = makeHarness();
  const payload = JSON.stringify({
    project: PROJECT,
    space: SPACE,
    name: '儀表板路由工項',
    trade: '木作',
    plannedStart: '2026-08-25',
    plannedEnd: '2026-08-28',
  });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = 'POST';
  const res = responseCapture();
  await handleDashboardRequest(
    req,
    res,
    '/dashboard/api/work-items',
    new URL('https://am.example/dashboard/api/work-items?tenant=engineering&scope=HZ'),
    deps,
  );
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(res.body).name, '儀表板路由工項');
}

{
  const { deps } = makeHarness();
  const payload = JSON.stringify({ project: PROJECT, name: '4F-401' });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = 'POST';
  const res = responseCapture();
  await handleDashboardRequest(
    req,
    res,
    '/dashboard/api/spaces',
    new URL('https://am.example/dashboard/api/spaces?tenant=engineering&scope=ZS'),
    deps,
  );
  assert.equal(res.status, 403);
  assert.match(JSON.parse(res.body).error, /管理權限/);
}

console.log(JSON.stringify({ ok: true, checks: 7, writes: ['space', 'trade', 'workItem'], isolation: true }));

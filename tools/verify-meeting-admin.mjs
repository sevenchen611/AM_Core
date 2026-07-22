// 會議功能管理臺回歸：不打網路、不讀 .env、不接觸正式租戶資料。
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  createMeetingAdmin,
  MEETING_ADMIN_PROPERTIES,
  MEETING_ADMIN_SCHEMA_VERSION,
} from '../modules/meetings/admin.js';
import { MEETING_ROLLOUT_MODES } from '../modules/meetings/policy.js';
import meetings, { __test as meetingReviewTest } from '../modules/meetings/index.js';

const DATA_SOURCE_ID = 'tenant-groups';

function tenant(overrides = {}) {
  return {
    key: 'engineering',
    displayName: '工程 AM',
    runtimeEnabled: true,
    modules: ['meetings'],
    notionConfigured: true,
    driveConfigured: true,
    dataSources: {
      groupBindings: DATA_SOURCE_ID,
      meetings: 'tenant-meetings',
      tasks: 'tenant-tasks',
    },
    config: { meetings: { formalTasksEnabled: true, liffId: '1234567890-test-liff' } },
    ...overrides,
  };
}

function propertySchema({ missing = [] } = {}) {
  const properties = {
    '群組名稱': { type: 'title', title: {} },
    'LINE 群組 ID': { type: 'rich_text', rich_text: {} },
    '狀態': { type: 'select', select: { options: [{ name: '啟用' }, { name: '影子記錄' }, { name: '停用' }] } },
    '群組角色': { type: 'select', select: { options: [{ name: '內部' }] } },
    '啟用功能': { type: 'multi_select', multi_select: { options: [{ name: '會議' }, { name: '待辦' }] } },
    '成員對照': { type: 'rich_text', rich_text: {} },
    '最後設定時間': { type: 'date', date: {} },
    '最後設定者': { type: 'rich_text', rich_text: {} },
    ...Object.fromEntries(Object.entries(MEETING_ADMIN_PROPERTIES).map(([name, definition]) => {
      const type = Object.keys(definition)[0];
      return [name, { type, ...definition }];
    })),
  };
  for (const field of missing) delete properties[field];
  return { id: DATA_SOURCE_ID, properties };
}

const title = (value) => ({ title: [{ plain_text: value }] });
const rich = (value) => ({ rich_text: value ? [{ plain_text: value }] : [] });
const select = (value) => ({ select: value ? { name: value } : null });
const multi = (...values) => ({ multi_select: values.map((name) => ({ name })) });

function bindingPage({
  id = 'binding-1',
  name = '測試群組一',
  groupId = 'C_SERVER_GROUP_1',
  status = '啟用',
  capabilities = ['會議', '待辦'],
  mode = '',
  members = { '測試管理者': 'U_SECRET_MEMBER_1' },
} = {}) {
  return {
    id,
    properties: {
      '群組名稱': title(name),
      'LINE 群組 ID': rich(groupId),
      '狀態': select(status),
      '群組角色': select('內部'),
      '啟用功能': multi(...capabilities),
      '成員對照': rich(JSON.stringify(members)),
      '會議待辦模式': select(mode),
      '會議導入檢查': select('Ready'),
      '會議檢查說明': rich(''),
      '會議設定版本': rich(''),
      '會議最後檢查時間': { date: null },
    },
  };
}

function access({ tenantAll = true, visibleIds = null, platformOwner = false } = {}) {
  return {
    allowed: true,
    actor: 'Portal 測試總管',
    isTenantAll: tenantAll,
    isPlatformOwner: platformOwner,
    filterBindings: (rows) => visibleIds ? rows.filter((row) => visibleIds.includes(row.id)) : rows,
    assert: (_action, pageId) => {
      if (visibleIds && !visibleIds.includes(pageId)) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
    },
  };
}

function response() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value = '') { this.body += value; },
  };
}

function request(method, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = '/';
  req.headers = {};
  return req;
}

function makeHarness({ schema = propertySchema(), pages = [bindingPage()], accessContext = access() } = {}) {
  const calls = [];
  const invalidated = [];
  const currentTenant = tenant();
  const platform = {
    publicBaseUrl: 'https://safe.example.test',
    publicLinkSecret: 'DO_NOT_RENDER_PUBLIC_LINK_SECRET',
    driveConfigured: true,
    pushLineMessage: async () => ({}),
    aiForTenant: () => ({ assemblyKey: 'configured-not-returned' }),
    llmForTenant: () => ({ available: true }),
    router: { invalidate: (groupId) => invalidated.push(groupId) },
    logger: { warn: () => {} },
    notionRequest: async (pathname, opts = {}) => {
      calls.push({ pathname, opts });
      if (pathname === `/v1/data_sources/${DATA_SOURCE_ID}` && opts.method === 'GET') return schema;
      if (pathname === `/v1/data_sources/${DATA_SOURCE_ID}/query` && opts.method === 'POST') {
        return { results: pages, has_more: false };
      }
      if (pathname === `/v1/data_sources/${DATA_SOURCE_ID}` && opts.method === 'PATCH') return { id: DATA_SOURCE_ID };
      if (pathname.startsWith('/v1/pages/') && opts.method === 'PATCH') return { id: pathname.slice('/v1/pages/'.length) };
      throw new Error(`Unexpected ${opts.method || 'GET'} ${pathname}`);
    },
  };
  const admin = createMeetingAdmin(platform);
  const run = async (pathname, method = 'GET', body = '', extra = {}) => {
    const res = response();
    await admin(request(method, body), res, {
      pathname,
      tenant: currentTenant,
      tenants: [currentTenant, tenant({ key: 'forest', displayName: 'Forest AM' })],
      access: accessContext,
      ...extra,
    });
    return res;
  };
  return { currentTenant, platform, calls, invalidated, run };
}

function parsed(res) {
  assert.match(String(res.headers['content-type'] || res.headers['Content-Type'] || ''), /application\/json/);
  return JSON.parse(res.body || '{}');
}

function installLineFetch({ userId = 'U_REVIEW_HOST', displayName = 'Review Host', clientId = '1234567890', expiresIn = 1800 } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.line.me/oauth2/v2.1/verify')) {
      return { ok: true, json: async () => ({ client_id: clientId, expires_in: expiresIn }) };
    }
    if (String(url) === 'https://api.line.me/v2/profile') {
      return { ok: true, json: async () => ({ userId, displayName }) };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function reviewSession({
  meetingId = 'c'.repeat(20),
  tenantKey = 'review-test',
  groupId = 'C_REVIEW_GROUP',
  hostUserId = 'U_REVIEW_HOST',
  status = 'awaiting_host_choice',
  version = 1,
} = {}) {
  const session = meetingReviewTest.createReviewSession({
    tenant: tenant({ key: tenantKey, config: { meetings: { formalTasksEnabled: true, liffId: '1234567890-test-liff' } } }),
    binding: { id: `binding-${tenantKey}`, members: { 'Review Host': 'U_REVIEW_HOST' } },
    groupId,
    hostName: 'Review Host',
    hostUserId,
    meetingId,
    meetingUrl: 'https://safe.example.test/meeting',
    publicUrl: 'https://safe.example.test/m/meeting',
    todos: [{ id: 'todo-1', content: '完成測試', owner: 'Review Host', due: '2026-07-31', version }],
  });
  session.status = status;
  const html = meetingReviewTest.renderReviewHtml(session);
  const path = html.match(/"apiPath":"([^"]+)"/)?.[1] || '';
  assert.match(path, /^\/meetings\/review\/[a-f0-9]{20}-[a-f0-9]{16}$/);
  return { session, path };
}

async function postReview(path, body, sessionTenant) {
  const route = meetings.routes.find((item) => item.prefix === '/meetings/review');
  const res = response();
  await route.handler(request('POST', JSON.stringify(body)), res, {
    pathname: path,
    url: new URL(`https://safe.example.test${path}`),
    tenant: sessionTenant,
    tenants: [sessionTenant],
  });
  return res;
}

// 管理頁只提供操作程式與非敏感租戶標籤，不得把 LINE 身分、資料源或密鑰塞進 HTML。
{
  const h = makeHarness({ accessContext: access({ platformOwner: true }) });
  const res = await h.run('/meetings/manage');
  assert.equal(res.status, 200);
  assert.match(res.body, /會議功能管理臺/);
  assert.match(res.body, /關閉/);
  assert.match(res.body, /僅記錄/);
  assert.match(res.body, /確認試行/);
  assert.match(res.body, /完整確認/);
  for (const secret of [
    'DO_NOT_RENDER_PUBLIC_LINK_SECRET',
    'configured-not-returned',
    'U_SECRET_MEMBER_1',
    'C_SERVER_GROUP_1',
    DATA_SOURCE_ID,
  ]) assert.ok(!res.body.includes(secret), `HTML 不可包含 ${secret}`);
  assert.match(res.body, /Forest AM/);
}

// 非平台 owner 即使具備租戶全群組權限，也不能開啟這個 rollout 管理臺。
{
  const h = makeHarness({ accessContext: access({ tenantAll: true }) });
  const res = await h.run('/meetings/manage');
  assert.equal(res.status, 403);
  assert.match(res.body, /需要平台最高管理者權限/);
  assert.equal(h.calls.length, 0);
}

// 未登入者只能取得友善 Portal 登入頁，不能先讀任何 Notion 管理資料。
{
  const h = makeHarness({ accessContext: null });
  const res = await h.run('/meetings/manage');
  assert.equal(res.status, 401);
  assert.match(String(res.headers['content-type'] || ''), /text\/html/);
  assert.match(res.body, /請先從 HOZO Portal 登入/);
  assert.match(res.body, /https:\/\/rental\.hozorental\.com\/portal/);
  assert.equal(h.calls.length, 0);
}

// 單群帳號不可讀全租戶管理頁、群組清單或執行預檢。
{
  const h = makeHarness({ accessContext: access({ tenantAll: false, visibleIds: ['binding-1'] }) });
  const page = await h.run('/meetings/manage');
  assert.equal(page.status, 403);
  assert.match(String(page.headers['content-type'] || ''), /text\/html/);
  assert.match(page.body, /需要平台最高管理者權限/);
  for (const [pathname, method, body] of [
    ['/meetings/manage/api/list', 'GET', ''],
    ['/meetings/manage/api/preflight', 'POST', JSON.stringify({ updates: [{ pageId: 'binding-1', mode: MEETING_ROLLOUT_MODES.RECORD_ONLY }] })],
  ]) {
    const res = await h.run(pathname, method, body);
    assert.equal(res.status, 403);
    assert.match(parsed(res).error, /平台最高管理者/);
  }
  assert.equal(h.calls.length, 0, '被拒絕的管理請求不可讀取 Notion');
}

// 路由本身必須宣告為 tenant-wide console，且 denied GET 交給友善登入頁處理。
{
  const route = meetings.routes.find((item) => item.prefix === '/meetings/manage');
  assert.deepEqual(route?.access, { kind: 'tenant', capability: 'groups.core', denied: 'handler' });
}

// 租戶範圍帳號不可套用；瀏覽器偽造 payload 不能提升權限。
{
  const h = makeHarness({ accessContext: access({ tenantAll: false }) });
  const res = await h.run('/meetings/manage/api/apply', 'POST', JSON.stringify({
    mode: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE,
    pageIds: ['binding-1'],
  }));
  assert.equal(res.status, 403);
  assert.match(parsed(res).error, /只有平台最高管理者/);
  assert.equal(h.calls.some((call) => call.pathname.startsWith('/v1/pages/')), false);
  assert.deepEqual(h.invalidated, []);
}

// pageId 必須重新從目前租戶的綁定表定位，不能拿另一租戶的 pageId 寫入。
{
  const h = makeHarness({ accessContext: access({ platformOwner: true }) });
  const res = await h.run('/meetings/manage/api/apply', 'POST', JSON.stringify({
    updates: [{ pageId: 'foreign-binding', mode: MEETING_ROLLOUT_MODES.RECORD_ONLY }],
  }));
  assert.equal(res.status, 404);
  assert.match(parsed(res).error, /找不到可存取的群組設定/);
  assert.equal(h.calls.some((call) => call.pathname === '/v1/pages/foreign-binding'), false);
  assert.deepEqual(h.invalidated, []);
}

// Schema 未初始化時必須阻擋套用，不能用只寫存在欄位的方式造成半套設定。
{
  const h = makeHarness({ accessContext: access({ platformOwner: true }), schema: propertySchema({ missing: ['會議待辦模式'] }) });
  const res = await h.run('/meetings/manage/api/apply', 'POST', JSON.stringify({
    mode: MEETING_ROLLOUT_MODES.RECORD_ONLY,
    pageIds: ['binding-1'],
  }));
  assert.equal(res.status, 409);
  assert.match(parsed(res).error, /會議待辦模式/);
  assert.equal(h.calls.some((call) => call.pathname.startsWith('/v1/pages/')), false);
}

// 初始化 schema 只補缺欄位，並寫回目前租戶自己的 data source。
{
  const h = makeHarness({ accessContext: access({ platformOwner: true }), schema: propertySchema({ missing: ['啟用功能', '會議待辦模式', '會議導入檢查'] }) });
  const res = await h.run('/meetings/manage/api/schema', 'POST', '{}');
  assert.equal(res.status, 200);
  const body = parsed(res);
  assert.equal(body.changed, true);
  assert.deepEqual(new Set(body.fields), new Set(['啟用功能', '會議待辦模式', '會議導入檢查']));
  const patch = h.calls.find((call) => call.pathname === `/v1/data_sources/${DATA_SOURCE_ID}` && call.opts.method === 'PATCH');
  assert.ok(patch, 'schema 初始化應送出 PATCH');
  assert.equal(patch.opts.tenantKey, 'engineering');
}

// 批次更新必須逐群成功寫入、保留稽核版本，並用伺服器查出的 groupId 清除路由快取。
{
  const pages = [
    bindingPage({ id: 'binding-1', name: '群組一', groupId: 'C_SERVER_GROUP_1' }),
    bindingPage({ id: 'binding-2', name: '群組二', groupId: 'C_SERVER_GROUP_2' }),
  ];
  const h = makeHarness({ accessContext: access({ platformOwner: true }), pages });
  const res = await h.run('/meetings/manage/api/apply', 'POST', JSON.stringify({
    updates: [
      { pageId: 'binding-1', groupId: 'C_BROWSER_FORGED', mode: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE },
      { pageId: 'binding-2', groupId: 'C_BROWSER_FORGED', mode: MEETING_ROLLOUT_MODES.RECORD_ONLY },
    ],
  }));
  assert.equal(res.status, 200, res.body);
  assert.equal(parsed(res).updated, 2);
  const writes = h.calls.filter((call) => call.pathname.startsWith('/v1/pages/') && call.opts.method === 'PATCH');
  assert.equal(writes.length, 2);
  assert.ok(h.calls.every((call) => call.opts.tenantKey === 'engineering'), '每次 Notion 操作都必須帶 tenantKey');
  assert.equal(writes[0].opts.body.properties['會議待辦模式'].select.name, '完整確認');
  assert.equal(writes[1].opts.body.properties['會議待辦模式'].select.name, '僅記錄');
  assert.equal(writes[0].opts.body.properties['會議設定版本'].rich_text[0].text.content, MEETING_ADMIN_SCHEMA_VERSION);
  assert.deepEqual(h.invalidated, ['C_SERVER_GROUP_1', 'C_SERVER_GROUP_2']);
  assert.ok(!h.invalidated.includes('C_BROWSER_FORGED'));
}

// 任一群組被 preflight 阻擋時，整批不可先寫入前面的成功項目。
{
  const pages = [
    bindingPage({ id: 'binding-1', groupId: 'C_SERVER_GROUP_1' }),
    bindingPage({ id: 'binding-shadow', groupId: 'C_SERVER_SHADOW', status: '影子記錄' }),
  ];
  const h = makeHarness({ accessContext: access({ platformOwner: true }), pages });
  const res = await h.run('/meetings/manage/api/apply', 'POST', JSON.stringify({
    mode: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE,
    pageIds: ['binding-1', 'binding-shadow'],
  }));
  assert.equal(res.status, 409);
  assert.match(parsed(res).error, /未通過導入檢查/);
  assert.equal(h.calls.some((call) => call.pathname.startsWith('/v1/pages/')), false, '被阻擋的批次不可部分寫入');
  assert.deepEqual(h.invalidated, []);
}

// LINE access token 必須先驗 client_id / expiry，再以 Bearer token 取得 profile。
{
  const line = installLineFetch();
  try {
    const profile = await meetingReviewTest.lineProfileFromAccessToken('line-access-token', { expectedClientId: '1234567890' });
    assert.deepEqual(profile, { userId: 'U_REVIEW_HOST', displayName: 'Review Host', clientId: '1234567890' });
    assert.match(line.calls[0].url, /^https:\/\/api\.line\.me\/oauth2\/v2\.1\/verify\?access_token=/);
    assert.equal(line.calls[1].url, 'https://api.line.me/v2/profile');
    assert.equal(line.calls[1].options.headers.Authorization, 'Bearer line-access-token');
  } finally { line.restore(); }

  const wrongChannel = installLineFetch({ clientId: '9999999999' });
  try {
    await assert.rejects(
      () => meetingReviewTest.lineProfileFromAccessToken('wrong-channel-token', { expectedClientId: '1234567890' }),
      (error) => error?.statusCode === 401 && /頻道不符合/.test(error.message),
    );
    assert.equal(wrongChannel.calls.length, 1, 'client_id 不符時不可繼續讀 profile');
  } finally { wrongChannel.restore(); }

  const expired = installLineFetch({ expiresIn: 0 });
  try {
    await assert.rejects(
      () => meetingReviewTest.lineProfileFromAccessToken('expired-token', { expectedClientId: '1234567890' }),
      (error) => error?.statusCode === 401 && /逾期/.test(error.message),
    );
    assert.equal(expired.calls.length, 1, '過期 token 不可繼續讀 profile');
  } finally { expired.restore(); }
}

// Review HTML 在 LINE 驗證前不可洩露候選待辦、群組成員 ID 或 member map。
{
  meetings.init({ publicLinkSecret: 'review-signed-secret', publicBaseUrl: 'https://safe.example.test' });
  const { session } = reviewSession({ meetingId: 'd'.repeat(20), tenantKey: 'protected-html' });
  const html = meetingReviewTest.renderReviewHtml(session);
  assert.ok(!html.includes('完成測試'));
  assert.ok(!html.includes('U_REVIEW_HOST'));
  assert.match(html, /"members":\[\]/);
  assert.match(html, /"todos":\[\]/);
}

// Review mutation 只信任 access token 解出的群組成員；actorUserId/actorName payload 不具授權力。
{
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => ['U_REVIEW_HOST'],
    notionRequest: async () => ({}),
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({ meetingId: 'e'.repeat(20), tenantKey: 'forged-actor', groupId: 'C_FORGED_ACTOR' });
  const res = await postReview(path, {
    action: 'start',
    actorUserId: 'U_REVIEW_HOST',
    actorName: 'Review Host',
  }, session.tenant);
  assert.equal(res.status, 401);
  assert.match(parsed(res).error, /LINE 登入/);
  assert.equal(session.status, 'awaiting_host_choice');
}

// 有效 token 仍必須是該 LINE 群的現役成員；非主持人且不在群組成員清單時拒絕。
{
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => ['U_ANOTHER_MEMBER'],
    notionRequest: async () => ({}),
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({ meetingId: 'f'.repeat(20), tenantKey: 'non-member', groupId: 'C_NON_MEMBER' });
  const line = installLineFetch({ userId: 'U_NOT_IN_GROUP', displayName: 'Other User' });
  try {
    const res = await postReview(path, { action: 'start', liffAccessToken: 'valid-but-not-member' }, session.tenant);
    assert.equal(res.status, 403);
    assert.match(parsed(res).error, /只有這個 LINE 群組的成員/);
    assert.equal(session.status, 'awaiting_host_choice');
  } finally { line.restore(); }
}

// 若 LINE Login channel 與 Messaging API userId 對不起來，但 LIFF 顯示名稱完全等於錄音上傳者，
// 允許本次主持人補綁 LIFF userId，避免帳號不支援 members/ids API 時主持人被卡住。
{
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => {
      const error = new Error('LINE API failed: 403 {"message":"Access to this API is not available for your account"}');
      error.lineStatus = 403;
      error.lineBody = '{"message":"Access to this API is not available for your account"}';
      throw error;
    },
    notionRequest: async () => ({}),
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({ meetingId: 'b2'.repeat(10), tenantKey: 'host-name-fallback', groupId: 'C_HOST_FALLBACK' });
  const line = installLineFetch({ userId: 'U_LIFF_REVIEW_HOST', displayName: 'Review Host' });
  try {
    const res = await postReview(path, { action: 'start', liffAccessToken: 'valid-host-token' }, session.tenant);
    assert.equal(res.status, 200);
    assert.equal(session.hostUserId, 'U_LIFF_REVIEW_HOST');
    assert.equal(session.status, 'reviewing');
  } finally { line.restore(); }
}

// 缺少錄音上傳者 LINE user id 時，主持人操作必須 fail closed，不能只比對顯示名稱。
{
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => ['U_REVIEW_HOST'],
    notionRequest: async () => ({}),
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({ meetingId: 'a1'.repeat(10), tenantKey: 'missing-host', groupId: 'C_MISSING_HOST', hostUserId: '' });
  const line = installLineFetch();
  try {
    const res = await postReview(path, { action: 'start', liffAccessToken: 'valid-host-token' }, session.tenant);
    assert.equal(res.status, 409);
    assert.match(parsed(res).error, /缺少上傳者身分/);
    assert.equal(session.status, 'awaiting_host_choice');
  } finally { line.restore(); }
}

// 多人同時編輯時，舊 expectedVersion 不得覆蓋較新的 todo。
{
  let notionWrites = 0;
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => ['U_REVIEW_HOST'],
    notionRequest: async () => { notionWrites += 1; return {}; },
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({
    meetingId: 'b1'.repeat(10), tenantKey: 'stale-version', groupId: 'C_STALE_VERSION', status: 'reviewing', version: 2,
  });
  const line = installLineFetch();
  try {
    const res = await postReview(path, {
      action: 'save-todo', liffAccessToken: 'valid-host-token', todoId: 'todo-1', expectedVersion: 1,
      content: '嘗試用舊畫面覆蓋', owner: 'Review Host', due: '2026-08-01',
    }, session.tenant);
    assert.equal(res.status, 409);
    assert.match(parsed(res).error, /版本|重新整理/);
    assert.equal(session.todos[0].content, '完成測試');
    assert.equal(session.todos[0].version, 2);
    assert.equal(notionWrites, 0, 'stale mutation 不可落地任何 Notion 寫入');
  } finally { line.restore(); }
}

// 負責人不在已同步的 LINE member map 時，失敗請求不可污染 session。
{
  meetings.init({
    publicLinkSecret: 'review-signed-secret',
    publicBaseUrl: 'https://safe.example.test',
    listGroupMemberIds: async () => ['U_REVIEW_HOST'],
    notionRequest: async () => ({}),
    pushLineMessage: async () => ({}),
  });
  const { session, path } = reviewSession({
    meetingId: 'c1'.repeat(10), tenantKey: 'unknown-owner', groupId: 'C_UNKNOWN_OWNER', status: 'reviewing', version: 1,
  });
  const line = installLineFetch();
  try {
    const res = await postReview(path, {
      action: 'save-todo', liffAccessToken: 'valid-host-token', todoId: 'todo-1', expectedVersion: 1,
      content: '不應寫入的新內容', owner: '未同步的人', due: '2026-08-02',
    }, session.tenant);
    assert.equal(res.status, 409);
    assert.match(parsed(res).error, /已同步的 LINE 群組成員/);
    assert.equal(session.todos[0].content, '完成測試');
    assert.equal(session.todos[0].owner, 'Review Host');
    assert.equal(session.todos[0].version, 1);
  } finally { line.restore(); }
}

// 執行期模式必須真的約束正式待辦寫入：試行不寫、完整確認才寫、逾時一律不寫。
{
  const taskWrites = [];
  meetings.init({
    notionRequest: async (pathname, opts = {}) => {
      if (pathname === '/v1/pages' && opts.method === 'POST') {
        taskWrites.push(opts.body);
        return { id: `task-${taskWrites.length}` };
      }
      return {};
    },
    pushLineMessage: async () => ({}),
  });
  const base = {
    binding: { pageId: 'binding-runtime', members: { 'Review Host': 'U_REVIEW_HOST' } },
    groupId: 'C_RUNTIME_MODE', hostName: 'Review Host', hostUserId: 'U_REVIEW_HOST',
    meetingId: '', perGroup: true,
    todos: [{ content: '完成正式確認測試', owner: 'Review Host', due: '2026-08-03', ownerConfirmed: true }],
  };

  const pilot = meetingReviewTest.createReviewSession({
    ...base,
    tenant: tenant({ key: 'runtime-pilot', config: { meetings: { formalTasksEnabled: false } } }),
    meetingMode: MEETING_ROLLOUT_MODES.REVIEW_ONLY,
  });
  await meetingReviewTest.finishReviewSession(pilot, 'Review Host');
  assert.equal(pilot.status, 'reviewed_candidates');
  assert.equal(taskWrites.length, 0, 'review_only 不可建立正式待辦');

  const full = meetingReviewTest.createReviewSession({
    ...base,
    tenant: tenant({ key: 'runtime-full', config: { meetings: { formalTasksEnabled: true } } }),
    meetingMode: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE,
  });
  await meetingReviewTest.finishReviewSession(full, 'Review Host');
  assert.equal(full.status, 'finalized');
  assert.equal(taskWrites.length, 1, 'review_and_create 完成雙重確認後應建立一筆正式待辦');
  assert.equal(full.taskPageIds.length, 1);

  const timedOut = meetingReviewTest.createReviewSession({
    ...base,
    tenant: tenant({ key: 'runtime-timeout', config: { meetings: { formalTasksEnabled: true } } }),
    meetingMode: MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE,
  });
  await meetingReviewTest.autoCompleteReviewSession(timedOut.id);
  assert.equal(timedOut.status, 'candidates_retained');
  assert.equal(taskWrites.length, 1, '24 小時無共識時不可自動建立正式待辦');
}

console.log('Meeting admin verification passed: authorization, tenant isolation, schema guard, atomic batch updates, router invalidation, and secret-free HTML are safe.');

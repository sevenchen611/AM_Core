import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDirectoryStore } from '../core/line-io/directory-store.js';
import { createDirectory } from '../core/line-io/directory.js';
import { createLineIo, loadLineIoClients, acceptLineWebhook } from '../core/line-io/index.js';
import { createRouter } from '../core/router.js';

const a = `C${'a'.repeat(32)}`, b = `C${'b'.repeat(32)}`;
const u = `U${'a'.repeat(32)}`, v = `U${'b'.repeat(32)}`, w = `U${'c'.repeat(32)}`;
const url = (query = '') => new URL(`https://example.test/api/v1/line/directory/groups${query}`);
const client = { tenantKey:'a',groupIds:[a],scopes:['directory:read'] };
const admin = { ...client,groupIds:[],directoryAllGroups:true };

async function harness(t, options = {}) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../versions/AM-IMP-2026.0929.03/schemas/line-directory.sql',import.meta.url),'utf8'));
  const query = (...args) => db.query(...args);
  const store = createDirectoryStore({ query,connect:async () => ({ query,release() {} }) });
  t.after(() => db.close());
  const router = { invalidate() {},resolveGroupBinding:async (id) => ({ tenant:{ key:id === a ? 'a' : 'b' },binding:{ status:'啟用' } }),
    listDirectoryBindings:async () => ({ complete:true,groups:[{ groupId:a,name:'A',members:{ Alice:u,Bob:v } },{ groupId:b,name:'B',members:{ Carol:w } }] }) };
  const line = { configured:true,
    listGroupMemberIds:options.enumerate || (async () => { throw Object.assign(new Error('private provider error'),{ lineStatus:403 }); }),
    lineGet:options.get || (async (path) => {
      if (path.endsWith('/summary')) return { groupName:path.includes(a) ? 'A verified' : 'B verified' };
      if (path.endsWith('/count')) return { count:3 };
      if (path.endsWith(v)) throw Object.assign(new Error('hidden profile'),{ lineStatus:404 });
      return { displayName:'Known member' };
    }),isValidSignature:() => true };
  const directory = createDirectory({ store,router,line,clients:[client],ioState:async () => ({ inputEnabled:false,outputEnabled:false,canSend:false }),now:() => 1000000 });
  return { db,store,router,line,directory };
}

test('directory SQL persists unbound discovery, rejects stale redelivery and stores no message contents',async (t) => {
  const { directory,store,db } = await harness(t);
  const e = (timestamp,type,extras = {}) => ({ timestamp,type,source:{ type:'group',groupId:b,userId:w },message:{ text:'DO NOT STORE',replyToken:'secret' },...extras });
  await directory.capture([e(100,'message'),e(200,'memberLeft',{ left:{ members:[{ userId:w }] } }),e(50,'message')]);
  assert.equal((await store.members({ groupId:b,limit:50 })).rows[0].membership,'left');
  assert.equal((await store.members({ groupId:b,limit:50 })).rows[0].lastSeenAt,'100');
  await directory.capture([e(300,'leave'),e(250,'message')]);
  assert.equal((await store.groups({ limit:50 })).rows[0].presence,'left');
  await directory.capture([e(400,'join')]);
  assert.equal((await store.groups({ limit:50 })).rows[0].presence,'present');
  assert.equal(JSON.stringify((await db.query('SELECT * FROM line_directory.members')).rows).includes('DO NOT STORE'),false);
  await assert.rejects(store.observe([{ groupId:'bad',presence:'present',at:500,members:[] }]));
});

test('group selection enforces ordinary client scope, operator is read only, and coverage is never falsely all groups',async (t) => {
  const { directory,router } = await harness(t);
  const scoped = await directory.groups(client,url());
  assert.deepEqual(scoped.groups.map((g) => g.groupId),[a]);
  assert.equal(scoped.coverage.complete,false);
  assert.equal(scoped.groups[0].name,'A verified');
  const page = await directory.groups(admin,url('?limit=1'));
  assert.equal(page.hasMore,true);
  assert.deepEqual((await directory.groups(admin,url(`?after=${page.nextCursor}`))).groups.map((g) => g.groupId),[b]);
  await assert.rejects(directory.members(client,b,url()),{ code:'group_denied' });
  router.resolveGroupBinding = async () => ({ tenant:{ key:'b' },binding:{} });
  assert.equal((await directory.groups(client,url())).groups.length,0);
  const base = { id:'catalog',tenantKey:'a',tokenEnv:'TOKEN',groupIds:[],scopes:['directory:read'],directoryAllGroups:true };
  assert.equal(loadLineIoClients({ TOKEN:'x'.repeat(32),AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([base]) },[{ key:'a' }]).length,1);
  for (const changes of [{ scopes:['directory:read','messages:write'] },{ groupIds:[a] },{ transportOnly:true }]) {
    assert.throws(() => loadLineIoClients({ TOKEN:'x'.repeat(32),AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([{ ...base,...changes }]) },[{ key:'a' }]));
  }
});

test('403 enumeration falls back to verified known users; profiles and group failures never become active',async (t) => {
  const { directory } = await harness(t);
  const result = await directory.members(admin,a,url());
  assert.deepEqual(result.activeUserIds,[u]);
  assert.equal(result.coverage.complete,false);
  assert.equal(result.coverage.reason,'oa_member_enumeration_forbidden');
  assert.equal(result.users.find((x) => x.userId === v).membership,'unknown');
  assert.equal(JSON.stringify(result).includes('hidden profile'),false);
  await assert.rejects(directory.groups(admin,url('?limit=51')),{ code:'invalid_pagination' });
  const h = await harness(t,{ get:async () => { throw new Error('network timeout'); } });
  assert.equal((await h.directory.groups(admin,url())).groups[0].selectable,false);
  await assert.rejects(h.directory.members(admin,a,url()),{ code:'group_verification_unavailable' });
});

test('successful enumeration discovers silent members, removes stale users and supports member pagination',async (t) => {
  const { directory,store } = await harness(t,{ enumerate:async () => [u,w] });
  const first = await directory.members(admin,a,url('?limit=1'));
  assert.equal(first.coverage.complete,true);
  assert.equal(first.hasMore,true);
  const rest = await directory.members(admin,a,url(`?after=${first.nextCursor}&limit=50`));
  assert.deepEqual(rest.activeUserIds,[w]);
  assert.equal(rest.users.find((x) => x.userId === v).membership,'left');
  await directory.capture([{ type:'memberLeft',timestamp:999000,source:{ type:'group',groupId:a },left:{ members:[{ userId:u }] } }]);
  assert.equal((await store.members({ groupId:a,limit:50 })).rows[0].membership,'left');
});

test('catalog capture must persist before webhook acknowledgement, including groups outside IO subscriptions',async (t) => {
  const h = await harness(t);
  const config = [{ id:'catalog',tenantKey:'a',tokenEnv:'TOKEN',groupIds:[],scopes:['directory:read'],directoryAllGroups:true }];
  const gateway = await createLineIo({ env:{ AMCORE_LINE_IO_ENABLED:'1',AMCORE_LINE_DIRECTORY_ENABLED:'1',TOKEN:'x'.repeat(32),AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify(config) },
    tenants:[{ key:'a' }],router:h.router,line:h.line,store:{ append:async () => {} },directoryStore:h.store });
  const args = { rawBody:JSON.stringify({ events:[{ type:'message',timestamp:999000,source:{ type:'group',groupId:b,userId:w },message:{ text:'private' } }] }),line:h.line,lineIo:gateway };
  const request = async (path,method = 'GET',token = 'x'.repeat(32)) => {
    let status,body;
    const res = { setHeader() {},writeHead:(value) => { status = value; },end:(value) => { body = JSON.parse(value); } };
    await gateway.handle({ method,headers:{ authorization:`Bearer ${token}` } },res,new URL(`https://example.test/api/v1/line${path}`));
    return { status,body };
  };
  assert.equal((await request('/directory/groups','GET','wrong')).status,401);
  assert.equal((await request('/messages','POST')).status,403);
  assert.equal((await request('/events')).status,403);
  assert.equal((await request('/directory/groups')).body.groups.length,2);
  assert.deepEqual((await request(`/directory/groups/${a}/members`)).body.activeUserIds,[u]);
  await acceptLineWebhook(args);
  assert.equal(await h.store.group(b),true);
  const observe = h.store.observe;
  h.store.observe = async () => { throw new Error('storage down'); };
  await assert.rejects(acceptLineWebhook(args),{ status:503 });
  h.store.observe = observe;
});

test('binding discovery follows Notion pagination through tenant guards and reports partial scans',async () => {
  const calls = [];
  const page = (groupId) => ({ properties:{ 'LINE 群組 ID':{ rich_text:[{ plain_text:groupId }] },'群組名稱':{ title:[{ plain_text:'test' }] },'成員對照':{ rich_text:[{ plain_text:JSON.stringify({ Alice:u }) }] } } });
  const router = createRouter({ tenants:[{ key:'a',notionConfigured:true,dataSources:{ groupBindings:'ds-a' } },{ key:'b',notionConfigured:true,dataSources:{ groupBindings:'ds-b' } }],logger:{ warn() {} },
    notionRequest:async (path,opts) => {
      calls.push({ path,...opts });
      if (opts.tenantKey === 'b') throw new Error('tenant source unavailable');
      return opts.body.start_cursor ? { results:[page(b)],has_more:false } : { results:[page(a)],has_more:true,next_cursor:'next' };
    } });
  const result = await router.listDirectoryBindings();
  assert.equal(result.complete,false);
  assert.equal(result.groups.length,2);
  assert.equal(calls[1].body.start_cursor,'next');
  assert.equal(calls[1].tenantKey,'a');
  assert.equal(calls[2].tenantKey,'b');
});

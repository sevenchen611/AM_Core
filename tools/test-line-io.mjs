import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createLineIo, loadLineIoClients, acceptLineWebhook, readLineIoBody } from '../core/line-io/index.js';
import { createLine } from '../core/line.js';
import { ioError } from '../core/line-io/store.js';

const groupA = `C${'a'.repeat(32)}`;
const groupB = `C${'b'.repeat(32)}`;
const secret = 'synthetic-channel-secret';
const token = 'synthetic-api-key-at-least-32-characters';
const tenants = [{ key: 'sample' }, { key: 'other' }];
const config = [{ id: 'daily', tenantKey: 'sample', tokenEnv: 'TEST_TOKEN', groupIds: [groupA],
  scopes: ['groups:read', 'events:read', 'messages:write'] }];
const env = { AMCORE_LINE_IO_ENABLED: '1', TEST_TOKEN: token, AMCORE_LINE_IO_CLIENTS_JSON: JSON.stringify(config) };

function memoryStore() {
  const rows = [];
  const sends = new Map();
  const replyRows = new Map();
  return {
    rows, sends, replyRows,
    append: async (records) => {
      for (const r of records) if (!rows.some((x) => x.tenantKey === r.tenantKey && x.event.webhookEventId === r.event.webhookEventId)) {
        rows.push({ ...r, reply: undefined, cursor: String(rows.length + 1) });
        if (r.reply) replyRows.set(`${r.tenantKey}:${r.event.webhookEventId}`, {
          groupId:r.groupId,userId:r.event.source.userId,sealedToken:r.reply,status:'pending',bodyHash:null,result:null,
        });
      }
    },
    list: async ({ tenantKey, groupIds, inputUserIds, after, limit }) => {
      const selected = rows.filter((r) => r.tenantKey === tenantKey && groupIds.includes(r.groupId) && (!inputUserIds || !['message','postback'].includes(r.event.type) || inputUserIds.includes(r.event.source.userId)) && BigInt(r.cursor) > BigInt(after));
      const events = selected.slice(0, limit);
      return { events, nextCursor: events.at(-1)?.cursor || after, hasMore: selected.length > limit };
    },
    reserve: async (r) => {
      const id = [r.tenantKey, r.clientId, r.key].join(':');
      let current = sends.get(id);
      if (current && current.hash !== r.hash) throw ioError(409, 'idempotency_conflict');
      if (current?.result) return { result: current.result };
      if (current?.busy) throw ioError(409, 'send_in_progress');
      current ||= { ...r, retryKey: crypto.randomUUID(), attempt: crypto.randomUUID() };
      current.busy = true;
      sends.set(id, current);
      return current;
    },
    finish: async (r) => { const current = sends.get([r.tenantKey, r.clientId, r.key].join(':')); Object.assign(current, { busy: false, result: r.result }); },
    claimReply: async (r) => {
      const row = replyRows.get(`${r.tenantKey}:${r.eventId}`);
      if (!row || row.groupId !== r.groupId || row.userId !== r.userId) throw ioError(404,'reply_event_unavailable');
      if (row.bodyHash && row.bodyHash !== r.bodyHash) throw ioError(409,'reply_payload_changed');
      if (row.status === 'accepted') return {result:row.result};
      if (row.status !== 'pending') throw ioError(409,'reply_outcome_unknown');
      row.status='sending'; row.bodyHash=r.bodyHash;
      return {sealedToken:row.sealedToken};
    },
    finishReply: async (r) => {
      const row=replyRows.get(`${r.tenantKey}:${r.eventId}`);
      row.status=r.status; row.result=r.result; row.sealedToken=null;
    },
  };
}

async function harness(t, options = {}) {
  const store = memoryStore();
  let owner = 'sample';
  let bindingStatus = '啟用';
  let failPush = false;
  let holdPush;
  let memberFailure;
  const pushes = [];
  const replies = [];
  const memberLookups = [];
  const line = { ...createLine({ channelAccessToken: 'synthetic-token', channelSecret: secret }),
    resolveGroupMemberName: async (...args) => {
      memberLookups.push(args);
      if (memberFailure) throw memberFailure;
      return 'Synthetic member';
    },
    pushLineMessage: async (...args) => {
      pushes.push(args);
      if (holdPush) await holdPush;
      if (failPush) throw new Error('upstream secret body must not leak');
      return { requestId: 'request-test', messageIds: ['message-test'] };
    },
    replyLineMessages: async (...args) => { replies.push(args); return {ok:true}; } };
  const router = options.router || { invalidate() {}, resolveGroupBinding: async (id) => ({ tenant: { key: owner },
    binding: { pageId: 'binding-test', groupName: 'Synthetic group', projectPageId: 'goal-test', status: bindingStatus, groupId: id } }) };
  const gateway = await createLineIo({ env: options.env || env, tenants, router, line, store, logger: { warn() {} } });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/webhook/line') {
      try {
        const rawBody = await readLineIoBody(req);
        await acceptLineWebhook({ rawBody, signature: req.headers['x-line-signature'], line, lineIo: gateway });
        res.writeHead(200); res.end('OK');
      } catch (error) { res.writeHead(error.status || 503); res.end(error.code || 'unavailable'); }
    } else if (!await gateway.handle(req, res, url)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options = {}) => {
    const response = await fetch(`${base}/api/v1/line${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const send = (key, text = 'Synthetic report', groupId = groupA) => request('/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ groupId, text }),
  });
  const event = (id, extras = {}) => ({ type: 'message', webhookEventId: id, timestamp: 123,
    source: { type: 'group', groupId: groupA, userId: 'synthetic-user' },
    replyToken: 'private-reply-token', message: { id, type: 'text', text: 'Synthetic approval input', quoteToken: 'private-quote-token' }, ...extras });
  const webhook = async (events, signed = true) => {
    const body = JSON.stringify({ events });
    return fetch(`${base}/webhook/line`, { method: 'POST', body,
      headers: { 'x-line-signature': signed ? crypto.createHmac('sha256', secret).update(body).digest('base64') : 'wrong' } });
  };
  return { store, gateway, request, send, event, webhook, pushes, replies, memberLookups, base,
    setMemberFailure: (value) => { memberFailure = value; },
    setOwner: (value) => { owner = value; }, setBindingStatus: (value) => { bindingStatus = value; },
    setFailPush: (value) => { failPush = value; }, setHoldPush: (value) => { holdPush = value; } };
}

test('configuration is opt-in and requires unique scoped keys and tenant ownership', async () => {
  assert.equal((await createLineIo({ env: {} })).enabled, false);
  assert.equal(loadLineIoClients(env, tenants).length, 1);
  for (const value of [[], [null], [{ ...config[0], scopes: ['admin'] }], [{ ...config[0], groupIds: ['*'] }],
    [{ ...config[0], tenantKey: 'missing' }], [config[0], { ...config[0], id: 'second' }]]) {
    assert.throws(() => loadLineIoClients({ ...env, AMCORE_LINE_IO_CLIENTS_JSON: JSON.stringify(value) }, tenants));
  }
});

test('groups and events resolve at most four groups concurrently and preserve configured order', {timeout:5000},async t=>{
  const groupIds=Array.from({length:9},(_,i)=>`C${i.toString(16).padStart(32,'0')}`);
  let active=0,maxActive=0,revoked=false;
  const router={invalidate(){},resolveGroupBinding:async id=>{
    active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return {tenant:{key:revoked&&id===groupIds[4]?'other':'sample'},binding:{status:'啟用',groupName:id,pageId:id}};
  }};
  const h=await harness(t,{router,env:{...env,AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([{...config[0],groupIds}])}});
  const groups=await h.request('/groups');
  assert.equal(groups.status,200);
  assert.deepEqual(groups.body.groups.map(row=>row.groupId),groupIds);
  assert.equal(maxActive,4);
  maxActive=0;
  assert.equal((await h.request('/events')).status,200);
  assert.equal(maxActive,4);
  revoked=true;
  assert.equal((await h.request('/events')).status,403,'one withdrawn group fails the whole event page without advancing the cursor');
  assert.deepEqual((await h.request('/groups')).body.groups.map(row=>row.groupId),groupIds.filter((_,i)=>i!==4));
});

test('bound event replies once without a push and never exposes its token in the event feed', async (t) => {
  const userId = `U${'a'.repeat(32)}`;
  const replyEnv = { ...env, LINE_CHANNEL_SECRET:secret, AMCORE_LINE_IO_REPLY_ENABLED:'1',
    AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([{...config[0],inputUserIds:[userId],
      allowPersonalBindings:true,transportOnly:true}]) };
  const h=await harness(t,{env:replyEnv});
  assert.equal((await h.webhook([h.event('reply-1',{source:{type:'group',groupId:groupA,userId}})])).status,200);
  assert.equal(JSON.stringify((await h.request('/events')).body).includes('private-reply-token'),false);
  const payload={eventId:'reply-1',groupId:groupA,notifyUserId:userId,text:'待簽清單',
    cards:[{title:'案件一',body:'測試',actions:[{label:'查看內容',data:'uof.open.test'}]}]};
  const send=()=>h.request('/replies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal((await send()).body.method,'reply');
  assert.equal(h.replies.length,1);
  assert.equal(h.replies[0][0],'private-reply-token');
  assert.equal(h.pushes.length,0);
  assert.equal((await send()).body.replayed,true);
  assert.equal(h.replies.length,1);
  assert.equal((await h.request('/replies',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...payload,text:'different'})})).status,409);
  assert.equal((await h.request('/replies',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...payload,eventId:'missing'})})).status,404);
});

test('inline result action is one compact reply bubble with no extra button card', async (t) => {
  const userId = `U${'b'.repeat(32)}`;
  const replyEnv = { ...env, LINE_CHANNEL_SECRET:secret, AMCORE_LINE_IO_REPLY_ENABLED:'1',
    AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([{...config[0],inputUserIds:[userId],
      allowPersonalBindings:true,transportOnly:true}]) };
  const h=await harness(t,{env:replyEnv});
  assert.equal((await h.webhook([h.event('inline-result-1',{source:{type:'group',groupId:groupA,userId}})])).status,200);
  const response=await h.request('/replies',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({eventId:'inline-result-1',groupId:groupA,notifyUserId:userId,
      text:'核准指令已受理，正在確認 UOF 結果；系統不會重複送出核准。',
      actions:[{label:'查看結果',data:'uof.check.synthetic',inline:true}]})});
  assert.equal(response.status,200);
  assert.equal(h.replies.length,1);
  const messages=h.replies[0][1];
  assert.equal(messages.length,1);
  assert.equal(messages[0].type,'flex');
  assert.equal(messages[0].contents.footer,undefined);
  const inlineRow=messages[0].contents.body.contents[0];
  const text=inlineRow.contents[0];
  const link=inlineRow.contents[1];
  assert.match(text.text,/核准指令已受理/);
  assert.equal(link.action.type,'postback');
  assert.equal(link.action.data,'uof.check.synthetic');
  assert.equal(link.text,'查看結果');
  assert.equal(link.decoration,'underline');
  assert.equal(h.pushes.length,0);
  const invalid=await h.request('/replies',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({eventId:'inline-result-1',groupId:groupA,notifyUserId:userId,text:'結果',
      actions:[{label:'查看結果',data:'uof.check.one',inline:true},{label:'另一項',data:'uof.check.two'}]})});
  assert.equal(invalid.status,400);
});

test('bearer authentication, group allowlist, revoked ownership and shadow mode', async (t) => {
  const h = await harness(t);
  assert.equal((await h.request('/groups', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await h.request('/groups')).body.groups.length, 1);
  assert.equal((await h.send('a', 'text', groupB)).status, 403);
  h.setBindingStatus('影子記錄');
  assert.equal((await h.send('a')).status, 403);
  h.setOwner('other');
  assert.equal((await h.request('/events')).status, 403);
  assert.equal((await h.request('/groups')).body.groups.length, 0);
  assert.equal((await h.send('a')).status, 403);
  assert.equal(h.pushes.length, 0);
});

test('read-only clients cannot send', async (t) => {
  const h = await harness(t, { env: { ...env, AMCORE_LINE_IO_CLIENTS_JSON: JSON.stringify([{ ...config[0], scopes: ['events:read'] }]) } });
  assert.equal((await h.send('a')).status, 403);
});

test('malformed JSON and oversized bodies return explicit client errors', async (t) => {
  const h = await harness(t);
  const malformed = await h.request('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const wrongType = await h.request('/messages', { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  const large = await h.request('/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(70000) }) });
  assert.equal(large.status, 413);
  assert.equal(h.pushes.length, 0);
});

test('signed durable input, deduplication, source evidence, postbacks and cursor paging', async (t) => {
  const h = await harness(t);
  assert.equal((await h.webhook([h.event('1')], false)).status, 401);
  assert.equal(h.store.rows.length, 0);
  assert.equal((await h.webhook([])).status, 200);
  assert.equal((await h.webhook([h.event('1'), h.event('2', { type: 'postback', message: undefined, postback: { data: 'approval=42' } })])).status, 200);
  await h.webhook([h.event('1')]);
  await h.webhook([h.event('3', { source: { type: 'group', groupId: groupB } })]);
  const page = await h.request('/events?after=0&limit=1');
  assert.equal(page.body.events.length, 1);
  assert.equal(page.body.hasMore, true);
  assert.equal(page.body.events[0].event.source.userId, 'synthetic-user');
  assert.equal(page.body.events[0].projectId, 'goal-test');
  assert.equal(JSON.stringify(page.body).includes('private-'), false);
  const next = await h.request(`/events?after=${page.body.nextCursor}`);
  assert.equal(next.body.events[0].event.postback.data, 'approval=42');
  assert.equal(next.body.hasMore, false);
  assert.equal((await h.request(`/events?after=${next.body.nextCursor}`)).body.events.length, 0);
  assert.equal(h.store.rows.length, 2);
  assert.equal((await h.request('/events?after=-1')).status, 400);
  assert.equal((await h.request('/events?limit=101')).status, 400);
  assert.equal((await h.request('/events?after=9999999999999999999')).status, 400);
});

test('storage failure is not acknowledged and recovered redelivery is saved', async (t) => {
  const h = await harness(t);
  const append = h.store.append;
  h.store.append = async () => { throw new Error('storage down'); };
  assert.equal((await h.webhook([h.event('1')])).status, 503);
  h.store.append = append;
  assert.equal((await h.webhook([h.event('1')])).status, 200);
  assert.equal(h.store.rows.length, 1);
  h.setOwner('other');
  assert.equal((await h.webhook([h.event('2')])).status, 503);
});

test('input commit finishes before webhook acknowledgement', async (t) => {
  const h = await harness(t);
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  h.store.append = async () => { entered(); await gate; };
  let acknowledged = false;
  const sending = h.webhook([h.event('1')]).then((r) => { acknowledged = true; return r; });
  await started;
  assert.equal(acknowledged, false);
  release();
  assert.equal((await sending).status, 200);
});

test('send validation, duplicate suppression, conflict, failure retry UUID and concurrent reservation', async (t) => {
  const h = await harness(t);
  assert.equal((await h.send('')).status, 400);
  assert.equal((await h.send('a', 'x'.repeat(4901))).status, 400);
  assert.equal((await h.send('a', ' ')).status, 400);
  assert.equal((await h.send('a')).body.status, 'accepted');
  assert.equal((await h.send('a')).body.replayed, true);
  assert.equal(h.pushes.length, 1);
  assert.equal((await h.send('a', 'changed')).status, 409);
  h.setFailPush(true);
  const failed = await h.send('retry');
  assert.equal(failed.status, 502);
  assert.equal(JSON.stringify(failed.body).includes('secret'), false);
  const retryKey = h.pushes.at(-1)[3].retryKey;
  h.setFailPush(false);
  assert.equal((await h.send('retry')).status, 200);
  assert.equal(h.pushes.at(-1)[3].retryKey, retryKey);
  let release;
  h.setHoldPush(new Promise((resolve) => { release = resolve; }));
  const first = h.send('concurrent');
  // Observe the mock transport beginning; no production network request occurs.
  while (!h.store.sends.get('sample:daily:concurrent')) await new Promise((resolve) => setImmediate(resolve));
  const second = await h.send('concurrent');
  assert.equal(second.status, 409);
  assert.equal(second.headers.get('retry-after'), '30');
  release();
  assert.equal((await first).status, 200);
});

const allowedUser = 'U' + 'a'.repeat(32);
test('transport client keeps allowed inputs and default group mention recipient', async (t) => {
  const scopedEnv = { ...env, AMCORE_LINE_IO_CLIENTS_JSON: JSON.stringify([{ ...config[0], inputUserIds: [allowedUser], notifyUserId: allowedUser, transportOnly: true }]) };
  const h = await harness(t, { env: scopedEnv });
  const source = { type: 'group', groupId: groupA, userId: allowedUser };
  await h.webhook([h.event('allowed', {source}), h.event('other')]);
  assert.deepEqual((await h.request('/events')).body.events.map(e=>e.event.webhookEventId), ['allowed']);
  const g = (await h.request('/groups')).body.groups[0];
  assert.deepEqual(g.inputUserIds, [allowedUser]);
  assert.equal(g.notifyUserId, allowedUser);
  assert.equal(h.gateway.owns(h.event('x')), true);
  assert.equal(h.gateway.owns({source:{type:'user',userId:allowedUser}}), false);
  const result = await h.send('scoped', '{literal} report');
  assert.equal(result.status, 200);
  assert.equal(result.body.notifyUserId, allowedUser);
  assert.equal(h.pushes[0][1].substitution.who.mentionee.userId, allowedUser);
  assert.deepEqual(h.pushes[0][3].additionalMessages, [{type:'text',text:'{literal} report'}]);
  assert.equal((await h.request('/messages', {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'override'},body:JSON.stringify({groupId:groupA,text:'report',notifyUserId:'other'})})).status,400);
});


test('per-request notifyUserId overrides default, null skips @, and recipient changes conflict', async (t) => {
  const h = await harness(t, {env:{...env, AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify([{...config[0],notifyUserId:allowedUser}])}});
  const otherUser = 'U' + 'b'.repeat(32);
  const send = (key, recipient, include=true) => h.request('/messages', {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({groupId:groupA,text:'Report',...(include?{notifyUserId:recipient}:{})})});
  const first = await send('dynamic', otherUser);
  assert.equal(first.status, 200);
  assert.equal(first.body.notifyUserId, otherUser);
  assert.deepEqual(h.memberLookups[0], [groupA, otherUser, {timeoutMs:5000}]);
  assert.equal(h.pushes[0][1].substitution.who.mentionee.userId, otherUser);
  assert.equal((await send('dynamic', otherUser)).body.replayed,true);
  assert.equal(h.memberLookups.length, 1);
  assert.equal((await send('dynamic', allowedUser)).status,409);
  const fallback = await send('legacy', undefined, false);
  assert.equal(fallback.body.notifyUserId, allowedUser);
  assert.equal((await send('legacy', allowedUser)).body.replayed,true);
  const plain = await send('plain', null);
  assert.equal(plain.status,200);
  assert.equal(plain.body.notifyUserId,null);
  assert.equal(h.pushes.at(-1)[1], 'Report');
  assert.deepEqual(h.pushes.at(-1)[3].additionalMessages, []);
  assert.equal((await send('plain', undefined, false)).status,409);
  assert.equal(h.pushes.length,3);
});

test('invalid recipients and unverified members never send; transient lookup can retry', async (t) => {
  const h = await harness(t);
  const send = (key, id, groupId=groupA) => h.request('/messages',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({groupId,text:'Report',notifyUserId:id})});
  for (const id of ['', '陳聖文', 'line-id', 'U123', 123, [], {}]) {
    const bad = await send('invalid',id); assert.equal(bad.status,400); assert.equal(bad.body.error,'invalid_notify_user');
  }
  assert.equal(h.memberLookups.length,0);
  assert.equal((await send('denied',allowedUser,groupB)).status,403);
  assert.equal(h.memberLookups.length,0);
  h.setMemberFailure(Object.assign(new Error('private profile detail'),{lineStatus:404}));
  const absent = await send('missing',allowedUser);
  assert.equal(absent.status,403); assert.equal(absent.body.error,'notify_user_unavailable');
  h.setMemberFailure(Object.assign(new Error('private token'),{lineStatus:429}));
  const busy = await send('retry-member',allowedUser);
  assert.equal(busy.status,503); assert.equal(busy.body.error,'notify_lookup_unavailable');
  const uuid = h.store.sends.get('sample:daily:retry-member').retryKey;
  assert.equal(h.pushes.length,0);
  h.setMemberFailure(new DOMException('timeout','TimeoutError'));
  assert.equal((await send('retry-member',allowedUser)).status,503);
  h.setMemberFailure(null);
  assert.equal((await send('retry-member',allowedUser)).status,200);
  assert.equal(h.pushes[0][3].retryKey,uuid);
});

test('LINE group member lookup propagates a bounded timeout', async (t) => {
  const keepAlive=setTimeout(()=>{},1000);t.after(()=>clearTimeout(keepAlive));
  t.mock.method(globalThis,'fetch',async (_url, options)=>new Promise((_resolve,reject)=>{
    assert.ok(options.signal); options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
  }));
  const line=createLine({channelAccessToken:'synthetic',channelSecret:'synthetic'});
  await assert.rejects(line.resolveGroupMemberName(groupA,allowedUser,{timeoutMs:20}), {name:'TimeoutError'});
});

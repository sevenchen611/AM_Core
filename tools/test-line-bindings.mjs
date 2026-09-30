import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createBindingStore} from '../core/line-io/binding-store.js';
import {createLineIoStore} from '../core/line-io/store.js';
import {createLineIo} from '../core/line-io/index.js';
import {buildReviewCards} from '../core/line-io/cards.js';

const group=`C${'a'.repeat(32)}`,other=`C${'b'.repeat(32)}`,legacy=`C${'c'.repeat(32)}`;
const user=`U${'a'.repeat(32)}`,intruder=`U${'b'.repeat(32)}`;
const ioKey='synthetic-io-key-'.padEnd(40,'x'),manageKey='synthetic-management-key-'.padEnd(40,'y');
async function harness(t) {
  const db=new PGlite();
  for(const path of ['AM-IMP-2026.0929.01/schemas/line-io.sql','AM-IMP-2026.0929.04/schemas/line-bindings.sql'])
    await db.exec(await readFile(new URL(`../versions/${path}`,import.meta.url),'utf8'));
  // PGlite lacks advisory locks; writes are sequential in this harness. PostgreSQL remains the production concurrency authority.
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
  const pool={query,connect:async()=>({query,release(){}})};
  const bindingStore=createBindingStore(pool),store=createLineIoStore(pool),pushes=[];
  let count=1,failure;
  const line={configured:true,lineGet:async path=>{if(failure)throw failure;return path.endsWith('/count')?{count}:{groupName:'Synthetic private group'};},
    resolveGroupMemberName:async()=>{if(failure)throw failure;return 'Synthetic owner';},pushLineMessage:async(...args)=>{pushes.push(args);return {requestId:'test',messageIds:['test']};}};
  const clients=[{id:'io',tenantKey:'sample',tokenEnv:'IO_KEY',groupIds:[legacy],scopes:['groups:read','events:read','messages:write'],transportOnly:true,allowPersonalBindings:true,inputUserIds:[user],notifyUserId:user},
    {id:'manager',tenantKey:'sample',tokenEnv:'MANAGE_KEY',groupIds:[],scopes:['bindings:write'],bindingTargetClientId:'io'}];
  const gateway=await createLineIo({env:{AMCORE_LINE_IO_ENABLED:'1',AMCORE_LINE_BINDINGS_ENABLED:'1',IO_KEY:ioKey,MANAGE_KEY:manageKey,AMCORE_LINE_IO_CLIENTS_JSON:JSON.stringify(clients)},
    tenants:[{key:'sample'}],line,router:{invalidate(){},resolveGroupBinding:async id=>id===legacy?{tenant:{key:'sample'},binding:{status:'啟用',groupName:'Legacy'}}:{}},store,bindingStore});
  const server=http.createServer((req,res)=>gateway.handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});
  const request=async(path,{method='GET',body,key=manageKey,idempotency='test'}={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/line${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':idempotency},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const start=async(account='synthetic-owner')=>{const response=await request('/bindings/start',{method:'POST',body:{externalUserId:account,displayName:'Synthetic owner',replace:true}});assert.equal(response.status,200);return response.body;};
  const event=(id,text,groupId=group,userId=user)=>({type:'message',webhookEventId:id,timestamp:Date.now(),source:{type:'group',groupId,userId},replyToken:'NEVER_STORE',message:{id,type:'text',text}});
  const bind=async(account='synthetic-owner',groupId=group)=>{const row=await start(account);await gateway.capture([event('bind-'+row.bindingId,row.command,groupId)]);assert.equal((await request(`/bindings/${row.bindingId}?externalUserId=${account}`)).body.status,'pending_confirmation');assert.equal((await request(`/bindings/${row.bindingId}/confirm`,{method:'POST',body:{externalUserId:account}})).status,200);return row;};
  return {db,store,bindingStore,gateway,request,start,event,bind,pushes,setCount:value=>count=value,setFailure:value=>failure=value};
}

test('separate management key, hashed single-use code, owner confirmation and exact sender isolation',async t=>{
  const h=await harness(t),row=await h.start();
  assert.equal((await h.request('/bindings/start',{method:'POST',key:ioKey,body:{}})).status,403);
  assert.equal((await h.request('/events')).status,403);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{groupId:group,text:'test',notifyUserId:user}})).status,403);
  assert.equal(JSON.stringify((await h.db.query('SELECT * FROM line_bindings.bindings')).rows).includes(row.command.split(' ').at(-1)),false);
  await h.gateway.capture([h.event('candidate',row.command)]);
  assert.equal((await h.request('/groups',{key:ioKey})).body.groups.some(x=>x.groupId===group),false);
  assert.equal((await h.request(`/bindings/${row.bindingId}/confirm`,{method:'POST',body:{externalUserId:'wrong-account'}})).status,404);
  assert.equal((await h.request(`/bindings/${row.bindingId}/confirm`,{method:'POST',body:{externalUserId:'synthetic-owner'}})).body.status,'bound');
  await h.gateway.capture([h.event('owned','query'),h.event('foreign','query',group,intruder)]);
  const page=(await h.request('/events',{key:ioKey})).body;
  assert.deepEqual(page.events.map(x=>x.event.webhookEventId),['owned']);
  assert.equal(JSON.stringify(page).includes('NEVER_STORE'),false);
});

test('membership changes suspend IO, outages fail closed, same-day confirmation can safely resume',async t=>{
  const h=await harness(t),row=await h.bind();
  h.setFailure(new Error('provider-private-error'));
  const outage=await h.request(`/bindings/${row.bindingId}?externalUserId=synthetic-owner`);
  assert.equal(outage.status,503);assert.equal(JSON.stringify(outage).includes('provider-private-error'),false);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{groupId:group,text:'report',notifyUserId:user}})).status,503);
  h.setFailure(null);h.setCount(2);
  assert.equal((await h.request(`/bindings/${row.bindingId}?externalUserId=synthetic-owner`)).body.status,'suspended');
  assert.equal((await h.request('/groups',{key:ioKey})).body.groups.some(x=>x.groupId===group),false);
  h.setCount(1);
  assert.equal((await h.request(`/bindings/${row.bindingId}/resume`,{method:'POST',body:{externalUserId:'synthetic-owner'}})).body.status,'bound');
});

test('rebind replaces atomically after confirmation; old IO and cross-binding history stop',async t=>{
  const h=await harness(t),old=await h.bind();await h.gateway.capture([h.event('old-report','private')]);
  const fresh=await h.start();
  await h.gateway.capture([h.event('rebind',fresh.command,other)]);
  assert.equal((await h.request('/groups',{key:ioKey})).body.groups.some(x=>x.groupId===group),true);
  assert.equal((await h.request(`/bindings/${fresh.bindingId}/confirm`,{method:'POST',body:{externalUserId:'synthetic-owner'}})).status,200);
  assert.equal((await h.request(`/bindings/${old.bindingId}?externalUserId=synthetic-owner`)).body.status,'revoked');
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{groupId:group,text:'old',notifyUserId:user}})).status,403);
  await h.bind('new-owner',group);
  assert.equal((await h.request('/events',{key:ioKey})).body.events.length,0);
});

test('confirmation postbacks use durable idempotency; changed payloads and foreign recipients rejected',async t=>{
  const h=await harness(t);await h.bind();
  const body={groupId:group,text:'Confirm synthetic case',notifyUserId:user,actions:[{label:'Confirm',data:'opaque-confirmation-id'}]};
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).status,200);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).body.replayed,true);assert.equal(h.pushes.length,1);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,actions:[{label:'Different',data:'other'}]}})).status,409);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,notifyUserId:intruder}})).status,403);
});

test('review cards use one native carousel; idempotency covers layout and actions',async t=>{
  const h=await harness(t);await h.bind();
  const card={eyebrow:'UOF · 待簽',title:'TEST-1',subtitle:'Synthetic form',fields:[{label:'申請人',value:'測試使用者'}],body:'內容\n第二行',
    actions:[{label:'查看內容',data:'uof.open.test'},{label:'開啟原表單',uri:'https://example.test/form'},{label:'尚未開放',disabled:true}]};
  const httpLinkCard={...card,title:'廠商查詢',actions:[{label:'開啟廠商查詢',uri:'http://vendors.example.test:2707/VendorQ.aspx'}]};
  const body={groupId:group,text:'待簽卡片',notifyUserId:user,cards:[card,httpLinkCard]};
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).status,200);
  const message=h.pushes[0][1];
  assert.equal(message.type,'flex');assert.equal(message.contents.type,'carousel');
  assert.deepEqual(h.pushes[0][3].additionalMessages,[]);
  const bubble=message.contents.contents[0];
  assert.equal(bubble.header.contents[1].text,'TEST-1');
  assert.equal(bubble.footer.contents[0].action.data,'uof.open.test');
  assert.equal(bubble.footer.contents[2].action,undefined);
  assert.equal(message.contents.contents[1].footer.contents[0].action.uri,'http://vendors.example.test:2707/VendorQ.aspx');
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).body.replayed,true);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,cards:[{...card,title:'Changed'}]}})).status,409);
  assert.equal(h.pushes.length,1);
  for(const cards of [[],Array(7).fill(card),[{...card,body:'x'.repeat(3001)}],[{...card,actions:[{label:'bad',uri:'javascript:alert(1)'}]}],
    [{...card,actions:[{label:'bad',uri:'https://user:password@example.test/'}]}],[{...card,actions:[{label:'bad',uri:'https://example.test/'+ 'x'.repeat(1000)}]}],[{...card,actions:[{label:'bad',data:'x',disabled:true}]}],
    [{...card,type:'raw-flex'}]]) {
    assert.equal((await h.request('/messages',{method:'POST',key:ioKey,idempotency:'invalid',body:{...body,cards}})).status,400);
  }
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,notifyUserId:intruder}})).status,403);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,actions:[{label:'no',data:'x'}]}})).status,400);
  assert.equal(h.pushes.length,1);
  assert.throws(()=>buildReviewCards(Array(6).fill({...card,body:'漢'.repeat(3000),fields:Array(12).fill({label:'欄',value:'漢'.repeat(500)})}),'large'),/cards_too_large/);
});

test('consolidated review actions wrap filenames and preserve authorization and replay',async t=>{
  const h=await harness(t);await h.bind();
  const filename='月結附件含詳細品項與申請說明的長檔名_115年09月.pdf';
  const actions=Array.from({length:10},(_,i)=>({label:`附件 ${i+1}`,displayText:i===0?filename:`附件_${i+1}.pdf`,uri:`https://example.test/file/${i+1}`}));
  actions.push({label:'核准',data:'uof.submit.example'},{label:'未開放',displayText:'無效附件.pdf（連結未提供）',disabled:true});
  const cards=[{title:'Synthetic case',body:'Contents',actions}];
  const body={groupId:group,notifyUserId:user,text:'附件操作',cards};
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).status,200);
  const bubble=h.pushes[0][1].contents;
  assert.equal(bubble.type,'bubble');assert.equal(bubble.footer.contents.length,12);
  assert.equal(bubble.footer.contents[0].contents[0].text,filename);
  assert.equal(bubble.footer.contents[0].contents[0].wrap,true);
  assert.equal(bubble.footer.contents[0].action.uri,actions[0].uri);
  assert.equal(bubble.footer.contents[10].action.data,'uof.submit.example');
  assert.equal(bubble.footer.contents[11].action,undefined);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body})).body.replayed,true);
  const changed=[{...cards[0],actions:actions.map((a,i)=>i===0?{...a,displayText:'changed.pdf'}:a)}];
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,cards:changed}})).status,409);
  for(const badActions of [[...actions,actions[0]],[{...actions[0],displayText:''}],[{...actions[0],displayText:'漢'.repeat(301)}],
    [{...actions[0],displayText:{text:'raw'}}],[{...actions[0],uri:'javascript:alert(1)'}]])
    assert.equal((await h.request('/messages',{method:'POST',key:ioKey,idempotency:'invalid-long',body:{...body,cards:[{...cards[0],actions:badActions}]}})).status,400);
  assert.equal((await h.request('/messages',{method:'POST',key:ioKey,body:{...body,notifyUserId:intruder}})).status,403);
  assert.equal(h.pushes.length,1);
});

test('expired codes, legacy groups, rates and competing owners cannot bind',async t=>{
  const h=await harness(t),row=await h.start();
  await h.gateway.capture([h.event('legacy-bind',row.command,legacy)]);
  assert.equal((await h.request(`/bindings/${row.bindingId}?externalUserId=synthetic-owner`)).body.status,'pending_line');
  await h.db.query("UPDATE line_bindings.bindings SET expires_at=now()-interval '1 minute' WHERE id=$1",[row.bindingId]);
  await h.gateway.capture([h.event('expired',row.command)]);
  assert.equal((await h.request(`/bindings/${row.bindingId}?externalUserId=synthetic-owner`)).body.status,'expired');
  await h.bind();const competing=await h.start('different');await h.gateway.capture([h.event('competing',competing.command)]);
  assert.equal((await h.request(`/bindings/${competing.bindingId}?externalUserId=different`)).body.status,'pending_line');
  for(let i=0;i<3;i++)await h.start();
  assert.equal((await h.request('/bindings/start',{method:'POST',body:{externalUserId:'synthetic-owner',displayName:'Owner',replace:true}})).status,429);
});

test('90-day cleanup removes personal copies and send records while preserving other clients and active ownership',async t=>{
  const h=await harness(t),row=await h.bind();await h.gateway.capture([h.event('old-personal','synthetic private text')]);
  await h.store.append([{tenantKey:'sample',groupId:legacy,event:h.event('old-legacy','synthetic unrelated text',legacy)}]);
  await h.store.reserve({tenantKey:'sample',clientId:'io',key:'old-personal-send',hash:'synthetic'});
  await h.store.reserve({tenantKey:'sample',clientId:'other-client',key:'old-other-send',hash:'synthetic'});
  await h.db.exec("UPDATE line_io.line_io_events SET received_at=now()-interval '91 days';UPDATE line_io.line_io_sends SET created_at=now()-interval '91 days'");
  await h.bindingStore.purge(true);
  assert.deepEqual((await h.db.query('SELECT event_id FROM line_io.line_io_events')).rows.map(x=>x.event_id),['old-legacy']);
  assert.deepEqual((await h.db.query('SELECT client_id FROM line_io.line_io_sends')).rows.map(x=>x.client_id),['other-client']);
  assert.equal((await h.bindingStore.get(row.bindingId)).status,'bound');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import * as directLine from '../core/direct-line.js';
import {PGlite} from '@electric-sql/pglite';
import {createCalendarStore} from '../core/leaf-calendar/store.js';
import {createLeafCalendar,calendarAdminKey} from '../core/leaf-calendar/index.js';
import {prepareEvent,extractEvents,taipeiDate,calendarCandidate} from '../core/leaf-calendar/extract.js';

const T='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const U='U'+'a'.repeat(32),V='U'+'b'.repeat(32);
const tenant={key:'synthetic',tenantId:T},other={key:'other',tenantId:OTHER};
const secret='synthetic-channel-secret-not-production';
const apiKey='synthetic-shared-service-key-'.padEnd(72,'x');
const activity={topic:'專案會議',date:'2026-10-08',time:'14:00',endTime:'15:30',location:'台中會議室',content:'確認進度與分工'};
const message=(id,text,user=U)=>({type:'message',webhookEventId:id,timestamp:Date.now(),source:{type:'user',userId:user},message:{id,type:'text',text}});
const button=(id,action,draft,user=U)=>({type:'postback',webhookEventId:id,timestamp:Date.now(),source:{type:'user',userId:user},postback:{data:`leafcal:${action}:${draft.request_id}:${draft.revision}`}});
async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE SCHEMA am_memory;CREATE TABLE am_memory.tenants(tenant_id uuid PRIMARY KEY);INSERT INTO am_memory.tenants VALUES('${T}'),('${OTHER}');`);
  await db.exec(await readFile(new URL('../versions/AM-IMP-2026.1006.07/schemas/leaf-calendar.sql',import.meta.url),'utf8'));
  await db.exec(`CREATE ROLE calendar_runtime;GRANT USAGE ON SCHEMA leaf_calendar TO calendar_runtime;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA leaf_calendar TO calendar_runtime;SET ROLE calendar_runtime;`);
  let releaseQueue=Promise.resolve();
  const query=async(sql,params)=>{const result=await db.query(sql,params);return {...result,rowCount:result.affectedRows||result.rows.length};};
  const pool={connect:async()=>{let release;const held=releaseQueue;releaseQueue=new Promise(r=>{release=r;});await held;return {query,release};},end(){}};
  const store=createCalendarStore({settingsForTenant:()=>({configured:true,databaseUrl:'synthetic'}),poolFactory:async()=>pool});
  const pushes=[],writes=[],prompts=[];
  let events=[activity],failures=[],ambiguousAccepted=false;
  const saved=new Map();
  const fetchImpl=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://calendar.example.test');
    assert.ok(options.headers.Authorization === 'Bearer '+apiKey);
    const payload=JSON.parse(options.body);
    if(!Object.keys(payload).length)return new Response(JSON.stringify({code:'INVALID_REQUEST'}),{status:400});
    writes.push(payload);
    if(failures.length){const failure=failures.shift();if(failure==='timeout'){saved.set(payload.requestId,payload);ambiguousAccepted=true;throw new Error('timeout');}
      return new Response(JSON.stringify({ok:false,code:failure}),{status:failure==='UNAUTHORIZED'?401:502});}
    const replayed=saved.has(payload.requestId);if(replayed)assert.deepEqual(saved.get(payload.requestId),payload);saved.set(payload.requestId,payload);
    return new Response(JSON.stringify({ok:true,requestId:payload.requestId,account:payload.account,replayed,event:{id:payload.requestId,htmlLink:'https://calendar.google.com/calendar/event?eid=synthetic'}}),{status:replayed?200:201});
  };
  const platform={llmForTenant:()=>({available:true,completeJson:async args=>{assert.ok(!JSON.stringify(args).includes(apiKey));prompts.push(args);return {events};}}),
    pushLineMessage:async(userId,msg,_mention,delivery)=>{assert.ok(USER_IDS.includes(userId));pushes.push({userId,msg,key:delivery.retryKey});}};
  const USER_IDS=[U,V];
  const identities=new Map();
  const resolveIdentity=async userId=>identities.get(userId)||null;
  const service=await createLeafCalendar({env:{LINE_CHANNEL_SECRET:secret},tenants:[tenant,other],platform,store,fetchImpl,resolveIdentity,logger:{warn(){}}});
  await service.configureService({tenantKey:tenant.key,baseUrl:'https://calendar.example.test',apiKey});
  async function bind(user=U,account=user===U?'synthetic-owner':'synthetic-other'){
    identities.set(user,{tenantKey:tenant.key,account,bindingId:'verified-'+user+'-'+account});
  }
  return {db,store,service,platform,pushes,writes,prompts,bind,identities,setEvents:x=>{events=x;},fail:x=>{failures=x;},accepted:()=>ambiguousAccepted,
    restart:()=>createLeafCalendar({env:{LINE_CHANNEL_SECRET:secret},tenants:[tenant,other],platform,store,fetchImpl,resolveIdentity,logger:{warn(){}}}),
    async accelerate(){await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true)",[T]);await db.query('UPDATE leaf_calendar.requests SET available_at=now(),lease_expires_at=NULL WHERE tenant_id=$1',[T]);await db.query('COMMIT');},close:async()=>{await store.close();await db.close();}};
}
test('activity normalization: Taiwan timezone, invalid dates, default and explicit cross-day end',async()=>{
  assert.equal(taipeiDate(Date.UTC(2026,9,6,17)), '2026-10-07');
  assert.equal(calendarCandidate('待簽'),false);assert.equal(calendarCandidate('明天開會，下午三點，台中辦公室'),true);
  assert.ok(prepareEvent({...activity,date:'2026-02-30'},'x').missing.includes('有效日期'));
  const overnight=prepareEvent({...activity,time:'23:30',endTime:undefined},'x');assert.equal(overnight.endLabel,'2026-10-09 00:30');assert.equal(overnight.defaultDuration,true);
  assert.ok(prepareEvent({...activity,endTime:'13:00'},'x').missing.length);
  const cross=prepareEvent({...activity,time:'23:30',endDate:'2026-10-09',endTime:'01:00'},'x');assert.equal(cross.missing.length,0);
  const fallback=await extractEvents({text:'補充活動：\n地點：新會議室',at:Date.now(),existing:activity});assert.equal(fallback[0].topic,activity.topic);assert.equal(fallback[0].location,'新會議室');
  const range=await extractEvents({text:'活動名稱：會議\n日期：2026/10/08\n時間：14:00–16:00\n地點：台中',at:Date.now()});assert.equal(range[0].endTime,'16:00');
});
test('shared service encryption, trusted account, no write until explicit confirmation, and replay',async()=>{
  const f=await fixture();try{
    assert.equal(f.service.adminAuthorized(calendarAdminKey(secret)),true);assert.equal(f.service.adminAuthorized('wrong'),false);
    await f.bind();const config=await f.store.service(tenant);assert.ok(!JSON.stringify(config).includes(apiKey));
    assert.equal(await f.service.accepts(message('unbound','10/8 會議 14:00 台中',V)),false);
    f.setEvents([{...activity,account:'attacker-account'}]);
    const source=message('meeting-1','10/8 專案會議 下午2點 台中會議室');
    assert.equal(await f.service.accepts(source),true);await f.service.capture([source]);await f.service.drain();
    let draft=(await f.store.pending(tenant,U))[0];assert.equal(f.writes.length,0);assert.equal(draft.source_evidence.id,'meeting-1');
    assert.match(JSON.stringify(f.pushes.at(-1).msg),/活动名稱|活動名稱/);assert.match(JSON.stringify(f.pushes.at(-1).msg),/主要內容/);
    await f.service.capture([source]);await f.service.drain();assert.equal(f.prompts.length,1);
    await f.service.capture([button('confirm-1','confirm',draft)]);await f.service.drain();assert.equal(f.writes.length,1);assert.equal(f.writes[0].topic,activity.topic);assert.equal(f.writes[0].account,'synthetic-owner');
    assert.match(JSON.stringify(f.pushes.at(-1).msg),/已加入你的 Google 行事曆/);
    assert.equal((await f.store.owned(tenant,U,draft.request_id)).source_evidence.confirmation.id,'confirm-1');
    await f.service.capture([button('confirm-replayed','confirm',draft)]);await f.service.drain();assert.equal(f.writes.length,1);
  }finally{await f.close();}
});
test('wrong user/tenant, missing fields, cancellation and stale revision cannot create events',async()=>{
  const f=await fixture();try{
    await f.bind();await f.bind(V);
    f.setEvents([{...activity,time:''}]);await f.service.capture([message('missing-time','10/8 會議 台中')]);await f.service.drain();
    const draft=(await f.store.pending(tenant,U))[0];
    assert.equal(await f.store.owned(other,U,draft.request_id),null);
    await f.service.capture([button('foreign-click','confirm',draft,V),button('missing-click','confirm',draft)]);await f.service.drain();assert.equal(f.writes.length,0);
    await f.service.capture([button('edit-click','edit',draft)]);await f.service.drain();f.setEvents([activity]);
    await f.service.capture([button('confirm-while-editing','confirm',draft)]);await f.service.drain();assert.equal(f.writes.length,0);
    await f.service.capture([message('supplement','補充活動：下午2點')]);await f.service.drain();
    const revised=(await f.store.pending(tenant,U))[0];assert.equal(revised.revision,3);
    await f.service.capture([button('stale-click','confirm',draft)]);await f.service.drain();assert.equal(f.writes.length,0);
    await f.service.capture([button('cancel-click','cancel',revised)]);await f.service.drain();
    await f.service.capture([button('cancel-confirm','confirm',revised)]);await f.service.drain();assert.equal(f.writes.length,0);
  }finally{await f.close();}
});
test('ambiguous timeout retries the frozen JSON/requestId and never re-extracts or duplicates Google event',async()=>{
  const f=await fixture();try{
    await f.bind();await f.service.capture([message('retry-source','10/8 專案會議 14:00 台中')]);await f.service.drain();
    const draft=(await f.store.pending(tenant,U))[0];f.fail(['timeout']);
    await f.service.capture([button('retry-confirm','confirm',draft)]);await f.service.drain();assert.equal(f.accepted(),true);assert.equal(f.writes.length,1);
    f.setEvents([{...activity,topic:'must not be re-extracted'}]);await f.accelerate();await f.service.drain();
    assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.prompts.length,1);
    assert.equal((await f.store.owned(tenant,U,draft.request_id)).status,'saved');
  }finally{await f.close();}
});
test('real SQL leases fence stale workers and forced RLS denies missing/wrong tenant',async()=>{
  const f=await fixture();try{
    await f.bind();await f.service.capture([message('lease-source','10/8 會議 14:00 台中')]);
    const a=await f.store.lease(tenant);assert.ok(a);assert.equal(await f.store.lease(tenant),null);
    await f.accelerate();const b=await f.store.lease(tenant);assert.ok(b);assert.notEqual(a.lease_token,b.lease_token);
    assert.equal(await f.store.settle(tenant,a,{status:'done'}),false);
    assert.equal(await f.store.settle(tenant,b,{status:'done'}),true);
    assert.equal((await f.db.query('SELECT * FROM leaf_calendar.requests')).rows.length,0);
    await f.db.query('BEGIN');await f.db.query("SELECT set_config('app.tenant_id',$1,true)",[OTHER]);assert.equal((await f.db.query('SELECT * FROM leaf_calendar.requests')).rows.length,0);await f.db.query('ROLLBACK');
  }finally{await f.close();}
});
test('durable restart, multiple events, expired confirmations, identity changes and permanent errors',async()=>{
  const f=await fixture();try{
    await f.bind();f.setEvents([activity,{...activity,topic:'第二場會議'}]);await f.service.capture([message('multiple','10/8 兩場會議 14:00 台中')]);await f.service.drain();
    const pending=await f.store.pending(tenant,U);assert.equal(pending.length,2);
    await f.service.capture([message('ambiguous-confirm','確認加入行事曆')]);await f.service.drain();assert.equal(f.writes.length,0);
    const restarted=await f.restart();f.fail(['UNAUTHORIZED']);await restarted.capture([button('permanent-confirm','confirm',pending[0])]);await restarted.drain();
    assert.equal(f.writes.length,1);assert.equal((await f.store.owned(tenant,U,pending[0].request_id)).error_code,'UNAUTHORIZED');await f.accelerate();await restarted.drain();assert.equal(f.writes.length,1);
    await f.bind(U,'different-trusted-account');await restarted.capture([button('changed-key-confirm','confirm',pending[1])]);await restarted.drain();assert.equal(f.writes.length,1);
    f.setEvents([activity]);await restarted.capture([message('expiry','10/8 會議 14:00 台中')]);await restarted.drain();const expiring=(await f.store.pending(tenant,U)).find(x=>x.source_evidence.id==='expiry');
    await f.db.query('BEGIN');await f.db.query("SELECT set_config('app.tenant_id',$1,true)",[T]);await f.db.query("UPDATE leaf_calendar.requests SET expires_at=now()-interval '1 second' WHERE request_id=$1",[expiring.request_id]);await f.db.query('COMMIT');
    await restarted.capture([button('expired-confirm','confirm',expiring)]);await restarted.drain();assert.equal(f.writes.length,1);
  }finally{await f.close();}
});
test('real signed webhook persists calendar input before ACK; keeps groups and rejects unauthorized setup',async()=>{
  const f=await fixture();try{
    await f.bind();let handler,acked=false;const transport=[],groups=[];
    const oldInsert=f.store.insert;f.store.insert=async(...args)=>{assert.equal(acked,false,'capture must persist before ACK');return oldInsert(...args);};
    const oldPush=f.platform.pushLineMessage;f.platform.pushLineMessage=async(...args)=>{assert.equal(acked,true,'reply must follow durable ACK');return oldPush(...args);};
    f.platform.attachmentArchive={setTransportResolver(){},capture:async events=>{transport.push(...events);return [];},health:()=>({})};
    const sign=raw=>crypto.createHmac('sha256',secret).update(raw).digest('base64');
    const dependencies={
      'node:http':{default:{createServer(fn){handler=fn;return {listen(){}};}}},'node:crypto':{default:crypto},
      './core/bootstrap.js':{bootstrap:async()=>({tenants:[tenant],line:{configured:true,isValidSignature:(raw,s)=>s===sign(raw)},router:{resolveGroupBinding:async()=>({tenant,binding:{status:'啟用'}})},
        dispatcher:{collectRoutes:()=>[],dispatchMessage:async({event})=>groups.push(event)},portal:{},modules:new Map(),platform:f.platform,llm:{available:false,backends:[]},logger:{log(){},warn(){},error(){}}})},
      './core/line-io/index.js':{createLineIo:async()=>({enabled:false,owns:()=>false,handle:async()=>false,capture:async events=>transport.push(...events)}),readLineIoBody:async req=>req.rawBody},
      './core/leaf-calendar/index.js':{createLeafCalendar:async()=>f.service},
      './core/bank-line-reply-intake.js':{createBankLineReplyIntake:()=>({receive:async()=>false,drain:async()=>{}})},
      './core/attachment-retrieval.js':{createAttachmentRetrieval:()=>({handle:async()=>false}),parseAttachmentRequest:()=>null},
      './core/direct-line.js':directLine,'./core/access-directory.js':{createAccessDirectory:()=>({})},'./core/portal-handoff.js':{safePortalHandoffLocation:()=> '/'},
      './core/util.js':{readBody:async req=>req.rawBody,sendJson:(res,status,body)=>{res.status=status;res.body=body;},sendText:(res,status)=>{res.status=status;acked=true;}},
      './core/group-onboarding.js':Object.fromEntries(['GROUP_ONBOARDING_BUILD','deliverGroupOnboardingReply','groupOnboardingProperties','groupOnboardingRepairProperties','groupOnboardingSuccessMessage','parseGroupOnboardingCommand','supportedGroupOnboardingExamples','withResolvedGroupName'].map(key=>[key,()=>({isCommand:false})])),
    };
    const context=vm.createContext({URL,Buffer,console,process:{env:{}},setInterval:()=>({unref(){}})});
    const module=new vm.SourceTextModule(await readFile(new URL('../server.js',import.meta.url),'utf8'),{context});
    await module.link(name=>new vm.SyntheticModule(Object.keys(dependencies[name]),function(){for(const [key,value] of Object.entries(dependencies[name]))this.setExport(key,value);},{context}));await module.evaluate();
    const event=message('webhook-calendar','10/8 專案會議 14:00 台中');const group={...message('group-msg','群組'),source:{type:'group',groupId:'synthetic-group',userId:U}};
    const raw=JSON.stringify({events:[event,group]});const denied={};await handler({method:'POST',url:'/webhook/line',rawBody:raw,headers:{'x-line-signature':'invalid'}},denied);assert.equal(denied.status,401);
    const res={};await handler({method:'POST',url:'/webhook/line',rawBody:raw,headers:{'x-line-signature':sign(raw)}},res);assert.equal(res.status,200);await f.service.drain();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.writes.length,0);assert.equal((await f.store.pending(tenant,U)).length,1);assert.ok(transport.every(e=>e.source.type==='group'));assert.equal(groups.length,1);
    const adminDenied={};await handler({method:'POST',url:'/portal/admin/leaf-calendar/service',rawBody:'{}',headers:{authorization:'Bearer wrong'}},adminDenied);assert.equal(adminDenied.status,401);
  }finally{await f.close();}
});

test('revoked UOF identity after intake or confirmation cannot create a Google event',async()=>{
  const f=await fixture();try{
    await f.bind();await f.service.capture([message('revoked-after-intake','10/8 會議 14:00 台中')]);
    f.identities.delete(U);await f.service.drain();assert.equal(f.prompts.length,0);assert.equal(f.writes.length,0);
    await f.bind();await f.service.capture([message('revoked-after-preview','10/8 會議 14:00 台中')]);await f.service.drain();
    const draft=(await f.store.pending(tenant,U))[0];await f.service.capture([button('revoked-confirm','confirm',draft)]);
    f.identities.delete(U);await f.service.drain();assert.equal(f.writes.length,0);
    assert.equal((await f.store.owned(tenant,U,draft.request_id)).confirmed_at,null);
    assert.equal(await f.service.accepts(message('revoked-source','10/8 會議 14:00 台中')),false);
  }finally{await f.close();}
});

test('authenticated shared setup provisions a cold tenant without individual pairing',async()=>{
  const f=await fixture();try{
    const cold=Object.create(f.store);let provisioned=false,provisions=0;
    cold.ready=async()=>provisioned;cold.provision=async()=>{provisions++;provisioned=true;return true;};
    const service=await createLeafCalendar({env:{LINE_CHANNEL_SECRET:secret},tenants:[tenant],platform:f.platform,store:cold,
      resolveIdentity:async()=>({tenantKey:tenant.key,account:'synthetic-owner',bindingId:'trusted-cold'}),
      fetchImpl:async()=>new Response(JSON.stringify({code:'INVALID_REQUEST'}),{status:400}),logger:{warn(){}}});
    assert.equal(service.health().enabled,false);
    await assert.rejects(service.configureService({tenantKey:'unregistered',baseUrl:'https://calendar.example.test',apiKey}));assert.equal(provisions,0);
    await service.configureService({tenantKey:tenant.key,baseUrl:'https://calendar.example.test',apiKey});
    assert.equal(service.health().enabled,true);assert.deepEqual(service.health().configuredTenants,[tenant.key]);assert.equal(provisions,1);
    assert.equal(await service.accepts(message('cold-source','10/8 會議 14:00 台中')),true);assert.equal(f.writes.length,0);
  }finally{await f.close();}
});

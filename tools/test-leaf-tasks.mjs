import test from 'node:test';
import assert from 'node:assert/strict';
import {createLeafTasks,mentionCandidate,taskAdminKey} from '../core/leaf-tasks.js';
const sender='U'+'1'.repeat(32),recipient='U'+'2'.repeat(32),group='C'+'3'.repeat(32),secret='synthetic-secret',tenant={key:'fixture',tenantId:'synthetic-tenant',runtimeEnabled:true};
function event(text='@同仁 請整理本週客訴清單'){return {type:'message',webhookEventId:'fixture-event',timestamp:Date.now(),source:{type:'group',groupId:group,userId:sender},message:{type:'text',id:'fixture-message',text,mention:{mentionees:[{type:'user',userId:recipient,index:0,length:3}]}}};}
async function fixture({failFirstTenant=false}={}){let config=null,job=null,judgments=0,issues=0,notices=0,failNotice=false,revoked=false;const paths=[];
 const options={env:{LINE_CHANNEL_SECRET:secret},tenants:failFirstTenant?[{key:'unavailable',runtimeEnabled:true},tenant]:[tenant],store:{service:async t=>{if(t.key==='unavailable')throw Object.assign(Error('synthetic unavailable'),{code:'42501'});return config;},provisionTasks:async()=>{},configureTask:async(t,v)=>config={encrypted_key:{iv:'preserved-calendar',taskService:{baseUrl:v.baseUrl,encryptedKey:v.encryptedKey}}}},router:{resolveGroupBinding:async()=>({tenant,binding:{status:'影子記錄'},resolution:'active'})},line:{lineGet:async p=>({userId:p.split('/').at(-1)})},resolveIdentity:async(u,t)=>revoked?null:({tenantKey:t,account:u===sender?'sender':'recipient',bindingId:'bound-'+u}),platform:{pushLineMessage:async()=>{if(failNotice){failNotice=false;throw Error('synthetic timeout');}notices++;}},llm:{completeJson:async opts=>{judgments++;return JSON.parse(opts.userContent).text.includes('早安')?{assignments:[]}:{assignments:[{title:'整理客訴清單',description:'整理本週客訴清單',recipientIndices:[0]}]};}},logger:{warn(){}},fetchImpl:async(url,init)=>{const path=new URL(url).pathname.split('/').at(-1),input=init.body?JSON.parse(init.body):{};paths.push(path);let output={ok:true};
 if(path==='health')output={ok:true,contract:'line-mention-dailylog-immediate-v1',tenant:'fixture'};
 if(path==='intake'){if(!job)job={id:input.id,state:'queued',input,result:null,leaseToken:'synthetic-lease'};else assert.equal(input.id,job.id);}
 if(path==='next')output.job=job&&job.state!=='done'&&job.state!=='suppressed'?structuredClone(job):null;
 if(path==='judgment'){job.result={assignments:input.assignments};job.state=input.assignments.length?'judged':'suppressed';}
 if(path==='issue'){issues++;job.state='issued';job.result={taskIds:['work-synthetic'],notice:'已交辦，請補交辦資料。'};}
 if(path==='notified')job.state='done';
 if(path==='defer')job.state=job.state;
 if(path==='source')job.state=job.state==='issued'?'issued':'suppressed';
 return Response.json(output);}};
 let service=createLeafTasks(options);await service.configureService({tenantKey:'fixture',baseUrl:'https://dailylog.example/',apiKey:'synthetic-service-key-with-at-least-32-bytes'});
 return {service,paths,counts:()=>({judgments,issues,notices}),restart:()=>createLeafTasks(options),failNotice:()=>{failNotice=true;},revoke:()=>{revoked=true;}};}
test('true colleague mention is required; private, bot, @all, typed @ are excluded',()=>{assert(mentionCandidate(event()));assert(!mentionCandidate({...event(),source:{type:'user',userId:sender}}));for(const mentions of [[],[{type:'all'}],[{type:'user',isSelf:true,userId:recipient}],[{type:'user'}]])assert(!mentionCandidate({...event(),message:{...event().message,mention:{mentionees:mentions}}}));});
test('purpose-specific setup, encrypted config, persisted intake, judgment and immediate issue',async()=>{const f=await fixture();assert(f.service.adminAuthorized(taskAdminKey(secret)));assert(!f.service.adminAuthorized('wrong'));await f.service.capture([event()]);await f.service.drain();assert.deepEqual(f.counts(),{judgments:1,issues:1,notices:1});assert(f.paths.indexOf('intake')<f.paths.indexOf('judgment'));assert(f.paths.indexOf('judgment')<f.paths.indexOf('issue'));assert.deepEqual(f.service.health().configuredTenants,['fixture']);});
test('same-event replay does not issue again; general greeting is suppressed',async()=>{const f=await fixture(),e=event();await f.service.capture([e]);await f.service.drain();await f.service.capture([e]);await f.service.drain();assert.deepEqual(f.counts(),{judgments:1,issues:1,notices:1});const greeting=await fixture();await greeting.service.capture([event('@同仁 早安')]);await greeting.service.drain();assert.deepEqual(greeting.counts(),{judgments:1,issues:0,notices:0});});
test('notice retry after restart never reclassifies or reissues the task',async()=>{const f=await fixture();f.failNotice();await f.service.capture([event()]);await f.service.drain();await f.restart().drain();assert.equal(f.counts().judgments,1);assert.equal(f.counts().issues,1);assert.equal(f.counts().notices,1);});
test('revoke before intake and unsend after capture do not issue work',async()=>{const f=await fixture();f.revoke();await f.service.capture([event()]);assert(!f.paths.includes('intake'));const g=await fixture();await g.service.capture([event()]);await g.service.capture([{type:'unsend',source:event().source,unsend:{messageId:'fixture-message'}}]);await g.service.drain();assert.equal(g.counts().issues,0);});
test('unavailable non-enrolled tenant cannot stop an enrolled tenant drain',async()=>{const f=await fixture({failFirstTenant:true});assert.deepEqual(f.service.health().configuredTenants,['fixture']);await f.service.capture([event()]);await f.service.drain();assert.deepEqual(f.counts(),{judgments:1,issues:1,notices:1});});
test('source diagnostics expose gate results without task writes or private IDs/content',async()=>{
 const f=await fixture(),e=event(),before=f.paths.length;
 const result=await f.service.inspectSource({key:'in:synthetic',event:e});
 assert.equal(result.candidate,true);assert.equal(result.configured,true);assert.equal(result.senderResolved,true);assert.deepEqual(result.recipientResolved,[true]);
 assert.equal(f.paths.length,before);assert.deepEqual(f.counts(),{judgments:0,issues:0,notices:0});
 for(const privateValue of [sender,recipient,group,e.message.text])assert(!JSON.stringify(result).includes(privateValue));
 f.revoke();assert.equal((await f.service.inspectSource({key:'in:synthetic',event:e})).senderResolved,false);
});

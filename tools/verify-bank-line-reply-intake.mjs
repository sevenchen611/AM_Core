import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createOperationalMemory, __test } from '../core/operational-memory.js';
import { createBankLineReplyIntake } from '../core/bank-line-reply-intake.js';
import { createLineIo } from '../core/line-io/index.js';
import { createAttachmentArchive } from '../core/attachment-archive.js';
import { createAttachmentRetrieval, parseAttachmentRequest } from '../core/attachment-retrieval.js';

const db = new PGlite();
const tenant = { key: 'hozo-am-2-0', tenantId: '11111111-1111-4111-8111-111111111111', envPrefix: 'TEST', operationalMemory: { enabled: true, activationMode: 'enforce' } };
const otherTenant = { ...tenant, key: 'synthetic-other', tenantId: '22222222-2222-4222-8222-222222222222' };
const logger = { log() {}, warn() {}, error() {} };
try {
  await db.exec(`CREATE SCHEMA am_memory;
    CREATE TABLE am_memory.tenants(tenant_id uuid PRIMARY KEY,tenant_key text,display_name text,settings jsonb);
    CREATE TABLE am_memory.source_records(tenant_id uuid,source_id uuid,PRIMARY KEY(tenant_id,source_id));`);
  const schema = await fs.readFile(new URL('../versions/AM-IMP-2026.0718.01/schemas/postgresql-operational-memory.sql', import.meta.url),'utf8');
  const start = schema.indexOf('CREATE TABLE IF NOT EXISTS am_memory.processing_jobs (');
  await db.exec(schema.slice(start,schema.indexOf('\n);',start)+4));
  const client = { async query(sql,params) { const result=await db.query(sql,params);return { ...result,rowCount:result.affectedRows ?? result.rows.length }; },release() {} };
  const memory = createOperationalMemory({ env:{ TEST_AM_MEMORY_DATABASE_URL:'postgres://synthetic/memory' }, logger, poolFactory:()=>({connect:async()=>client,end:async()=>{}}) });
  const notification={sourceNotificationId:'bank-reconciliation-notification:synthetic',payloadDigest:'a'.repeat(64),routeDigest:crypto.createHash('sha256').update(JSON.stringify({groupId:'group',userId:'reviewer'})).digest('hex'),providerRetryKey:`finance-provider:v1:${'b'.repeat(64)}`,groupId:'group'};
  await memory.bindFinanceNotificationIdentity(tenant,notification);
  await memory.markFinanceNotificationDelivered(tenant,notification.sourceNotificationId,'c'.repeat(64),['question']);
  assert.deepEqual(await memory.bankFinanceQuoteOwnership(tenant,'question','group','other-user'),{known:true,groupVerified:true});
  assert.equal((await memory.bankFinanceQuoteOwnership(otherTenant,'question','group','reviewer')).known,false);
  const event={type:'message',webhookEventId:'event',timestamp:1000,source:{type:'group',groupId:'group',userId:'reviewer'},message:{id:'message',type:'text',text:'已入帳',quotedMessageId:'question'}};
  let network=0,mode='timeout';
  const options={tenant,memory,router:{resolveGroupBinding:async()=>{throw new Error('Notion should not be needed');}},pushKey:'synthetic',rentalBase:'https://synthetic.test',logger,
    fetchImpl:async()=>{network++;if(mode==='timeout')throw new Error('aborted');return {ok:true,json:async()=>mode==='old'?{handled:true}:{handled:true,saved:true,result:'question'}};}};
  const intake=createBankLineReplyIntake(options);
  assert.equal((await intake.receive(event)).replayed,false);assert.equal(network,0);
  assert.equal((await intake.receive(event)).replayed,true);
  await assert.rejects(()=>intake.receive({...event,message:{...event.message,text:'changed'}}),/identity_failed/);
  const job=await db.query("SELECT * FROM am_memory.processing_jobs WHERE job_kind='bank-line-reply'");
  assert.equal(job.rows.length,1);assert.equal(job.rows[0].input_payload.payload.text,'已入帳');assert.equal(job.rows[0].input_payload.payload.quotedMessageId,'question');
  assert.equal(job.rows[0].input_payload.payload.timestamp,1000);
  await intake.drain();assert.equal((await db.query("SELECT status FROM am_memory.processing_jobs WHERE job_kind='bank-line-reply'")).rows[0].status,'retry');
  await db.exec("UPDATE am_memory.processing_jobs SET available_at=clock_timestamp() WHERE job_kind='bank-line-reply'");
  mode='old';await createBankLineReplyIntake(options).drain();assert.equal((await db.query("SELECT status FROM am_memory.processing_jobs WHERE job_kind='bank-line-reply'")).rows[0].status,'retry');
  await db.exec("UPDATE am_memory.processing_jobs SET available_at=clock_timestamp() WHERE job_kind='bank-line-reply'");
  mode='saved';await createBankLineReplyIntake(options).drain();assert.equal((await db.query("SELECT status FROM am_memory.processing_jobs WHERE job_kind='bank-line-reply'")).rows[0].status,'succeeded');
  const count=network;await intake.drain();assert.equal(network,count);
  await intake.receive({...event,webhookEventId:'event-lease',message:{...event.message,id:'lease-message'}});
  const [lease]=await memory.leaseProcessingJobs(tenant,{jobKind:'bank-line-reply',leaseOwner:'old'});
  await db.exec("UPDATE am_memory.processing_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE status='leased'");
  await memory.leaseProcessingJobs(tenant,{jobKind:'bank-line-reply',leaseOwner:'new'});
  assert.equal(await memory.settleProcessingJob(tenant,{jobId:lease.job_id,status:'succeeded',leaseOwner:'old'}),null);
  assert.equal((await memory.settleProcessingJob(tenant,{jobId:lease.job_id,status:'succeeded',leaseOwner:'new'})).status,'succeeded');
  await intake.receive({...event,webhookEventId:'event-dead',message:{...event.message,id:'dead-message'}});
  await db.exec("UPDATE am_memory.processing_jobs SET attempt_count=19 WHERE status='queued'");
  mode='timeout';await intake.drain();assert.equal((await db.query("SELECT status FROM am_memory.processing_jobs WHERE idempotency_key='line:dead-message'")).rows[0].status,'dead_letter');
  assert.equal((await intake.receive({...event,message:{...event.message,quotedMessageId:'unrelated'}})),false);
  const failingLookup=createBankLineReplyIntake({...options,memory:{bankFinanceQuoteOwnership:async()=>({known:true,groupVerified:false})},router:{resolveGroupBinding:async()=>({resolution:'lookup_failed'})}});
  await assert.rejects(()=>failingLookup.receive(event),/group_lookup_failed/);
  assert.equal(__test.sanitizedEnvelope({event,message:event.message}).message.quotedMessageId,'question');

  // Execute the real webhook entry: ACK is independent of Rental latency, while
  // a failed durable write returns 503 and never claims the event as received.
  async function webhook(persistenceFails=false) {
    let callback,acked=false,authority=0,receipts=0;
    const fakeMemory={bankFinanceQuoteOwnership:async()=>({known:true,groupVerified:true}),enqueueProcessingJob:async(_t,input)=>{
      assert.equal(acked,false);if(persistenceFails)throw new Error('storage unavailable');return {ok:true,job:{input_payload:input.inputPayload,replayed:false}};
    },leaseProcessingJobs:async()=>[]};
    const dependencies={
      './core/attachment-retrieval.js':{createAttachmentRetrieval,parseAttachmentRequest},
      'node:http':{default:{createServer(fn){callback=fn;return {listen(){}};}}},'node:crypto':{default:crypto},
      './core/bootstrap.js':{bootstrap:async()=>({tenants:[tenant],line:{configured:true,isValidSignature:()=>true,replyLineMessage:async()=>{receipts++;}},router:{},dispatcher:{collectRoutes:()=>[]},portal:{},modules:new Map([['claims',{preAckClaimsAuthorityEvent:async()=>{authority++;return {intercepted:true};}}]]),platform:{operationalMemory:fakeMemory,rentalFinanceGroupPushKey:'synthetic',attachmentArchive:createAttachmentArchive({platform:{},router:{},logger})},logger})},
      './core/bank-line-reply-intake.js':{createBankLineReplyIntake},
      './core/line-io/index.js':{createLineIo,readLineIoBody:async r=>r.rawBody},
      './core/direct-line.js':{routeDirectLineEvent:async()=>({matched:false})},'./core/access-directory.js':{createAccessDirectory:()=>({})},'./core/portal-handoff.js':{safePortalHandoffLocation:()=>'/'},
      './core/util.js':{readBody:async r=>r.rawBody,sendJson:(r,status)=>{r.status=status;},sendText:(r,status)=>{r.status=status;acked=true;}},
      './core/group-onboarding.js':Object.fromEntries(['GROUP_ONBOARDING_BUILD','deliverGroupOnboardingReply','groupOnboardingProperties','groupOnboardingRepairProperties','groupOnboardingSuccessMessage','parseGroupOnboardingCommand','supportedGroupOnboardingExamples','withResolvedGroupName'].map(k=>[k,()=>null])),
    };
    const context=vm.createContext({URL,Buffer,console,process:{env:{}},setInterval:()=>({unref(){}})});
    const module=new vm.SourceTextModule(await fs.readFile(new URL('../server.js',import.meta.url),'utf8'),{context});
    await module.link(name=>new vm.SyntheticModule(Object.keys(dependencies[name]),function(){for(const [key,value] of Object.entries(dependencies[name]))this.setExport(key,value);},{context}));
    await module.evaluate();const res={};
    await callback({method:'POST',url:'/webhook/line',headers:{},rawBody:JSON.stringify({events:[{...event,replyToken:'synthetic'}]})},res);
    assert.equal(res.status,persistenceFails?503:200);assert.equal(authority,0);assert.equal(receipts,persistenceFails?0:1);
  }
  await webhook();await webhook(true);
  console.log('Bank LINE reply verified: PostgreSQL persistence, tenant isolation, immutable replay, timeout/restart recovery, fenced leases, dead letters and real webhook ACK ordering. No production I/O.');
} finally { await db.close(); }

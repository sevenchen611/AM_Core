import assert from 'node:assert/strict';
import * as workJournalEntry from '../core/work-journal-entry.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as directLine from '../core/direct-line.js';
import * as leafCalendar from '../core/leaf-calendar/index.js';
import * as leafTasks from '../core/leaf-tasks.js';
import { createAttachmentArchive, ATTACHMENT_ARCHIVE_PROPERTIES } from '../core/attachment-archive.js';
import { createAttachmentRetrieval, parseAttachmentRequest } from '../core/attachment-retrieval.js';

// Exercise the real server entry and real binary capture together; no production I/O.
for (const fails of [false, true]) {
  let handler, acked = false, writes = 0, workerStarts = 0, dispatched = 0, retrievalMode = false;
  let replyDone;
  const replyPromise = new Promise(resolve => { replyDone = resolve; });
  const tenant = { key: 'synthetic-archive', modules: ['collect'], driveConfigured: true,
    driveRootFolderId: 'synthetic-root', dataSources: { attachments: 'synthetic-attachments', messages: 'synthetic-messages' } };
  const logger = { log() {}, warn() {}, error() {} };
  const router = { resolveGroupBinding: async () => ({ tenant, binding: { status: '啟用' }, resolution: 'active' }) };
  const platform = { notionRequest: async (path, options) => {
    assert.equal(options.tenantKey, tenant.key);
    if (!retrievalMode) assert.equal(acked, false, 'binary intake must be durable before HTTP acknowledgement');
    if (fails) throw new Error('Synthetic Notion outage');
    if (path.endsWith('/query')) return { results: options.body.filter?.rich_text?.equals === 'synthetic-known-original' ? [{
      id: 'synthetic-saved-original', parent: {data_source_id: tenant.dataSources.attachments}, properties: {
        'LINE 訊息 ID': {rich_text:[{text:{content:'synthetic-known-original'}}]},
        'LINE 群組 ID': {rich_text:[{text:{content:'synthetic-group'}}]},
        '檔案名稱': {rich_text:[{text:{content:'original.pdf'}}]},
        '保存狀態': {select:{name:'已保存'}}, 'Drive 檔案 ID': {rich_text:[{text:{content:'synthetic-drive-file'}}]},
        'Drive MD5': {rich_text:[{text:{content:'a'.repeat(32)}}]}, '檔案大小': {number:40647423},
      },
    }] : [] };
    if (path === '/v1/pages') { writes++; return { id: 'synthetic-row', properties: options.body.properties }; }
    return { properties: Object.fromEntries(Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES).map(([k,v]) => [k, {type:Object.keys(v)[0]}])) };
  } };
  platform.drive = {verifyWithinRoot:async()=>({id:'synthetic-drive-file',size:40647423,md5Checksum:'a'.repeat(32)})};
  platform.replyLineMessage = async (token, text) => {
    assert.equal(token, 'synthetic-request-reply'); assert.match(text,/drive.google.com/); replyDone();
  };
  platform.attachmentArchive = createAttachmentArchive({ platform, router, logger });
  platform.attachmentArchive.drain = async () => { assert.equal(acked, true); workerStarts++; };
  const dependencies = {
    './core/central-archive/index.js':{createCentralArchive:async()=>({capture:async()=>{},health:()=>({enabled:false})})},
    './core/attachment-retrieval.js': {createAttachmentRetrieval,parseAttachmentRequest},
    'node:http': { default: { createServer(fn) { handler = fn; return {listen(){}}; } } },
    'node:crypto': { default: crypto },
    './core/bootstrap.js': { bootstrap: async () => ({ tenants: [tenant], line: { configured:true,isValidSignature:()=>true },
      router, dispatcher: {collectRoutes:()=>[],dispatchMessage:async()=>{dispatched++;}}, portal: {}, modules:new Map(),platform,logger }) },
    './core/line-io/index.js': { createLineIo:async()=>({enabled:false,
      owns:e=>e.message?.id==='synthetic-quote-request',handle:async()=>false,
      resolveAttachmentBinding:async()=>({tenant,binding:{status:'啟用'}}),
      capture:async(events,options)=>{ if(retrievalMode) assert.equal(options.excludeEvents(events[0]),true); },
    }),readLineIoBody:async r=>r.rawBody },
    './core/bank-line-reply-intake.js': {createBankLineReplyIntake:()=>({receive:async()=>false,drain:async()=>{}})},
    './core/work-journal-entry.js': workJournalEntry,
  './core/direct-line.js': directLine,
    './core/leaf-calendar/index.js': leafCalendar,
    './core/leaf-tasks.js': leafTasks,
    './core/access-directory.js': {createAccessDirectory:()=>({})},
    './core/portal-handoff.js': {safePortalHandoffLocation:()=> '/'},
    './core/util.js': { readBody:async r=>r.rawBody,sendJson:(r,status)=>{r.status=status;},sendText:(r,status)=>{r.status=status;acked=true;} },
    './core/group-onboarding.js': Object.fromEntries(['GROUP_ONBOARDING_BUILD','deliverGroupOnboardingReply','groupOnboardingProperties',
      'groupOnboardingRepairProperties','groupOnboardingSuccessMessage','parseGroupOnboardingCommand',
      'supportedGroupOnboardingExamples','withResolvedGroupName'].map(k=>[k,()=>null])),
  };
  const context = vm.createContext({URL,Buffer,console,process:{env:{}},setInterval:()=>({unref(){}})});
  const module = new vm.SourceTextModule(await fs.readFile(new URL('../server.js',import.meta.url),'utf8'),{context});
  await module.link(name=>new vm.SyntheticModule(Object.keys(dependencies[name]),function(){
    for(const [key,value] of Object.entries(dependencies[name])) this.setExport(key,value);
  },{context}));
  await module.evaluate();
  const invalidDownload = { setHeader() {}, end(value) { this.body = value; } };
  await handler({ method: 'GET', url: '/line-attachment?tenant=synthetic-archive&token=invalid', headers: {} }, invalidDownload);
  assert.equal(invalidDownload.statusCode, 403, 'real server must route downloads into the signature gate');
  const event = {type:'message',source:{type:'group',groupId:'synthetic-group'},timestamp:Date.now(),
    message:{id:'synthetic-file',type:'file',fileName:'large.pdf',fileSize:40647423}};
  const res = {};
  await handler({method:'POST',url:'/webhook/line',headers:{},rawBody:JSON.stringify({events:[event]})},res);
  assert.equal(res.status, fails ? 503 : 200);
  assert.equal(writes, fails ? 0 : 1);
  assert.equal(workerStarts, fails ? 0 : 1);
  if (!fails) {
    // An actual transport-owned request reaches core retrieval, never task modules
    // or a second transport assistant, and requires no LINE content download.
    retrievalMode = true;
    const before = dispatched;
    const quoted = {type:'message',source:{type:'group',groupId:'synthetic-group',userId:'synthetic-user'},
      replyToken:'synthetic-request-reply',message:{id:'synthetic-quote-request',type:'text',
        text:'請提供這個檔案給我',quotedMessageId:'synthetic-known-original'}};
    await handler({method:'POST',url:'/webhook/line',headers:{},rawBody:JSON.stringify({events:[quoted]})},{});
    await replyPromise;
    assert.equal(dispatched,before);
    assert.equal(writes,2,'the file request is preserved as its own source record');
  }
}
console.log('Real webhook verified: durable tenant binary intake before 200; Notion outage returns 503; worker starts after acknowledgement.');

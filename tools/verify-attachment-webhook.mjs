import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createAttachmentArchive, ATTACHMENT_ARCHIVE_PROPERTIES } from '../core/attachment-archive.js';

// Exercise the real server entry and real binary capture together; no production I/O.
for (const fails of [false, true]) {
  let handler, acked = false, writes = 0, workerStarts = 0;
  const tenant = { key: 'synthetic-archive', modules: ['collect'], driveConfigured: true,
    driveRootFolderId: 'synthetic-root', dataSources: { attachments: 'synthetic-attachments' } };
  const logger = { log() {}, warn() {}, error() {} };
  const router = { resolveGroupBinding: async () => ({ tenant, binding: { status: '啟用' }, resolution: 'active' }) };
  const platform = { notionRequest: async (path, options) => {
    assert.equal(options.tenantKey, tenant.key);
    assert.equal(acked, false, 'binary intake must be durable before HTTP acknowledgement');
    if (fails) throw new Error('Synthetic Notion outage');
    if (path.endsWith('/query')) return { results: [] };
    if (path === '/v1/pages') { writes++; return { id: 'synthetic-row', properties: options.body.properties }; }
    return { properties: Object.fromEntries(Object.entries(ATTACHMENT_ARCHIVE_PROPERTIES).map(([k,v]) => [k, {type:Object.keys(v)[0]}])) };
  } };
  platform.attachmentArchive = createAttachmentArchive({ platform, router, logger });
  platform.attachmentArchive.drain = async () => { assert.equal(acked, true); workerStarts++; };
  const dependencies = {
    'node:http': { default: { createServer(fn) { handler = fn; return {listen(){}}; } } },
    'node:crypto': { default: crypto },
    './core/bootstrap.js': { bootstrap: async () => ({ tenants: [tenant], line: { configured:true,isValidSignature:()=>true },
      router, dispatcher: {collectRoutes:()=>[],dispatch:async()=>{}}, portal: {}, modules:new Map(),platform,logger }) },
    './core/line-io/index.js': { createLineIo:async()=>({enabled:false,owns:()=>false,handle:async()=>false}),readLineIoBody:async r=>r.rawBody },
    './core/bank-line-reply-intake.js': {createBankLineReplyIntake:()=>({receive:async()=>false,drain:async()=>{}})},
    './core/direct-line.js': {routeDirectLineEvent:async()=>({matched:false})},
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
  const event = {type:'message',source:{type:'group',groupId:'synthetic-group'},timestamp:Date.now(),
    message:{id:'synthetic-file',type:'file',fileName:'large.pdf',fileSize:40647423}};
  const res = {};
  await handler({method:'POST',url:'/webhook/line',headers:{},rawBody:JSON.stringify({events:[event]})},res);
  assert.equal(res.status, fails ? 503 : 200);
  assert.equal(writes, fails ? 0 : 1);
  assert.equal(workerStarts, fails ? 0 : 1);
}
console.log('Real webhook verified: durable tenant binary intake before 200; Notion outage returns 503; worker starts after acknowledgement.');

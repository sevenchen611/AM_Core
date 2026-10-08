import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import crypto from 'node:crypto';
import { createAttachmentRetrieval, parseAttachmentRequest } from '../core/attachment-retrieval.js';

const rt = text => ({rich_text:[{text:{content:text}}]});
const tenant = { key:'synthetic-a',runtimeEnabled:true,driveConfigured:true,driveRootFolderId:'synthetic-root-a',
  dataSources:{attachments:'synthetic-attachments-a',messages:'synthetic-messages-a'} };
const other = { ...tenant,key:'synthetic-b' };
const md5 = 'a'.repeat(32);
function event(text='請提供這個檔案給我',extra={}) {
  return {type:'message',webhookEventId:'synthetic-request',replyToken:'synthetic-reply-token',timestamp:Date.now(),
    source:{type:'group',groupId:'synthetic-group-a',userId:'synthetic-user-a'},
    message:{type:'text',id:'synthetic-request-message',quotedMessageId:'synthetic-original',text},...extra};
}
function row(properties={}) {
  return { id:'synthetic-attachment',parent:{data_source_id:tenant.dataSources.attachments},properties:{
    '檔案名稱':rt('example.pdf'),'LINE 訊息 ID':rt('synthetic-original'),'LINE 群組 ID':rt('synthetic-group-a'),
    '來源類型':rt('group'),'保存狀態':{select:{name:'已保存'}},'Drive 檔案 ID':rt('synthetic-drive-file'),
    'Drive MD5':rt(md5),'檔案大小':{number:40647423},...properties } };
}
function source(properties={}) {
  return {id:'synthetic-source-page',parent:{data_source_id:tenant.dataSources.messages},properties:{
    'LINE 訊息 ID':rt('synthetic-original'),'LINE 群組 ID':rt('synthetic-group-a'),
    '訊息類型':{select:{name:'檔案'}},...properties }};
}
function matches(page,filter) {
  if (filter.and) return filter.and.every(f=>matches(page,f));
  const p=page.properties[filter.property];
  if(filter.relation) return p?.relation?.some(r=>r.id===filter.relation.contains);
  return (p?.rich_text||[]).map(x=>x.text.content).join('')===filter.rich_text.equals;
}
function harness(options={}) {
  const rows=options.rows||[row()],sources=options.sources||[],requests=[],replies=[],checks=[];
  let resolveCount=0;
  const bound={tenant,binding:{status:'啟用'}};
  const resolve=async()=> { resolveCount++; if(options.resolveError) throw Error('lookup failed');
    return options.rebound && resolveCount>1 ? { ...bound,tenant:other } : options.bound||bound; };
  const router={invalidate(){},invalidateDirect(){},resolveGroupBinding:resolve,resolveDirectAttachmentBinding:resolve};
  const platform={ notionRequest:async(path,opts)=> {
    assert.equal(opts.tenantKey,tenant.key);
    requests.push({path,opts});
    if(options.notionFailure) throw Error('Notion unavailable');
    if(path.endsWith('/query')) {
      const pool=path.includes(tenant.dataSources.attachments)?rows:sources;
      const found=pool.filter(p=>matches(p,opts.body.filter));
      return {results:found.slice(0,opts.body.page_size),has_more:found.length>opts.body.page_size};
    }
    if(path==='/v1/pages') {
      const page={id:'synthetic-saved-request',parent:opts.body.parent,properties:opts.body.properties};
      sources.push(page);return page;
    }
    const page=[...rows,...sources].find(p=>path.endsWith(p.id));
    if(!page) throw Error('Source unavailable');
    if(opts.method==='PATCH') Object.assign(page.properties,opts.body.properties);
    return page;
  },drive:{verifyWithinRoot:async(...args)=> {
    checks.push(args);if(options.driveFailure)throw Error('Drive unavailable');
    return {id:args[0],size:40647423,md5Checksum:md5,...options.driveMetadata};
  }},replyLineMessage:async(...args)=>{replies.push(args);if(options.replyFailure)throw Error('uncertain delivery');},
    pushLineMessage:()=>{throw Error('Must not push after an uncertain reply');}};
  if(options.centralArchive)platform.centralArchive=options.centralArchive;
  const service=createAttachmentRetrieval({platform,router,logger:{warn(){}},requestSpacingMs:0,
    ownsTransport:()=>Boolean(options.transport),resolveTransport:resolve});
  return {service,requests,replies,checks,platform};
}

test('explicit quote requests and exact filename commands; ordinary conversation passes through',()=> {
  for(const text of ['請提供我這個檔案','請提供我這張照片','請提供這張照片給我','請提供這個檔案給我','請提供這個檔案給我，謝謝','請幫我找這個檔案','請重新傳這份文件','麻煩幫我找一下這個檔案的下載連結','請重傳']) {
    assert.ok(parseAttachmentRequest(event(text)),text);
  }
  for(const text of ['請幫我找「明義街 46 號.pdf」','請幫我找『example.pdf』','請提供 example.pdf']) {
    assert.ok(parseAttachmentRequest(event(text)),text);
  }
  for(const text of ['請幫我找這個檔案並寄給客戶','我昨天說請提供這個檔案給我','這個檔案請 Maggie 明天上傳','請修改這個檔案','明義街水費已支付','請給我待辦']) {
    assert.equal(parseAttachmentRequest(event(text)),null,text);
  }
  const e=event('@小蝸 請提供這個檔案給我');e.message.mention={mentionees:[{index:0,length:3,isSelf:true}]};
  assert.ok(parseAttachmentRequest(e));
});
test('quoted original produces verified Drive link and preserves command outside task extraction',async()=>{
  const h=harness();assert.equal(await h.service.handle(event()),true);
  assert.match(h.replies[0][1],/example.pdf/);assert.match(h.replies[0][1],/https:\/\/drive.google.com\/file\/d\/synthetic-drive-file\/view/);
  assert.deepEqual(h.checks[0],['synthetic-drive-file',tenant.driveRootFolderId,tenant.key]);
  const write=h.requests.find(r=>r.path==='/v1/pages').opts.body;
  assert.equal(write.parent.data_source_id,tenant.dataSources.messages);
  assert.equal(write.properties['掛載狀態'].select.name,'一般對話');
  assert.match(write.children[0].paragraph.rich_text[0].text.content,/synthetic-original/);
});
for(const [name,props] of Object.entries({
  'different group':{'LINE 群組 ID':rt('synthetic-group-b')},
  'private original in a group':{'LINE 群組 ID':rt(''),'來源類型':rt('direct'),'LINE 使用者 ID':rt('synthetic-user-a')},
})) test(`reject ${name}`,async()=>{const h=harness({rows:[row(props)]});await h.service.handle(event());
  assert.equal(h.checks.length,0);assert.doesNotMatch(h.replies[0][1],/https:/);});
test('direct requests are restricted to the original private sender',async()=>{
  for(const user of ['synthetic-user-a','synthetic-user-b']) {
    const h=harness({rows:[row({'LINE 群組 ID':rt(''),'來源類型':rt('direct'),'LINE 使用者 ID':rt(user)})]});
    await h.service.handle(event(undefined,{source:{type:'user',userId:'synthetic-user-a'}}));
    assert.equal(h.checks.length,user==='synthetic-user-a'?1:0);
  }
});
test('a group attachment cannot be retrieved through a private chat',async()=>{
  const h=harness();await h.service.handle(event(undefined,{source:{type:'user',userId:'synthetic-user-a'}}));
  assert.equal(h.checks.length,0);
});
test('legacy index resolved through the exact binary message relation',async()=>{
  const h=harness({rows:[row({'LINE 訊息 ID':rt(''),'LINE 群組 ID':rt(''),'訊息':{relation:[{id:'synthetic-source-page'}]}})],sources:[source()]});
  await h.service.handle(event());assert.equal(h.checks.length,1);assert.match(h.replies[0][1],/https:/);
});
test('legacy preceding text relation is never used as an original file',async()=>{
  const h=harness({rows:[row({'LINE 訊息 ID':rt(''),'LINE 群組 ID':rt(''),'訊息':{relation:[{id:'synthetic-source-page'}]}})],
    sources:[source({'訊息類型':{select:{name:'文字'}}})]});
  await h.service.handle(event());assert.equal(h.checks.length,0);
});
test('an exact filename can retrieve a legacy file using its preserved group-context relation',async()=>{
  const h=harness({rows:[row({'LINE 訊息 ID':rt(''),'LINE 群組 ID':rt(''),'訊息':{relation:[{id:'synthetic-source-page'}]}})],
    sources:[source({'訊息類型':{select:{name:'文字'}}})]});
  const e=event('請幫我找「example.pdf」');delete e.message.quotedMessageId;
  await h.service.handle(e);assert.equal(h.checks.length,1);
});
test('foreign data source, trashed and source-group conflicts do not expose a link',async()=>{
  for(const bad of [Object.assign(row(),{parent:{data_source_id:'foreign-data-source'}}),Object.assign(row(),{archived:true})]) {
    const h=harness({rows:[bad]});await h.service.handle(event());assert.equal(h.checks.length,0);
  }
  const h=harness({rows:[row({'LINE 群組 ID':rt(''),'訊息':{relation:[{id:'synthetic-source-page'}]}})],
    sources:[source({'LINE 群組 ID':rt('synthetic-group-b')})]});
  await h.service.handle(event());assert.equal(h.checks.length,0);
});
test('duplicate quoted identity fails closed',async()=>{
  const h=harness({rows:[row(),{...row(),id:'synthetic-duplicate'}]});await h.service.handle(event());
  assert.equal(h.checks.length,0);assert.match(h.replies[0][1],/多筆/);
});
test('filename lookup only returns a unique file in the requesting conversation',async()=>{
  const e=event('請幫我找「example.pdf」');delete e.message.quotedMessageId;
  const h=harness({rows:[row(),row({'LINE 群組 ID':rt('synthetic-group-b')})]});await h.service.handle(e);
  assert.equal(h.checks.length,1);
  const dup=harness({rows:[row(),row()]});await dup.service.handle(e);assert.equal(dup.checks.length,0);
});
test('no quote and no filename asks for an exact source',async()=>{
  const e=event();delete e.message.quotedMessageId;const h=harness();await h.service.handle(e);
  assert.equal(h.checks.length,0);assert.match(h.replies[0][1],/回覆/);
});
test('missing or pending originals give honest status rather than a stale link',async()=>{
  for(const state of ['需要重傳','保存失敗','待保存','重試中']) {
    const h=harness({rows:[row({'保存狀態':{select:{name:state}}})]});await h.service.handle(event());
    assert.equal(h.checks.length,0);assert.doesNotMatch(h.replies[0][1],/https:/);
  }
});
test('current Drive ownership, size and checksum are required before delivery',async()=>{
  for(const options of [{driveFailure:true},{driveMetadata:{size:7}},{driveMetadata:{md5Checksum:'b'.repeat(32)}},
    {rows:[row({'Drive 檔案 ID':rt('invalid'),'Drive 連結':{url:'https://evil.invalid/'}})]}]) {
    const h=harness(options);await h.service.handle(event());assert.doesNotMatch(h.replies[0][1],/https:/);
  }
});
test('unbound, shadow, ambiguous, disabled or unavailable routing never reads originals or replies',async()=>{
  for(const options of [{bound:{}},{bound:{tenant,binding:{status:'影子記錄'}}},
    {bound:{tenant:{...tenant,runtimeEnabled:false},binding:{status:'啟用'}}},{resolveError:true}]) {
    const h=harness(options);await h.service.handle(event());assert.equal(h.requests.length,0);assert.equal(h.replies.length,0);
  }
});
test('re-bound group blocks a previously resolved link',async()=>{
  const h=harness({rebound:true});await h.service.handle(event());assert.equal(h.checks.length,1);assert.equal(h.replies.length,0);
});
test('transport groups use their configured sender-scoped resolver',async()=>{
  const h=harness({transport:true});await h.service.handle(event());assert.equal(h.checks.length,1);
  const denied=harness({transport:true,bound:{}});await denied.service.handle(event());assert.equal(denied.requests.length,0);
});
test('duplicate deliveries share one lookup/reply; uncertain token delivery never pushes',async()=>{
  const h=harness({replyFailure:true});await Promise.all([h.service.handle(event()),h.service.handle(event())]);
  await h.service.handle(event());assert.equal(h.checks.length,1);assert.equal(h.replies.length,1);
});
test('ordinary messages skip all storage and routing work',async()=>{
  const h=harness();assert.equal(await h.service.handle(event('今天下午開會')),false);assert.equal(h.requests.length,0);
});
test('a Notion failure produces a temporary message without disclosing a file',async()=>{
  const h=harness({notionFailure:true});await h.service.handle(event());assert.equal(h.checks.length,0);
  assert.doesNotMatch(h.replies[0][1],/https:/);assert.match(h.replies[0][1],/稍後再試/);
});

for (const status of [0, 400, 500]) test(`native core photo reply and transport fallback (${status})`, async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'synthetic-drive-file',size:'4096',md5Checksum:md5,mimeType:'image/png'}));
  const h = harness({rows:[row({'檔案大小':{number:4096}})],driveMetadata:{size:4096}});
  h.platform.publicBaseUrl='https://example.test';h.platform.publicLinkSecret='synthetic-signing';
  h.platform.getDriveAccessToken=async()=>'synthetic-oauth';
  const images=[];
  h.platform.replyLineMessages=async(token,messages)=>{
    images.push(messages);if(status)throw Object.assign(Error('synthetic rejection'),{lineStatus:status});
  };
  assert.equal(await h.service.handle(event('請提供我這張照片')),true);
  assert.equal(images.length,1);assert.equal(images[0][1].type,'image');
  assert.match(images[0][0].text,/token=/);
  assert.equal(h.replies.length,status===400?1:0,'never repeat after uncertain transport failure');
  if(status===400)assert.match(h.replies[0][1],/token=/);
});

function mentioned(){const e=event('@小蝸 請提供我這張照片');e.message.mention={mentionees:[{index:0,length:3,isSelf:true}]};return e;}
const archiveFile={file:{id:'synthetic-central-file',name:'preserved.jpg',size:42,md5Checksum:md5}};
for(const route of [{resolution:'not_found',tenant:null,binding:null},{resolution:'active',tenant,binding:{status:'影子記錄'}}]){
  test(`explicit quoted archive operation works without enabling project replies (${route.resolution}/${route.binding?.status})`,async()=>{
    let access=0,reads=0;
    const h=harness({bound:route,centralArchive:{canRetrieveQuote:async s=>{access++;assert.equal(s.groupId,'synthetic-group-a');return true;},original:async(id,scope)=>{reads++;assert.equal(id,'synthetic-original');assert.equal(scope.groupId,'synthetic-group-a');return archiveFile;}}});
    await h.service.handle(mentioned());assert.match(h.replies[0][1],/preserved.jpg/);assert.equal(h.requests.length,0);assert.equal(h.checks.length,0);assert.ok(access>=3);assert.ok(reads>=1);
  });
}
test('archive fallback never bypasses transport, disabled, ambiguous, failed routing or absent real mention',async()=>{
  for(const bound of [{resolution:'inactive'},{resolution:'ambiguous'},{resolution:'lookup_failed'},
    {resolution:'active',tenant:{...tenant,runtimeEnabled:false},binding:{status:'影子記錄'}}]){
    let accesses=0;const h=harness({bound,centralArchive:{canRetrieveQuote:async()=>{accesses++;return true;}}});
    await h.service.handle(mentioned());assert.equal(h.replies.length,0);assert.equal(accesses,0);
  }
  const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>{throw Error('must not query');}}});
  await h.service.handle(event());assert.equal(h.replies.length,0);
  const transport=harness({transport:true,bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>{throw Error('transport owns authorization');}}});
  await transport.service.handle(mentioned());assert.equal(transport.replies.length,0);
});
test('missing original and failed current-member checks cannot produce a file link',async()=>{
  for(const original of [null,{pending:true},{missing:true},{file:{...archiveFile.file,md5Checksum:'invalid'}}]){
    const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>true,original:async()=>original}});
    await h.service.handle(mentioned());assert.equal(h.replies.length,1);assert.doesNotMatch(h.replies[0][1],/https:/);assert.equal(h.requests.length,0);
  }
  const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>false}});
  await h.service.handle(mentioned());assert.equal(h.replies.length,0);
});
test('quote recovery is performed only from an explicit live request; downloadable links never initiate it',async()=>{
  let saved=null,recoveries=0;
  const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>true,original:async()=>saved,recoverQuoted:async e=>{assert.equal(e.message.quotedMessageId,'synthetic-original');recoveries++;saved=archiveFile;}}});
  await h.service.handle(mentioned());assert.equal(recoveries,1);assert.match(h.replies[0][1],/preserved.jpg/);
  await h.service.retrieve(h.service.archiveScope,mentioned(),parseAttachmentRequest(mentioned()));assert.equal(recoveries,1);
});
test('archive authorization revoked during source retrieval suppresses the reply',async()=>{
  let valid=true;const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>valid,original:async()=>{valid=false;return archiveFile;}}});
  await h.service.handle(mentioned());assert.equal(h.replies.length,0);
});
test('signed archive downloads retain explicit quote authorization and stop when membership is revoked',async t=>{
  const bytes=Buffer.from('synthetic archive original'),checksum=crypto.createHash('md5').update(bytes).digest('hex');
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async input=>new URL(input).searchParams.get('alt')==='media'?new Response(bytes)
    :Response.json({id:'synthetic-central-file',size:bytes.length,md5Checksum:checksum,mimeType:'application/pdf'}));
  let member=true;
  const h=harness({bound:{resolution:'not_found'},centralArchive:{canRetrieveQuote:async()=>member,
    original:async()=>({file:{...archiveFile.file,size:bytes.length,md5Checksum:checksum}})}});
  Object.assign(h.platform,{publicBaseUrl:'https://example.test',publicLinkSecret:'synthetic-secret',getDriveAccessToken:async()=> 'synthetic-token'});
  await h.service.handle(mentioned());const url=new URL(h.replies[0][1].split('\n').at(-1));
  const server=http.createServer((req,res)=>h.service.handleDownload(req,res,{url,tenant:h.service.archiveScope}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const local=`http://127.0.0.1:${server.address().port}`;
    const first=await realFetch(local);assert.equal(first.status,200);assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);
    member=false;assert.equal((await realFetch(local)).status,403);
    assert.equal(h.requests.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

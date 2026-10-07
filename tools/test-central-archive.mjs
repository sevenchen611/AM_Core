import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createArchiveStore,archiveRecord,digest} from '../core/central-archive/store.js';
import {archiveProperties,createArchiveNotion,richText,ARCHIVE_SCHEMA} from '../core/central-archive/notion.js';
import {archiveConfig} from '../core/central-archive/index.js';
import {archiveMedia,archiveReference,legacyMediaMessageId} from '../core/central-archive/media.js';

test('legacy generated media filenames identify the exact message and reject ordinary names',async()=>{
  const mid='12345678901234567890';assert.equal(legacyMediaMessageId('照片-'+mid+'.jpg'),mid);
  assert.equal(legacyMediaMessageId('meeting-'+mid+'.m4a'),mid);assert.equal(legacyMediaMessageId('report.pdf'),'');
  assert.equal(legacyMediaMessageId('照片-'+mid+'.jpg (1)'),'');assert.equal(legacyMediaMessageId('prefix-照片-'+mid+'.jpg'),'');
  const messagePage='a'.repeat(32),attachmentPage='b'.repeat(32);
  const job={key:'in:generated',conversation_key:'group',drive_folder_id:'folder',payload:{direction:'incoming',tenantKey:'tenant',sourceUrl:'https://www.notion.so/'+messagePage,event:{message:{id:mid}},media:{canonicalJobKey:'file:generated',legacyRelation:{messagePageId:messagePage,attachmentPageId:attachmentPage,match:'message-filename'}}}};
  const canonical={key:'file:generated',conversation_key:'group',drive_folder_id:'folder',state:'done',payload:{direction:'incoming',tenantKey:'tenant',sourceUrl:'https://www.notion.so/'+attachmentPage},result:{name:'照片-'+mid+'.jpg',driveId:'file',size:10,md5:'hash'}};
  const drive={verifyAttachment:async()=>({id:'file',name:canonical.result.name,size:10,md5Checksum:'hash'})};
  assert.equal((await archiveReference({job,canonical,drive})).driveId,'file');
  await assert.rejects(archiveReference({job,canonical:{...canonical,result:{...canonical.result,name:'照片-99999999999999999999.jpg'}},drive}),/reference_invalid/);
  assert.equal((await archiveReference({job,canonical:{...canonical,payload:{...canonical.payload,legacyFileName:'照片-'+mid+'.jpg'},result:{...canonical.result,name:'uploaded-image.jpg'}},drive})).driveId,'file');
});

test('legacy message references reuse only the related canonical file in the same conversation',async()=>{
  const messagePage='a'.repeat(32),attachmentPage='b'.repeat(32),canonicalKey='file:synthetic';
  const job={key:'in:synthetic',conversation_key:'conversation',drive_folder_id:'folder',payload:{direction:'incoming',tenantKey:'tenant',sourceUrl:'https://www.notion.so/'+messagePage,media:{canonicalJobKey:canonicalKey,legacyRelation:{messagePageId:messagePage,attachmentPageId:attachmentPage}}}};
  const canonical={key:canonicalKey,conversation_key:'conversation',drive_folder_id:'folder',state:'done',payload:{direction:'incoming',tenantKey:'tenant',sourceUrl:'https://www.notion.so/'+attachmentPage},result:{driveId:'saved',size:42,md5:'checksum',notionPageId:'attachment-row'}};
  let calls=0;const drive={verifyAttachment:async(id,parent,identity,size,md5)=>{calls++;assert.equal(identity.amCentralArchive,digest(canonicalKey));assert.equal(parent,'folder');assert.equal(size,42);assert.equal(md5,'checksum');return {id,name:'original.zip',size:42,md5Checksum:'checksum',webViewLink:'https://drive.google.com/file/d/saved/view'};}};
  const saved=await archiveReference({job,canonical,drive});assert.equal(saved.driveId,'saved');assert.equal(saved.canonicalJobKey,canonicalKey);assert.equal(saved.notionPageId,undefined);
  await assert.rejects(archiveReference({job,canonical:{...canonical,conversation_key:'another'},drive}),/reference_invalid/);
  await assert.rejects(archiveReference({job,canonical:{...canonical,payload:{...canonical.payload,tenantKey:'another'}},drive}),/reference_invalid/);
  await assert.rejects(archiveReference({job,canonical:{...canonical,payload:{...canonical.payload,sourceUrl:'https://www.notion.so/'+messagePage}},drive}),/reference_invalid/);
  await assert.rejects(archiveReference({job,canonical:{...canonical,result:{...canonical.result,canonicalJobKey:'cycle'}},drive}),/reference_invalid/);
  await assert.rejects(archiveReference({job,canonical:{...canonical,state:'pending'},drive}),/reference_pending/);
  assert.equal(calls,1);
});
import {createLine} from '../core/line.js';
const bot='U'+'0'.repeat(32),user='U'+'1'.repeat(32),group='C'+'2'.repeat(32);
const event=(id,source={type:'user',userId:user})=>({type:'message',webhookEventId:id,timestamp:Date.now(),source,replyToken:'private-token-'+id,message:{id,type:'text',text:'長文'.repeat(2500)}});
test('actual SQL persists all sources, rolls back atomically, deduplicates replay, and isolates bots',async()=>{
  const db=new PGlite();await db.exec(await fs.readFile(new URL('../core/central-archive/schema.sql',import.meta.url),'utf8'));
  const query=(...args)=>db.query(...args),pool={query,connect:async()=>({query,release(){}})};
  const store=createArchiveStore(pool,bot);
  try{
    await store.capture([event('a'),event('b',{type:'group',groupId:group,userId:user})]);
    await store.capture([event('a')]);assert.equal((await store.stats()).states.pending,2);
    const row=(await db.query('SELECT payload FROM central_archive.jobs LIMIT 1')).rows[0];
    assert.equal(row.payload.event.replyToken,undefined);assert.equal(row.payload.event.message.text.length,5000);
    const direct=archiveRecord(bot,event('a')),grp=archiveRecord(bot,event('b',{groupId:group,userId:user}));assert.notEqual(direct.conversation.key,grp.conversation.key);
    await assert.rejects(store.append([{...direct,key:'rollback'}, {key:'invalid',conversation:{}}]));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM central_archive.jobs WHERE key='rollback'")).rows[0].n,0);
    const outgoing=await store.outbound({replyToken:'private-token-a',messages:[{type:'text',text:'response'}],key:'reply:a'});
    await store.delivery(outgoing,'accepted');
    assert.equal((await db.query('SELECT payload FROM central_archive.jobs WHERE key=$1',[outgoing[0]])).rows[0].payload.delivery,'accepted');
    await store.outbound({replyToken:'private-token-a',messages:[{type:'text',text:'response'}],key:'reply:a'});
    assert.equal((await db.query('SELECT payload FROM central_archive.jobs WHERE key=$1',[outgoing[0]])).rows[0].payload.delivery,'accepted');
    await assert.rejects(store.outbound({replyToken:'private-token-a',messages:[{type:'text',text:'changed response'}],key:'reply:a'}),/identity_conflict/);
    assert.deepEqual((await db.query('SELECT payload FROM central_archive.jobs WHERE key=$1',[outgoing[0]])).rows[0].payload.messages,[{type:'text',text:'response'}]);
    await assert.rejects(store.outbound({replyToken:'unknown',messages:[],key:'bad'}),/origin_missing/);
    const other=createArchiveStore(pool,'U'+'9'.repeat(32));await other.capture([event('other')]);
    assert.equal((await store.stats()).conversations,2);assert.equal((await other.stats()).conversations,1);
    const next=await store.next(await pool.connect());assert.notEqual(next.key,'in:'+digest('other'));
    const batch=await store.nextBatch(await pool.connect());
    assert.equal(new Set(batch.map(x=>x.key)).size,batch.length);
    assert.equal(new Set(batch.map(x=>x.conversation_key)).size,batch.length);
    await db.query(`UPDATE central_archive.conversations SET database_id='db',data_source_id='ds',drive_folder_id='drive' WHERE bot_id=$1`,[bot]);
    const provisioned=await store.nextBatch(await pool.connect());
    assert.equal(provisioned.length,3);assert.ok(provisioned.every(x=>x.source_id===user||x.source_id===group));
    await store.capture(Array.from({length:10},(_,i)=>event('bounded-batch-'+i)));
    const bounded=await store.nextBatch(await pool.connect(),64);
    assert.equal(bounded.length,8);assert.equal(new Set(bounded.map(x=>x.key)).size,8);
    assert.ok(bounded.every(x=>x.source_id===user||x.source_id===group));
    assert.ok(bounded.every(x=>x.database_id==='db'&&x.drive_folder_id==='drive'));
  }finally{await db.close();}
});
test('Notion retains full long text and has only Drive URLs, with source evidence',()=>{
  const e=event('full'),job={...archiveRecord(bot,e),source_kind:'user',source_id:user,event_at:new Date().toISOString()};
  const properties=archiveProperties(job,{driveUrl:'https://drive.google.com/file/d/synthetic/view',name:'any.exe',size:123,attachmentStatus:'已保存'});
  assert.equal(properties['內容'].rich_text.map(x=>x.text.content).join(''),e.message.text);
  assert.equal(properties['Google Drive'].url,'https://drive.google.com/file/d/synthetic/view');
  assert.ok(!Object.values(ARCHIVE_SCHEMA).some(x=>x.files));assert.equal(richText('x'.repeat(5000)).length,3);
  const emoji='x'.repeat(1799)+'😀'.repeat(2000);assert.equal(richText(emoji).map(x=>x.text.content).join(''),emoji);
  assert.throws(()=>archiveConfig({AMCORE_CENTRAL_ARCHIVE_ENABLED:'1'}),/incomplete/);
});
test('Notion sink rejects databases under a different parent before writing',async()=>{
  const sink=createArchiveNotion({token:'synthetic',parentId:'a'.repeat(32),spacingMs:0,fetchImpl:async()=>Response.json({id:'db',parent:{page_id:'b'.repeat(32)},data_sources:[{id:'ds'}]})});
  await assert.rejects(sink.verify('db','ds'),/parent_mismatch/);
});
test('a durable write intent recovers a Notion create whose response was lost',async()=>{
  const calls=[],parent='a'.repeat(32);
  const sink=createArchiveNotion({token:'synthetic',parentId:parent,spacingMs:0,fetchImpl:async(url,init)=>{
    calls.push({url,method:init.method});
    if(url.endsWith('/databases/db'))return Response.json({parent:{page_id:parent},data_sources:[{id:'ds'}]});
    if(url.endsWith('/data_sources/ds'))return Response.json({properties:Object.fromEntries(Object.entries(ARCHIVE_SCHEMA).map(([k,v])=>[k,{type:Object.keys(v)[0]}]))});
    if(url.endsWith('/data_sources/ds/query'))return Response.json({results:[{id:'already-created'}]});
    if(url.endsWith('/pages/already-created')&&init.method==='PATCH')return Response.json({id:'already-created'});
    throw Error('unexpected create or request');
  }});
  const job={...archiveRecord(bot,event('lost-response')),database_id:'db',data_source_id:'ds',source_kind:'user',source_id:user,event_at:new Date().toISOString(),attempts:0};
  const saved=await sink.write(job,{notionWriteStarted:true});
  assert.equal(saved.id,'already-created');assert.ok(!calls.some(x=>x.url.endsWith('/pages')));
});
test('all binary formats stream to Drive and are checked against their content hash',async()=>{
  const bytes=Buffer.from('arbitrary installation or zip bytes'.repeat(300));let uploaded;
  const drive={findAttachment:async()=>null,uploadStream:async(stream,name,type,parent,size,metadata)=>{
    const parts=[];for await(const x of stream)parts.push(x);uploaded={bytes:Buffer.concat(parts),name,parent,size,metadata};return {id:'file'};},
    verifyAttachment:async(id,parent,identity,size,md5)=>({id,name:uploaded.name,size,md5Checksum:md5,webViewLink:'https://drive.google.com/file/d/file/view'})};
  const line={streamLineContent:async()=>({stream:new Blob([bytes]).stream(),contentLength:bytes.length,contentType:'application/octet-stream'}),resolveLineFilename:m=>m.fileName};
  const job={key:'synthetic-binary',drive_folder_id:'target',payload:{event:{message:{id:'file',type:'file',fileName:'setup.exe'}}}};
  const result=await archiveMedia({job,drive,line});assert.deepEqual(uploaded.bytes,bytes);assert.equal(result.name,'setup.exe');assert.equal(result.sha256.length,64);assert.equal(result.attachmentStatus,'已保存');
});
test('outbound sends persist first and record provider acceptance; intake failure prevents sending',async()=>{
  const original=globalThis.fetch;const order=[];
  globalThis.fetch=async()=>{order.push('send');return new Response('{}',{status:200});};
  const line=createLine({channelAccessToken:'synthetic',channelSecret:'synthetic',logger:{info(){},warn(){}}});
  try{
    line.setArchiveObserver({before:async()=>{order.push('persist');return 'key';},after:async(key,status)=>order.push(status)});
    await line.replyLineMessage('synthetic','answer');assert.deepEqual(order,['persist','send','accepted']);order.length=0;
    line.setArchiveObserver({before:async()=>{throw Error('db_down');}});
    await assert.rejects(line.pushLineMessage(user,'answer'),/db_down/);assert.deepEqual(order,[]);
  }finally{line.setArchiveObserver(null);globalThis.fetch=original;}
});

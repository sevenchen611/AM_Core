import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createArchiveStore,archiveRecord,digest} from '../core/central-archive/store.js';
import {archiveProperties,createArchiveNotion,richText,ARCHIVE_SCHEMA} from '../core/central-archive/notion.js';
import {archiveConfig,createCentralArchive} from '../core/central-archive/index.js';
import {archiveMedia,archiveReference,legacyMediaMessageId} from '../core/central-archive/media.js';
import {preview,prepareEvent} from '../core/leaf-calendar/extract.js';

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

test('a legacy empty or partial body cannot replace authoritative webhook media or event content',()=>{
  for(const type of ['image','file','audio','video']){const e={...event('authority-'+type),message:{id:'authority-'+type,type,fileName:'original.bin',fileSize:123}};
    const record=archiveRecord(bot,e),job={...record,event_at:record.at,payload:{...record.payload,history:true,content:'legacy summary'}};
    assert.equal(archiveProperties(job)['內容'].rich_text.map(x=>x.text.content).join(''),JSON.stringify(record.payload.event.message));
    job.payload.content='';assert.equal(archiveProperties(job)['內容'].rich_text.map(x=>x.text.content).join(''),JSON.stringify(record.payload.event.message));
    job.payload.evidenceQuality='historical';assert.equal(archiveProperties(job)['內容'].rich_text.length,0);
  }
  const e={type:'memberJoined',timestamp:Date.now(),webhookEventId:'joined',source:{groupId:group},joined:{members:[{type:'user',userId:user}]}};
  const record=archiveRecord(bot,e),job={...record,event_at:record.at,payload:{...record.payload,content:'older event'}};
  assert.equal(archiveProperties(job)['內容'].rich_text.map(x=>x.text.content).join(''),JSON.stringify(record.payload.event));
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

test('calendar confirmation cards survive JSON storage before sending and preserve retry conflicts',async t=>{
  const db=new PGlite();await db.exec(await fs.readFile(new URL('../core/central-archive/schema.sql',import.meta.url),'utf8'));
  const query=(...args)=>db.query(...args),pool={query,connect:async()=>({query,release(){}})};
  const store=createArchiveStore(pool,bot);
  const line=createLine({channelAccessToken:'synthetic',channelSecret:'synthetic',logger:{info(){},warn(){}}});
  const card=preview({request_id:'a'.repeat(48),revision:1,payload:prepareEvent({topic:'測試讀書會',date:'2026-10-12',time:'09:40',endTime:'13:30',location:'測試會議室'},'synthetic')});
  // Optional properties exist in builders but disappear in the JSON sent to LINE.
  card.contents.footer.contents[1].color=undefined;
  const wire=JSON.parse(JSON.stringify(card));let sent=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const archived=(await db.query("SELECT payload->'messages' AS messages FROM central_archive.jobs WHERE payload->>'direction'='outgoing'")).rows;
    assert.equal(archived.length,1);assert.deepEqual(archived[0].messages,[wire]);
    assert.deepEqual(JSON.parse(options.body).messages,[wire]);sent++;
    return new Response('{}',{status:200});
  });
  line.setArchiveObserver({before:request=>store.outbound(request),after:(keys,status)=>store.delivery(keys,status)});
  try{
    const retryKey='12345678-1234-4123-8123-123456789abc';
    await line.pushLineMessage(user,card,null,{retryKey});
    await line.pushLineMessage(user,wire,null,{retryKey});assert.equal(sent,2);
    assert.equal((await db.query("SELECT payload->>'delivery' AS delivery FROM central_archive.jobs")).rows[0].delivery,'accepted');
    const changed=structuredClone(wire);changed.altText='另一筆活動';
    await assert.rejects(line.pushLineMessage(user,changed,null,{retryKey}),/archive_outbound_identity_conflict/);
    assert.equal(sent,2);
  }finally{line.setArchiveObserver(null);await db.close();}
});

import {createQuotedArchiveAccess,quotedRecoveryRecord} from '../core/central-archive/quoted-access.js';
test('quote access isolates current OA, source kind and member; failed identity checks fail closed',async()=>{
  const db=new PGlite();await db.exec(await fs.readFile(new URL('../core/central-archive/schema.sql',import.meta.url),'utf8'));
  const query=(...args)=>db.query(...args),pool={query,connect:async()=>({query,release(){}})};
  try{
    await createArchiveStore(pool,bot).capture([event('request',{type:'group',groupId:group,userId:user})]);
    let checked=0;const line={lineGet:async pathname=>{checked++;assert.equal(pathname,`/v2/bot/group/${group}/member/${user}`);return {userId:user};}};
    const access=createQuotedArchiveAccess({pool,botId:bot,line});
    assert.equal(await access({type:'group',groupId:group,userId:user}),true);
    assert.equal(await access({type:'user',userId:user}),false);
    assert.equal(await access({type:'room',roomId:group,userId:user}),false);
    assert.equal(await access({type:'group',groupId:group}),false);
    assert.equal(await createQuotedArchiveAccess({pool,botId:'U'+'9'.repeat(32),line})({type:'group',groupId:group,userId:user}),false);
    assert.equal(checked,1);
    assert.equal(await createQuotedArchiveAccess({pool,botId:bot,line:{lineGet:async()=>({userId:'other'})}})({type:'group',groupId:group,userId:user}),false);
    await assert.rejects(createQuotedArchiveAccess({pool,botId:bot,line:{lineGet:async()=>{throw Error('membership_unavailable');}}})({type:'group',groupId:group,userId:user}));
  }finally{await db.close();}
});
test('quote recovery retains request evidence and never invents original sender or date',()=>{
  const e=event('request',{type:'group',groupId:group,userId:user});e.message.quotedMessageId='12345678901234567';e.message.mention={mentionees:[{isSelf:true}]};
  const record=quotedRecoveryRecord(bot,e);
  assert.equal(record.key,'in:'+digest(bot+':message:'+e.message.quotedMessageId));assert.equal(record.payload.evidenceQuality,'quoted-message-recovery');
  assert.equal(record.payload.event.source.userId,undefined);assert.equal(record.payload.quoteRecovery.originalTimestampUnknown,true);
  assert.equal(record.payload.quoteRecovery.originalSenderUnknown,true);assert.equal(record.payload.quoteRecovery.requestKey,'in:'+digest(bot+':message:request'));
  assert.equal(record.replyToken,undefined);assert.equal(record.binary,true);
  const props=archiveProperties({...record,payload:record.payload,event_at:record.at});
  assert.match(props['來源說明'].rich_text.map(x=>x.text.content).join(''),/原作者與原發送時間未知/);
  delete e.message.mention;assert.throws(()=>quotedRecoveryRecord(bot,e),/quote_invalid/);
});

test('actual central factory queues quote recovery only after verifying the persisted raw request',async t=>{
  const db=new PGlite();await db.exec(await fs.readFile(new URL('../core/central-archive/schema.sql',import.meta.url),'utf8'));
  const query=(...args)=>db.query(...args),pool={query,connect:async()=>({query:async(sql,...args)=>sql.includes('pg_try_advisory_lock')?{rows:[{locked:false}]}:query(sql,...args),release(){}})};
  const e=event('request',{type:'group',groupId:group,userId:user});e.message.quotedMessageId='12345678901234567';e.message.mention={mentionees:[{isSelf:true}]};
  await createArchiveStore(pool,bot).capture([e]);
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'synthetic-root',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}}));
  const central=await createCentralArchive({env:{AMCORE_CENTRAL_ARCHIVE_ENABLED:'1',AMCORE_CENTRAL_ARCHIVE_NOTION_PARENT_PAGE_ID:'a'.repeat(32),AMCORE_CENTRAL_ARCHIVE_DRIVE_ROOT_FOLDER_ID:'synthetic-root',AMCORE_CENTRAL_ARCHIVE_BOT_USER_ID:bot,NOTION_TOKEN:'synthetic'},pool,
    line:{configured:true,lineGet:async p=>p==='/v2/bot/info'?{userId:bot}:{userId:user},setArchiveObserver(){}},
    drive:{configured:true,getAccessToken:async()=> 'synthetic'},notion:{request:async()=>({archived:false})},logger:{warn(){},error(){}}});
  try{
    const now=Date.now(),probe={...e,timestamp:now,message:{...e.message,id:'task-source',text:'@同仁 請整理本週客訴清單'}};
    await createArchiveStore(pool,bot).capture([probe]);
    const querySource={from:new Date(now-1000).toISOString(),to:new Date(now+1000).toISOString(),contains:'本週客訴清單'};
    assert.equal((await central.taskSources(querySource)).length,1);
    await assert.rejects(central.taskSources({...querySource,contains:'xx'}),/invalid_task_source_query/);
    await assert.rejects(central.taskSources({...querySource,from:new Date(now-610000).toISOString()}),/invalid_task_source_query/);
    await assert.rejects(central.taskSources({...querySource,from:new Date(now-86400001).toISOString(),contains:'本週客訴清單完整結果'}),/invalid_task_source_query/);
    const roomProbe={...probe,source:{type:'room',roomId:'R'+'7'.repeat(32),userId:user},message:{...probe.message,id:'room-task-source',text:'@同仁 請整理本週客訴清單完整結果'}};
    await createArchiveStore(pool,bot).capture([roomProbe]);
    assert.equal((await central.taskSources({...querySource,contains:'本週客訴清單完整結果',from:new Date(now-610000).toISOString()})).length,1);
    await db.query("UPDATE central_archive.jobs SET payload=jsonb_set(payload,'{evidenceQuality}','\"legacy\"'::jsonb) WHERE key=$1",['in:'+digest(bot+':message:task-source')]);
    const remaining=await central.taskSources(querySource);assert.equal(remaining.length,1);assert.equal(remaining[0].event.source.type,'room');
    await central.recoverQuoted(e);await central.recoverQuoted(e);
    const row=(await db.query('SELECT payload FROM central_archive.jobs WHERE key=$1',['in:'+digest(bot+':message:'+e.message.quotedMessageId)])).rows[0];
    assert.equal(row.payload.evidenceQuality,'quoted-message-recovery');assert.equal(row.payload.quoteRecovery.originalSenderUnknown,true);
    assert.equal(row.payload.event.source.userId,undefined);
    await assert.rejects(central.recoverQuoted({...e,message:{...e.message,quotedMessageId:'99999999999999999'}}),/quote_invalid/);
    await db.query("UPDATE central_archive.jobs SET payload=jsonb_set(payload,'{evidenceQuality}','\"legacy\"'::jsonb) WHERE key=$1",['in:'+digest(bot+':message:request')]);
    await assert.rejects(central.recoverQuoted(e),/quote_invalid/);
  }finally{await central.close();await db.close();}
});

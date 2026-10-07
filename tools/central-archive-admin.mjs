// Run in the target project with its own environment. Never print production message bodies or secrets.
import fs from 'node:fs/promises';
import {Pool} from 'pg';
import {archiveDatabaseConfig,archiveConfig,createCentralArchive} from '../core/central-archive/index.js';
import {createArchiveStore,archiveRecord,digest} from '../core/central-archive/store.js';
import {createArchiveNotion} from '../core/central-archive/notion.js';
import {createLine} from '../core/line.js';
import {createDrive} from '../core/drive.js';
import {loadTenants,buildDataSourceRegistry} from '../core/tenants.js';
import {createNotion} from '../core/notion.js';
import {legacyMediaMessageId} from '../core/central-archive/media.js';
const env=process.env,mode=process.argv[2]||'--status';
const config=archiveConfig(env);
if(!config.enabled)throw Error('Central archive environment is required');
const line=createLine({channelAccessToken:env.LINE_CHANNEL_ACCESS_TOKEN,channelSecret:env.LINE_CHANNEL_SECRET,logger:{warn(){},info(){}}});
const bot=await line.lineGet('/v2/bot/info',{timeoutMs:15000});if(bot.userId!==config.botId)throw Error('Archive bot differs from the selected OA');
const connection=archiveDatabaseConfig(env);
const pool=new Pool({...connection,max:3,connectionTimeoutMillis:10000});
const store=createArchiveStore(pool,config.botId);
const notion=createArchiveNotion({token:env.NOTION_TOKEN,parentId:config.parentId});
const tenants=loadTenants(env,{warn(){}}).filter(t=>t.runtimeEnabled!==false&&t.notionConfigured);
const sourceNotion=createNotion({token:env.NOTION_TOKEN,version:'2025-09-03',registry:buildDataSourceRegistry(tenants,{warn(){}})});
const plain=p=>(p?.rich_text||p?.title||[]).map(x=>x.plain_text||x.text?.content||'').join('');
function driveId(value){try{const u=new URL(value);if(!['drive.google.com','docs.google.com'].includes(u.hostname))return '';
  return u.pathname.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([\w-]+)/)?.[1]||u.searchParams.get('id')||'';}catch{return '';}}
async function allPages(id){const pages=[];let cursor;do{const r=await sourceNotion.notionRequest(`/v1/data_sources/${encodeURIComponent(id)}/query`,{method:'POST',body:{
  page_size:100,...(cursor?{start_cursor:cursor}:{})}});pages.push(...r.results);cursor=r.has_more?r.next_cursor:null;}while(cursor);return pages;}
function sourceFor(properties,tenant){
  const id=plain(properties['LINE 群組 ID'])||plain(properties['LINE 使用者 ID']);
  const kind=id.startsWith('C')?'group':id.startsWith('R')?'room':id.startsWith('U')?'user':'unknown';
  const sourceId=kind==='unknown'?`unknown:${tenant.key}`:id;
  return {key:digest(`${config.botId}:${kind}:${sourceId}`),botId:config.botId,kind,id:sourceId,
    name:kind==='unknown'?`歷史待確認來源 · ${tenant.displayName}`:''};
}
async function register(c){await pool.query(`INSERT INTO central_archive.conversations(key,bot_id,source_kind,source_id,display_name)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO UPDATE SET display_name=CASE WHEN EXCLUDED.display_name<>''
  THEN EXCLUDED.display_name ELSE conversations.display_name END`,[c.key,c.botId,c.kind,c.id,c.name||'']);}
async function seed(){
  const report={messages:0,attachments:0,sqlEvents:0,boundGroups:0,unknownSourceMessages:0,missingAttachmentSources:0,tenants:[]};
  const raw=await pool.query('SELECT payload FROM line_io.line_io_events ORDER BY seq');
  const rawRecords=[];
  for(const row of raw.rows){const event=row.payload.event;if(!event?.source||!event.timestamp)continue;
    try{const r=archiveRecord(config.botId,event);r.payload.history=true;r.payload.tenantKey=row.payload.tenantKey||'';
      rawRecords.push(r);report.sqlEvents++;}catch(error){if(error.message!=='archive_source_invalid')throw error;}}
  for(let i=0;i<rawRecords.length;i+=100)await store.append(rawRecords.slice(i,i+100));
  console.log(JSON.stringify({phase:'seed-sql',events:report.sqlEvents}));
  const existingRows=await pool.query(`SELECT j.key AS job_key,c.* FROM central_archive.jobs j JOIN central_archive.conversations c ON c.key=j.conversation_key`);
  const existingSources=new Map(existingRows.rows.map(x=>[x.job_key,{key:x.key,botId:x.bot_id,kind:x.source_kind,id:x.source_id,name:x.display_name}]));
  const messagePages=new Map(),messageIds=new Map();
  for(const tenant of tenants){
    const count={key:tenant.key,messages:0,attachments:0};
    let batch=[];const aliases=new Map();
    const bindings=await allPages(tenant.dataSources.groupBindings);
    for(const b of bindings){const c=sourceFor(b.properties,tenant);if(c.kind==='unknown')continue;
      c.name=plain(b.properties['群組名稱'])||plain(b.properties['名稱']);await register(c);report.boundGroups++;}
    for(const page of await allPages(tenant.dataSources.messages)){
      const p=page.properties;let c=sourceFor(p,tenant);
      const messageId=plain(p['LINE 訊息 ID']);
      const type=p['訊息類型']?.select?.name||'文字';
      const at=p['時間']?.date?.start||page.created_time;
      const payload={direction:'incoming',history:true,evidenceQuality:'historical',tenantKey:tenant.key,sourceUrl:page.url,
        content:plain(p['內容']),sender:plain(p['發送者']),note:'從原租戶 Notion 訊息資料庫補入；保留目前可取得的內容。'};
      if(messageId)payload.event={type:'message',message:{id:messageId,type:{'文字':'text','照片':'image','圖片':'image','檔案':'file','音訊':'audio','語音':'audio','影片':'video'}[type]||'text',text:payload.content}};
      const key=messageId?`in:${digest(`${config.botId}:message:${messageId}`)}`:`legacy:${digest(page.id)}`;
      if(existingSources.has(key))c=existingSources.get(key);
      if(c.kind==='unknown'){report.unknownSourceMessages++;payload.note+=' 原資料未記錄對話 ID，暫存待確認來源資料庫。';}
      const record={conversation:c,key,at,payload,binary:['image','audio','video','file'].includes(payload.event?.message?.type)};messagePages.set(page.id,record);
      if(messageId)messageIds.set(`${tenant.key}:${messageId}`,record);
      existingSources.set(key,c);batch.push(record);
      if(batch.length===100){await store.append(batch);batch=[];}
      report.messages++;count.messages++;
    }
    await store.append(batch);batch=[];
    if(tenant.dataSources.attachments)for(const page of await allPages(tenant.dataSources.attachments)){
      const p=page.properties,messageId=plain(p['LINE 訊息 ID']);
      const relation=p['訊息']?.relation?.[0]?.id;const message=messagePages.get(relation);
      const c=message?.conversation||sourceFor(p,tenant);
      const id=plain(p['Drive 檔案 ID'])||driveId(p['Drive 連結']?.url);
      const files=Object.entries(p).flatMap(([property,prop])=>(prop.files||[]).map((file,index)=>({property,index,...file})));
      const candidates=id?[{driveId:id,name:plain(p['檔案名稱']),md5:plain(p['Drive MD5']),sha256:plain(p['原檔 SHA256'])}]:files.map(f=>f.type==='file'?{
        notionPageId:page.id,property:f.property,index:f.index,name:f.name}:{driveId:driveId(f.external?.url),name:f.name}).filter(f=>f.driveId||f.notionPageId);
      if(!candidates.length&&messageId)candidates.push({lineId:messageId,name:plain(p['檔案名稱'])});
      if(!candidates.length){report.missingAttachmentSources++;candidates.push({missingSource:true,name:plain(p['檔案名稱'])||'來源待補附件'});}
      for(const media of candidates){
        const key=candidates.length===1&&messageId?`in:${digest(`${config.botId}:message:${messageId}`)}`:`file:${digest(page.id+':'+(media.index||0))}`;
        const legacyFileName=plain(p['檔案名稱']);
        const payload={...(message?.payload||{direction:'incoming'}),history:true,tenantKey:tenant.key,media,legacyFileName,
          sourceUrl:page.url,sender:message?.payload?.sender||'',content:message?.payload?.content||plain(p['檔案名稱']),
          event:{type:'message',message:{id:messageId,type:plain(p['附件類型'])||'file',fileName:media.name}}};
        // Upgrade a text-only imported row to a binary job while preserving any full raw webhook text.
        batch.push({conversation:c,key,at:p['日期']?.date?.start||page.created_time,payload,binary:true});
        if(batch.length===100){await store.append(batch);batch=[];}
        report.attachments++;count.attachments++;
        const namedMessage=messageIds.get(`${tenant.key}:${legacyMediaMessageId(legacyFileName||media.name)}`);
        const linked=message?.binary?message:namedMessage;
        if(candidates.length===1&&linked?.binary&&linked.key!==key&&linked.conversation.key===c.key){
          const messagePageId=linked.payload.sourceUrl?.match(/([a-f0-9]{32})(?:\?|$)/i)?.[1];
          if(messagePageId){if(!aliases.has(linked.key))aliases.set(linked.key,new Map());
            aliases.get(linked.key).set(key,{...linked,binary:true,payload:{...linked.payload,media:{canonicalJobKey:key,
              legacyRelation:{messagePageId,attachmentPageId:page.id,match:linked===message?'notion-relation':'message-filename'}},
              note:(linked.payload.note||'')+' 舊附件來源已核對，引用相同對話的既有原檔。'}});
          }
        }
      }
    }
    await store.append(batch);
    const unambiguous=[...aliases.values()].filter(x=>x.size===1).map(x=>[...x.values()][0]);
    for(let i=0;i<unambiguous.length;i+=100)await store.append(unambiguous.slice(i,i+100));
    count.attachmentReferences=unambiguous.length;count.ambiguousAttachmentReferences=[...aliases.values()].filter(x=>x.size>1).length;
    report.tenants.push(count);console.log(JSON.stringify({phase:'seed',tenant:count.key,messages:count.messages,attachments:count.attachments}));
  }
  if(env.AMCORE_CENTRAL_ARCHIVE_REPORT_PATH)await fs.writeFile(env.AMCORE_CENTRAL_ARCHIVE_REPORT_PATH,JSON.stringify(report,null,2));
  return report;
}
try{
  if(mode==='--migrate'){
    if(!env.ARCHIVE_MIGRATION_OWNER_DATABASE_URL)throw Error('Explicit target-local migration owner connection required');
    const owner=new Pool({connectionString:env.ARCHIVE_MIGRATION_OWNER_DATABASE_URL,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000});
    try{await owner.query(await fs.readFile(new URL('../core/central-archive/schema.sql',import.meta.url),'utf8'));
      const role=decodeURIComponent(new URL(connection.connectionString).username);if(!/^[a-zA-Z0-9_]+$/.test(role))throw Error('Invalid runtime database role');
      await owner.query(`GRANT USAGE ON SCHEMA central_archive TO "${role}"`);
      await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA central_archive TO "${role}"`);
      console.log(JSON.stringify({migration:'complete',runtimeRole:role}));
    }finally{await owner.end();}
  }else if(mode==='--seed-history'){
    // Publish source relations before the worker can download media. Webhook
    // persistence remains available while this migration lock is held.
    const db=await pool.connect(),lockId=parseInt(digest(config.botId).slice(0,7),16);
    try{await db.query('SELECT pg_advisory_lock(10072026,$1)',[lockId]);console.log(JSON.stringify(await seed()));}
    finally{await db.query('SELECT pg_advisory_unlock(10072026,$1)',[lockId]);db.release();}
  }
  else if(mode==='--seed-directory'){
    const groups=await pool.query('SELECT group_id,name FROM line_directory.groups');let count=0;
    for(const g of groups.rows){if(!/^C[a-f0-9]{32}$/i.test(g.group_id))continue;
      await register({key:digest(`${config.botId}:group:${g.group_id}`),botId:config.botId,kind:'group',id:g.group_id,name:g.name});count++;}
    console.log(JSON.stringify({directoryGroups:count}));
  }else if(mode==='--seed-memory'){
    const owner=new Pool({connectionString:env.ARCHIVE_MIGRATION_OWNER_DATABASE_URL,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000});
    const report=[];
    try{
      const registered=await owner.query('SELECT tenant_key,tenant_id FROM am_memory.tenants');
      const memoryTenants=new Map(registered.rows.map(x=>[x.tenant_key,x.tenant_id]));
      for(const tenant of tenants){
      const memoryTenantId=tenant.tenantId||tenant.operationalMemory?.tenantId||memoryTenants.get(tenant.key);
      if(!memoryTenantId){report.push({tenant:tenant.key,rawMessages:0,reason:'no_registered_memory_tenant'});continue;}
      const db=await owner.connect();let sources;
      try{await db.query('BEGIN');await db.query("SELECT set_config('app.tenant_id',$1,true)",[memoryTenantId]);
        sources=await db.query(`SELECT raw_envelope,original_content,occurred_at FROM am_memory.raw_messages
          WHERE tenant_id=$1 AND source_system='line' ORDER BY occurred_at`,[memoryTenantId]);await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
      const records=[];let skipped=0;
      for(const row of sources.rows){
        const event={...row.raw_envelope,timestamp:row.raw_envelope.timestamp||new Date(row.occurred_at).getTime()};
        if(event.message?.type==='text')event.message={...event.message,text:row.original_content??event.message.text??''};
        try{const r=archiveRecord(config.botId,event);r.payload.history=true;r.payload.tenantKey=tenant.key;records.push(r);}
        catch(error){if(error.message==='archive_source_invalid'||error.message==='archive_event_invalid')skipped++;else throw error;}
      }
      for(let i=0;i<records.length;i+=100)await store.append(records.slice(i,i+100));
      report.push({tenant:tenant.key,rawMessages:sources.rows.length,imported:records.length,missingSource:skipped});
    }}finally{await owner.end();}
    console.log(JSON.stringify({memorySources:report}));
  }
  else if(mode==='--provision'){
    const drive=createDrive({clientId:env.GOOGLE_OAUTH_CLIENT_ID,clientSecret:env.GOOGLE_OAUTH_CLIENT_SECRET,refreshToken:env.GOOGLE_OAUTH_REFRESH_TOKEN});
    const db=await pool.connect();const lockId=parseInt(digest(config.botId).slice(0,7),16);
    try{
      await db.query('SELECT pg_advisory_lock(10072026,$1)',[lockId]);
      const rows=await db.query('SELECT * FROM central_archive.conversations WHERE bot_id=$1 ORDER BY created_at',[config.botId]);
      let count=0;for(let c of rows.rows){
        if(!c.display_name){
          c.display_name=c.source_kind==='group'?await line.resolveGroupName(c.source_id):c.source_kind==='user'?await line.resolveSenderName({userId:c.source_id}):'';
          c.display_name ||= `${({group:'群組',room:'聊天室',user:'個人對話',unknown:'歷史待確認來源'}[c.source_kind]||c.source_kind)} · ${c.source_id.slice(-8)}`;
        }
        c=await notion.ensureDatabase(c);
        c.drive_folder_id ||= await drive.ensureFolder(`${(c.display_name||c.source_kind).slice(0,100)} · ${c.key.slice(0,12)}`,config.rootId);
        await store.target(c.key,c);count++;if(count%10===0)console.log(JSON.stringify({phase:'provision',done:count,total:rows.rows.length}));
      }
      console.log(JSON.stringify({provisioned:count}));
    }finally{await db.query('SELECT pg_advisory_unlock(10072026,$1)',[lockId]);db.release();}
  }
  else if(mode==='--canary'){
    const drive=createDrive({clientId:env.GOOGLE_OAUTH_CLIENT_ID,clientSecret:env.GOOGLE_OAUTH_CLIENT_SECRET,refreshToken:env.GOOGLE_OAUTH_REFRESH_TOKEN});
    const archive=await createCentralArchive({env:{...env,AMCORE_CENTRAL_ARCHIVE_CAPTURE_ENABLED:'0'},line,drive,pool,notion,logger:{warn(){},error(){}}});
    const db=await pool.connect(),lockId=parseInt(digest(config.botId).slice(0,7),16);const proof=[];
    try{await db.query('SELECT pg_advisory_lock(10072026,$1)',[lockId]);
      for(const kind of ['group','user','binary']){
        const r=await db.query(`SELECT j.*,j.has_binary AS "binary",c.source_kind,c.source_id,c.display_name,c.database_id,c.data_source_id,c.drive_folder_id
          FROM central_archive.jobs j JOIN central_archive.conversations c ON c.key=j.conversation_key WHERE c.bot_id=$1
          AND CASE WHEN $2='binary' THEN j.payload #>> '{media,driveId}' IS NOT NULL
          ELSE c.source_kind=$2 AND NOT j.has_binary END
          ORDER BY length(COALESCE(j.payload #>> '{event,message,text}',j.payload->>'content','')) DESC LIMIT 1`,[config.botId,kind]);
        const job=r.rows[0];if(!job){proof.push({kind,available:false});continue;}
        await archive.processJob(job);
        const saved=(await db.query('SELECT result FROM central_archive.jobs WHERE key=$1',[job.key])).rows[0].result;
        const page=await notion.request('/pages/'+encodeURIComponent(saved.notionPageId));
        const expected=job.payload.event?.message?.text??job.payload.content;
        const item={kind,available:true,sourceMatches:plain(page.properties['LINE 對話 ID'])===job.source_id,
          textLength:expected?.length||0,textMatches:expected===undefined||plain(page.properties['內容'])===expected,
          notionPageId:saved.notionPageId,notionBinaryProperties:Object.values(page.properties).filter(p=>p.type==='files').length};
        if(kind==='binary'){
          const file=await drive.verifyAttachment(saved.driveId,job.drive_folder_id,{amCentralArchive:digest(job.key)},saved.size,saved.md5);
          item.driveFileId=file.id;item.bytes=Number(file.size);item.md5Matches=file.md5Checksum===saved.md5;
          item.withinSelectedRoot=Boolean(await drive.verifyWithinRoot(file.id,config.rootId,''));
        }
        if(!item.sourceMatches||!item.textMatches||item.notionBinaryProperties)throw Error('archive_canary_mismatch');
        proof.push(item);
      }
      if(process.argv[3])await fs.writeFile(process.argv[3],JSON.stringify({checkedAt:new Date().toISOString(),proof},null,2));
      console.log(JSON.stringify(proof));
    }finally{await db.query('SELECT pg_advisory_unlock(10072026,$1)',[lockId]);db.release();await archive.close();}
  }
  else if(mode==='--drain'){
    const drive=createDrive({clientId:env.GOOGLE_OAUTH_CLIENT_ID,clientSecret:env.GOOGLE_OAUTH_CLIENT_SECRET,refreshToken:env.GOOGLE_OAUTH_REFRESH_TOKEN,logger:{warn(){}}});
    const archive=await createCentralArchive({env,line,drive,pool,notion,logger:{warn(){},error(){}}});
    try{await archive.drain();console.log(JSON.stringify({...archive.health(),...await store.stats()}));}finally{await archive.close();}
  }else if(mode==='--inventory'){
    const inventory=[];for(const tenant of tenants){const item={key:tenant.key};for(const type of ['messages','attachments','groupBindings']){
      const id=tenant.dataSources[type];if(!id)continue;const schema=await notion.request('/data_sources/'+encodeURIComponent(id));
      item[type]=Object.fromEntries(Object.entries(schema.properties).map(([name,p])=>[name,p.type]));}
      inventory.push(item);}console.log(JSON.stringify(inventory));
  }else console.log(JSON.stringify(await store.stats()));
}finally{await pool.end();}

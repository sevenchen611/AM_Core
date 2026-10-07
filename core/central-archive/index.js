import {Pool} from 'pg';
import {createArchiveStore,digest} from './store.js';
import {createArchiveNotion} from './notion.js';
import {archiveMedia} from './media.js';
import {lineIoDatabaseConfig} from '../line-io/database.js';
export const CENTRAL_ARCHIVE_CONTRACT='line-per-conversation-notion-drive-v1';
export function archiveDatabaseConfig(env){
  const connectionString=env.AMCORE_CENTRAL_ARCHIVE_DATABASE_URL||env.AMCORE_CENTRAL_ARCHIVE_LOCAL_DATABASE_URL;
  if(!connectionString)return lineIoDatabaseConfig(env);
  return {connectionString,ssl:env.AMCORE_CENTRAL_ARCHIVE_DATABASE_SSL==='false'?false:{rejectUnauthorized:true}};
}
export function archiveConfig(env){
  const enabled=env.AMCORE_CENTRAL_ARCHIVE_ENABLED==='1';
  if(!enabled)return {enabled:false};
  const parentId=env.AMCORE_CENTRAL_ARCHIVE_NOTION_PARENT_PAGE_ID;
  const rootId=env.AMCORE_CENTRAL_ARCHIVE_DRIVE_ROOT_FOLDER_ID;
  const botId=env.AMCORE_CENTRAL_ARCHIVE_BOT_USER_ID;
  if(!/^[a-f0-9-]{32,36}$/i.test(parentId||'')||!/^[\w-]{10,200}$/.test(rootId||'')||!/^U[a-f0-9]{32}$/i.test(botId||'')||!env.NOTION_TOKEN)throw Error('central_archive_configuration_incomplete');
  return {enabled:true,parentId,rootId,botId};
}
export async function createCentralArchive({env=process.env,line,drive,router,logger=console,pool:injectedPool,notion:injectedNotion}){
  const config=archiveConfig(env);
  const state={enabled:config.enabled,contract:CENTRAL_ARCHIVE_CONTRACT,storage:'google-drive',notionFiles:'links-only',ready:false};
  if(!config.enabled)return {capture:async()=>{},drain:async()=>{},health:()=>state,close:async()=>{}};
  if(!line.configured||!drive.configured)throw Error('central_archive_connections_missing');
  const actualBot=await line.lineGet('/v2/bot/info',{timeoutMs:10000});
  if(actualBot.userId!==config.botId)throw Error('central_archive_bot_mismatch');
  const pool=injectedPool||new Pool({...archiveDatabaseConfig(env),max:3,connectionTimeoutMillis:5000});
  pool.on?.('error',()=>logger.warn('Central archive database connection deferred.'));
  const store=createArchiveStore(pool,config.botId);
  const notion=injectedNotion||createArchiveNotion({token:env.NOTION_TOKEN,parentId:config.parentId});
  try{
    await pool.query('SELECT key FROM central_archive.jobs LIMIT 0');
    const page=await notion.request('/pages/'+encodeURIComponent(config.parentId));
    if(page.archived||page.in_trash)throw Error('central_archive_parent_unavailable');
    const token=await drive.getAccessToken();
    if(env.AMCORE_CENTRAL_ARCHIVE_GOOGLE_ACCOUNT_EMAIL){
      const identity=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      const account=await identity.json();
      if(!identity.ok||account.user?.emailAddress?.toLowerCase()!==env.AMCORE_CENTRAL_ARCHIVE_GOOGLE_ACCOUNT_EMAIL.toLowerCase())throw Error('central_archive_google_account_mismatch');
    }
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(config.rootId)}?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    const folder=await r.json();if(!r.ok||folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.capabilities?.canAddChildren)throw Error('central_archive_drive_unavailable');
  }catch(error){if(!injectedPool)await pool.end();throw error;}
  state.ready=true;
  state.captureEnabled=env.AMCORE_CENTRAL_ARCHIVE_CAPTURE_ENABLED!=='0';
  let draining=null,timer;
  const lockId=parseInt(digest(config.botId).slice(0,7),16);
  async function processJob(job){
    if(!job.display_name){
      if(job.source_kind==='group')job.display_name=await line.resolveGroupName(job.source_id);
      else if(job.source_kind==='user')job.display_name=await line.resolveSenderName({userId:job.source_id});
      job.display_name ||= `${job.source_kind} ${job.source_id.slice(-8)}`;
    }
    const missingTarget=!job.database_id||!job.data_source_id||!job.drive_folder_id;
    const target=await notion.ensureDatabase({...job,key:job.conversation_key});
    Object.assign(job,{database_id:target.database_id,data_source_id:target.data_source_id});
    job.drive_folder_id ||= await drive.ensureFolder(`${job.display_name.slice(0,100)} · ${job.conversation_key.slice(0,12)}`,config.rootId);
    if(missingTarget)await store.target(job.conversation_key,job);
    // Tenant business data sources remain isolated; this is a separately authorized owner archive.
    if(!job.payload.tenantKey&&job.source_kind!=='user'&&router){
      const route=await router.resolveGroupBinding(job.source_id);
      if(route.resolution==='lookup_failed')throw Error('archive_tenant_lookup_unavailable');
      job.payload.tenantKey=route.tenant?.key||'未綁定';
    }
    const sender=job.payload.direction==='outgoing'?actualBot.displayName:
      job.payload.sender||await line.resolveSenderName(job.payload.event?.source||{});
    let result=job.result||{};
    if(job.binary){
      try{result=await archiveMedia({job,drive,line,notion});await store.result(job.key,result);}
      catch(error){
        const missing=/LINE content download failed: (404|410)\b/.test(error.message)||error.message==='archive_legacy_file_missing';
        result={...result,attachmentStatus:missing?'原檔缺失，需補提供':'等待重試',errorCode:missing?'archive_source_missing':error.code||'archive_media_unavailable'};
        await store.result(job.key,result);await notion.write(job,result,sender);
        if(missing){await store.needsSource(job.key,'archive_source_missing');return;}
        throw error;
      }
    }
    const page=await notion.write(job,result,sender);
    await store.complete(job.key,{...result,notionPageId:page.id});
  }
  async function drain(){
    if(!state.captureEnabled)return;
    if(draining)return draining;
    draining=(async()=>{
      const db=await pool.connect();let locked=false;
      try{
        locked=(await db.query('SELECT pg_try_advisory_lock(10072026,$1) AS locked',[lockId])).rows[0].locked;
        if(!locked)return;
        const deadline=Date.now()+60000;
        while(Date.now()<deadline){
          const job=await store.next(db);if(!job)break;
          try{await processJob(job);}catch(error){
            // Logs contain codes only, never raw API responses, message text, tokens, or source identifiers.
            const code=/^archive_[a-z0-9_]+$/.test(error.code||error.message||'')?(error.code||error.message):'archive_processing_failed';
            await store.retry(job.key,code);logger.warn('Central archive deferred:',code);
          }
        }
        Object.assign(state,await store.stats(),{checkedAt:new Date().toISOString()});
      }finally{if(locked)await db.query('SELECT pg_advisory_unlock(10072026,$1)',[lockId]).catch(()=>{});db.release();}
    })().finally(()=>{draining=null;});return draining;
  }
  if(state.captureEnabled)line.setArchiveObserver({
    before:request=>store.outbound(request),
    after:async(key,status)=>{try{await store.delivery(key,status);}catch{logger.error('Central archive delivery evidence deferred.');}drain().catch(()=>{});}
  });
  async function capture(events){if(!state.captureEnabled)return;await store.capture(events);drain().catch(()=>logger.error('Central archive worker unavailable.'));}
  Object.assign(state,await store.stats());
  timer=setInterval(()=>drain().catch(()=>logger.error('Central archive worker unavailable.')),2000);timer.unref();
  drain().catch(()=>logger.error('Central archive recovery deferred.'));
  async function original(messageId,{groupId='',userId=''}={}){
    const key=`in:${digest(`${config.botId}:message:${messageId}`)}`;
    const rows=await pool.query(`SELECT j.*,c.source_id,c.source_kind,c.drive_folder_id FROM central_archive.jobs j
      JOIN central_archive.conversations c ON c.key=j.conversation_key WHERE j.key=$1 AND c.bot_id=$2`,[key,config.botId]);
    const row=rows.rows[0];if(!row)return null;
    if(row.source_id!==(groupId||userId))throw Error('archive_original_source_mismatch');
    const result=row.result;
    if(!result.driveId)return {pending:true};
    const file=await drive.verifyAttachment(result.driveId,row.drive_folder_id,{amCentralArchive:digest(key)},result.size,result.md5);
    return {file,sha256:result.sha256,md5:result.md5};
  }
  const health=()=>({enabled:state.enabled,ready:state.ready,captureEnabled:state.captureEnabled,
    contract:state.contract,storage:state.storage,notionFiles:state.notionFiles,checkedAt:state.checkedAt,
    backlog:Boolean(state.states?.pending||state.states?.sending),needsSource:Boolean(state.states?.needs_source)});
  return {capture,drain,original,health,store,notion,processJob,
    close:async()=>{clearInterval(timer);if(draining)await draining;if(!injectedPool)await pool.end();}};
}

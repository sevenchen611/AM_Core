import crypto from 'node:crypto';
import {createCalendarStore} from './store.js';
import {calendarCandidate,extractEvents,prepareEvent,preview,reviewDraft,supplementRequest} from './extract.js';

export const LEAF_CALENDAR_CONTRACT='line-confirmed-dailylog-shared-calendar-v2';
const USER=/^U[0-9a-f]{32}$/i;
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const textOf=e=>e?.message?.type==='text'?String(e.message.text||'').normalize('NFKC').trim():'';
const direct=e=>e?.source?.type==='user'&&USER.test(e.source.userId||'')&&!e.source.groupId&&!e.source.roomId;
const actionOf=e=>String(e?.postback?.data||'').match(/^leafcal:(confirm|cancel|edit|retry):([a-f0-9]{48}):(\d{1,8})$/);
const rawId=e=>String(e?.webhookEventId||e?.message?.id||'');
const receipt=e=>({id:rawId(e),timestamp:e.timestamp||Date.now(),senderId:e.source.userId,text:textOf(e),postback:e.postback?.data||null});
const transient=error=>error.status===502||error.status===503||error.status>=500||['NETWORK_UNCERTAIN','GOOGLE_UNAVAILABLE'].includes(error.code);
export function calendarAdminKey(secret){return crypto.createHmac('sha256',secret).update('leaf-calendar-admin-v1').digest('hex');}
function same(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);}
function encryptionKey(secret){return Buffer.from(crypto.hkdfSync('sha256',Buffer.from(secret),Buffer.from('leaf-calendar-v1'),Buffer.from('api-key-storage'),32));}
function encrypt(value,secret,tenantId){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',encryptionKey(secret),iv);c.setAAD(Buffer.from(tenantId));
  const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};}
function decrypt(value,secret,tenantId){const c=crypto.createDecipheriv('aes-256-gcm',encryptionKey(secret),Buffer.from(value.iv,'base64'));c.setAAD(Buffer.from(tenantId));c.setAuthTag(Buffer.from(value.tag,'base64'));
  return Buffer.concat([c.update(Buffer.from(value.data,'base64')),c.final()]).toString('utf8');}
function safeOrigin(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||['localhost','127.0.0.1','::1'].includes(u.hostname))throw new Error('invalid_dailylog_origin');return u.origin;}

export async function createLeafCalendar({env=process.env,tenants=[],platform={},logger=console,store:injectedStore,fetchImpl=fetch,resolveIdentity=async()=>null}) {
  const secret=env.LINE_CHANNEL_SECRET||'';
  const ready=[];
  const store=injectedStore||createCalendarStore({settingsForTenant:tenant=>platform.operationalMemory?.settingsForTenant(tenant),env});
  if(secret && env.AMCORE_LEAF_CALENDAR_ENABLED!=='0')for(const tenant of tenants.filter(t=>t.runtimeEnabled!==false)) {
    try{if(await store.ready(tenant))ready.push(tenant);}catch{logger.warn?.('[leaf-calendar] tenant store not provisioned');}
  }
  let enabled=ready.length>0;
  let running=null;
  const configured=new Set();
  for(const tenant of ready) if(await store.service(tenant)) configured.add(tenant.key);
  async function owner(userId){
    const identity=await resolveIdentity(userId);
    if(!identity || !/^[a-zA-Z0-9_.@-]{1,100}$/.test(identity.account||'') || !identity.bindingId) return null;
    const tenant=ready.find(t=>t.key===identity.tenantKey);if(!tenant)return null;
    const config=await store.service(tenant);if(!config)return null;
    const fingerprint=hash(identity.bindingId+':'+identity.account+':'+config.base_url);
    const actor=await store.syncActor(tenant,userId,{account:identity.account,fingerprint});
    return {tenant,binding:{...actor,...config,fingerprint}};
  }
  async function accepts(event){if(!enabled||!direct(event))return false;const text=textOf(event);
    if(!(actionOf(event)||calendarCandidate(text)||supplementRequest(text)||/^(?:確認加入行事曆|不要加入行事曆|查看行事曆草稿)/u.test(text)))return false;
    return Boolean(await owner(event.source.userId));
  }
  async function notice(tenant,userId,event,message,fingerprint='unbound'){
    await store.insert(tenant,{id:hash(`notice:${userId}:${rawId(event)}:${message}`).slice(0,48),userId,kind:'notice',status:'notice',payload:{message},source:receipt(event),fingerprint});
  }
  async function capture(events){for(const event of events){
    if(!direct(event)||!rawId(event))throw new Error('calendar_event_identity_required');
    const userId=event.source.userId,text=textOf(event);
    const resolved=await owner(userId);if(!resolved)continue;const {tenant,binding}=resolved;
    let control=actionOf(event);let payload;
    if(control)payload={action:control[1],id:control[2],revision:Number(control[3])};
    else if(text==='查看行事曆草稿')payload={action:'list'};
    else if(['確認加入行事曆','不要加入行事曆'].includes(text)){
      const list=await store.pending(tenant,userId);
      if(list.length!==1){await notice(tenant,userId,event,'請使用對應活動卡片的按鈕，以免確認錯誤活動。',binding.fingerprint);continue;}
      payload={action:text==='確認加入行事曆'?'confirm':'cancel',id:list[0].request_id,revision:list[0].revision};
    }
    if(payload){await store.insert(tenant,{id:hash(`control:${userId}:${rawId(event)}`).slice(0,48),userId,kind:'control',payload,source:receipt(event),fingerprint:binding.fingerprint});continue;}
    const supplement=supplementRequest(text);
    if(supplement){const pending=await store.pending(tenant,userId);
      const matches=supplement.topic?pending.filter(row=>row.payload.event.topic===supplement.topic):pending;
      if(matches.length!==1||!supplement.text){await notice(tenant,userId,event,pending.length
        ?'請用文字指定活動與要修改的內容，例如：補充活動「活動名稱」：地點改為新會議室。活動名稱請與卡片一致。'
        :'目前沒有待建立的活動，請重新傳送活動資訊。',binding.fingerprint);continue;}
      binding.editing_id=matches[0].request_id;binding.editing_revision=matches[0].revision;}
    await store.insert(tenant,{id:hash(`intake:${userId}:${rawId(event)}`).slice(0,48),userId,kind:'intake',source:receipt(event),fingerprint:binding.fingerprint,
      payload:supplement?{account:binding.account,editId:binding.editing_id,editRevision:binding.editing_revision}:{account:binding.account} });
  }}
  async function push(row,message,tenant,suffix=''){
    const h=hash(`${tenant.tenantId}:${row.request_id}:${row.revision}:${suffix}:${JSON.stringify(message)}`);
    const retryKey=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
    await platform.pushLineMessage(row.line_user_id,message,null,{retryKey,suppressEvidenceLogs:true,timeoutMs:8000});
  }
  async function calendarRequest(binding,payload){
    const r=await fetchImpl(new URL('/api/integrations/leaf-snail/calendar/events',binding.base_url),{method:'POST',redirect:'error',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+binding.apiKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)}).catch(()=>{throw Object.assign(new Error('calendar_request_uncertain'),{code:'NETWORK_UNCERTAIN'});});
    const result=await r.json().catch(()=>({}));
    if(!r.ok||result.ok!==true)throw Object.assign(new Error('calendar_api_rejected'),{status:r.status,code:result.code||'INTERNAL_ERROR'});
    if(result.requestId!==payload.requestId||result.account!==payload.account||typeof result.event?.id!=='string'||!result.event.id)throw Object.assign(new Error('calendar_success_missing_event'),{code:'NETWORK_UNCERTAIN'});
    const link=result.event.htmlLink;
    return {id:result.event.id,replayed:result.replayed===true,htmlLink:typeof link==='string'&&/^https:\/\/calendar\.google\.com\//.test(link)?link:null};
  }
  function success(row){return `✅ 已加入你的 Google 行事曆\n活動名稱：${row.payload.event.topic}\n日期與時間：${row.payload.event.date} ${row.payload.event.time}\n地點：${row.payload.event.location}${row.result?.htmlLink?'\n'+row.result.htmlLink:''}`;}
  function failure(row){const messages={GOOGLE_NOT_CONNECTED:'請先在工作日誌重新連接 Google，然後重試。',ACCOUNT_NOT_FOUND:'請先登入工作日誌建立帳號；若已登入，請聯絡管理者檢查 UOF 身分綁定。',UNAUTHORIZED:'共用服務金鑰設定異常，請聯絡管理者。',ACCESS_DISABLED:'工作日誌帳號未開通，請聯絡管理者。',CALENDAR_NOT_WRITABLE:'目標日曆無編輯權，請在工作日誌確認目標日曆。',IDEMPOTENCY_CONFLICT:'活動識別資料有衝突，請先在 Google 行事曆確認；不會另建重複活動。',BINDING_CHANGED:'UOF 身分綁定已變更或失效，請重新確認綁定後再傳入活動。'};
    return '目前無法完成行事曆新增。'+(messages[row.error_code]||'暫時無法確認是否已建立；重試會沿用原本資料與識別碼，避免重複。');}
  async function work(tenant,row){
    if(row.status==='notice'){await push(row,row.payload.message,tenant,'notice');await store.settle(tenant,row,{status:'done',notified:true});return;}
    const resolved=await owner(row.line_user_id);
    const current=resolved?.tenant.key===tenant.key?resolved.binding:null;
    if((!current||current.fingerprint!==row.fingerprint)&&!['saved','failed','cancelled','expired'].includes(row.status)){
      await store.settle(tenant,row,{status:'failed',errorCode:'BINDING_CHANGED'});return;}
    if(row.kind==='control'&&row.status==='queued'){
      if(row.payload.action==='list'){for(const draft of await store.pending(tenant,row.line_user_id))await push(draft,preview(draft),tenant,'list:'+row.request_id);}
      else {const outcome=await store.control(tenant,row.line_user_id,{...row.payload,evidence:row.source_evidence});const messages={editing:'請直接回覆「補充活動：…」，提供要修改的日期、時間、地點或內容；不需要再按修改按鈕。我會更新卡片，等你按「建立」才新增。',missing:'找不到這筆活動，請重新傳送活動資訊。',changed:'活動資料已更新，請使用最新卡片確認。',expired:'這筆活動已過期或取消，請重新傳送資訊。',needs_details:outcome.row?`還不能建立，請直接回覆「補充活動：…」補齊：\n${reviewDraft(outcome.row).missing.join('\n')}`:'請先補齊活動資料，再建立。',saving:'正在新增這筆活動，請稍候。',confirmed:'已收到確認，正在新增。'};
        if(outcome.code==='saved')await push(row,success(outcome.row),tenant,'already-saved');else if(messages[outcome.code])await push(row,messages[outcome.code],tenant,'control');}
      await store.settle(tenant,row,{status:'done'});return;
    }
    if(row.kind==='intake'&&row.status==='queued'){
      const existing=row.payload.editId?await store.owned(tenant,row.line_user_id,row.payload.editId):null;
      const prior=existing?reviewDraft(existing):null;
      const events=await extractEvents({text:existing?(supplementRequest(row.source_evidence.text)?.text||row.source_evidence.text):row.source_evidence.text,at:row.source_evidence.timestamp,llm:platform.llmForTenant?.(tenant)||platform.llm,existing:existing?{...Object.fromEntries(Object.entries(existing.payload.event).filter(([k])=>!['account','requestId'].includes(k))),needsClarification:prior.missing,confirmationNotes:prior.notes}:undefined});
      const drafts=events.map((event,index)=>{const id=row.payload.editId||hash(`${tenant.tenantId}:${row.line_user_id}:${row.source_evidence.id}:${index}`).slice(0,48);
        const payload=prepareEvent(event,`leafcal:${id}`);payload.event.account=row.payload.account;return {id,payload,status:payload.missing.length?'needs_details':'pending'};});
      await store.storeDrafts(tenant,row,drafts);return;
    }
    if(['pending','needs_details'].includes(row.status)){await push(row,preview(row),tenant,'preview');await store.settle(tenant,row,{prompted:true});return;}
    if(row.status==='saving'){
      if(!row.confirmed_at||reviewDraft(row).missing.length||row.payload.event.account!==current.account)throw new Error('confirmation_required');
      const result=await calendarRequest({...current,apiKey:decrypt(current.encrypted_key,secret,tenant.tenantId)},row.payload.event);
      await store.settle(tenant,row,{status:'saved',result});return;
    }
    if(['saved','failed','cancelled','expired'].includes(row.status)){
      let message=row.status==='saved'?success(row):row.status==='cancelled'?'已取消這筆活動，不會加入 Google 行事曆。':row.status==='expired'?'活動確認已過期，請重新傳送資訊。':failure(row);
      if(row.status==='failed'&&row.confirmed_at&&['GOOGLE_UNAVAILABLE','NETWORK_UNCERTAIN','GOOGLE_NOT_CONNECTED','INTERNAL_ERROR'].includes(row.error_code))message={type:'text',text:message,
        quickReply:{items:[{type:'action',action:{type:'postback',label:'重試原活動',data:`leafcal:retry:${row.request_id}:${row.revision}`}}]}};
      await push(row,message,tenant,row.status);await store.settle(tenant,row,{notified:true,errorCode:row.error_code});
    }
  }
  function drain(){if(!enabled)return Promise.resolve();if(running)return running;running=(async()=>{for(let i=0;i<30;i++){let leased=false;for(const tenant of ready){const row=await store.lease(tenant);if(!row)continue;leased=true;
      try{await work(tenant,row);}catch(error){const code=error.code||'PROCESSING_UNAVAILABLE';const writing=row.status==='saving';
        const delivering=['notice','pending','needs_details','saved','failed','cancelled','expired'].includes(row.status);
        if(delivering)await store.settle(tenant,row,{status:row.status,errorCode:row.error_code,delay:row.attempt_count<4?[2,5,15][row.attempt_count-1]:3600});
        else if((writing?transient(error):true)&&row.attempt_count<4)await store.settle(tenant,row,{status:row.status,errorCode:code,delay:[2,5,15][row.attempt_count-1]||15});
        else await store.settle(tenant,row,{status:'failed',errorCode:writing?code:'EXTRACTION_UNAVAILABLE'});
        logger.warn?.('[leaf-calendar] processing deferred or requires owner action');}}
      if(!leased)break;}})().finally(()=>{running=null;});return running;}
  async function configureService({tenantKey,baseUrl,apiKey}){const tenant=tenants.find(t=>t.key===tenantKey&&t.runtimeEnabled!==false);if(!tenant)throw new Error('calendar_tenant_unavailable');
    if(env.AMCORE_LEAF_CALENDAR_ENABLED==='0')throw new Error('calendar_disabled');
    if(typeof apiKey!=='string'||apiKey.length<24||apiKey.length>500)throw new Error('invalid_calendar_key');
    baseUrl=safeOrigin(baseUrl);
    const r=await fetchImpl(new URL('/api/integrations/leaf-snail/calendar/events',baseUrl),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:'{}',signal:AbortSignal.timeout(20000)});
    const response=await r.json().catch(()=>({}));if(r.status!==400||response.code!=='INVALID_REQUEST')throw new Error('calendar_api_not_ready_or_key_invalid');
    if(!ready.some(t=>t.key===tenant.key)){await store.provision(tenant);ready.push(tenant);enabled=true;}
    await store.configure(tenant,{baseUrl,encryptedKey:encrypt(apiKey,secret,tenant.tenantId)});
    configured.add(tenant.key);
    return {ok:true,tenantKey,configured:true};
  }
  return {accepts,capture,drain,configureService,adminAuthorized:value=>Boolean(secret)&&same(value,calendarAdminKey(secret)),
    health:()=>({enabled,contract:LEAF_CALENDAR_CONTRACT,provisionedTenants:ready.map(t=>t.key),configuredTenants:[...configured]}),close:()=>store.close?.()};
}

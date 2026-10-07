import {digest} from './store.js';
export const ARCHIVE_SCHEMA={
  '訊息':{title:{}},'識別碼':{rich_text:{}},'時間':{date:{}},'方向':{rich_text:{}},
  '發送者':{rich_text:{}},'訊息類型':{rich_text:{}},'內容':{rich_text:{}},
  '來源類型':{rich_text:{}},'LINE 對話 ID':{rich_text:{}},'LINE 訊息 ID':{rich_text:{}},
  '原租戶':{rich_text:{}},'歷史來源':{url:{}},'Google Drive':{url:{}},
  '檔案名稱':{rich_text:{}},'檔案大小':{number:{}},'附件狀態':{rich_text:{}},
  'SHA256':{rich_text:{}},'MD5':{rich_text:{}},'發送狀態':{rich_text:{}},'來源說明':{rich_text:{}}
};
export function richText(value){
  const text=String(value??''); const items=[];
  let chunk='';for(const character of text){if(chunk.length+character.length>1800){items.push({type:'text',text:{content:chunk}});chunk='';}chunk+=character;}
  if(chunk)items.push({type:'text',text:{content:chunk}});
  if(items.length>100)throw Error('archive_text_exceeds_property_limit');
  return items;
}
const rt=v=>({rich_text:richText(v)});
const normalize=id=>String(id||'').replaceAll('-','');
export function archiveProperties(job,result={},sender=''){
  const p=job.payload,e=p.event||{},m=e.message||{};
  const content=p.direction==='outgoing'?p.messages.map(x=>x.text||JSON.stringify(x)).join('\n\n'):
    m.text??p.content??(e.type==='message'?JSON.stringify(m):JSON.stringify(e));
  const type=p.direction==='outgoing'?p.messages.map(x=>x.type).join(','):m.type||e.type||'historical';
  return {'訊息':{title:richText(Array.from(content||`[${type}]`).slice(0,120).join(''))},'識別碼':rt(job.key),
    '時間':{date:{start:new Date(job.event_at).toISOString()}},'方向':rt(p.direction==='outgoing'?'機器人發送':'收到'),
    '發送者':rt(sender||p.sender||e.source?.userId||''),'訊息類型':rt(type),'內容':rt(content),
    '來源類型':rt(job.source_kind),'LINE 對話 ID':rt(job.source_id),'LINE 訊息 ID':rt(m.id||''),
    '原租戶':rt(p.tenantKey||''),'歷史來源':{url:p.sourceUrl||null},
    'Google Drive':{url:result.driveUrl||null},'檔案名稱':rt(result.name||m.fileName||''),
    '檔案大小':{number:Number(result.size)||Number(m.fileSize)||null},
    '附件狀態':rt(result.attachmentStatus||(job.binary?'待保存':'無附件')),
    'SHA256':rt(result.sha256||''),'MD5':rt(result.md5||''),'發送狀態':rt(p.delivery||''),
    '來源說明':rt(p.note||'')};
}
export function createArchiveNotion({token,parentId,fetchImpl=fetch,spacingMs=360}){
  let chain=Promise.resolve(),nextStart=0;
  const verified=new Set();
  async function request(path,method='GET',body){
    // Share one rate limiter for this connection's archive reads and writes.
    const start=chain.catch(()=>{}).then(async()=>{const wait=nextStart-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));nextStart=Date.now()+spacingMs;});
    chain=start;await start;
    const r=await fetchImpl('https://api.notion.com/v1'+path,{method,
      headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    const data=await r.json();if(!r.ok)throw Object.assign(Error('archive_notion_'+r.status),{code:'archive_notion_'+r.status});
    return data;
  }
  async function children(id){const all=[];let cursor='';do{
    const page=await request(`/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor?'&start_cursor='+encodeURIComponent(cursor):''}`);
    all.push(...page.results);cursor=page.has_more?page.next_cursor:'';
  }while(cursor);return all;}
  async function verify(databaseId,dataSourceId){
    if(verified.has(dataSourceId))return;
    const db=await request('/databases/'+encodeURIComponent(databaseId));
    if(db.archived||db.in_trash||normalize(db.parent?.page_id)!==normalize(parentId)||!db.data_sources?.some(x=>x.id===dataSourceId))throw Error('archive_notion_parent_mismatch');
    if(db.is_inline)await request('/databases/'+encodeURIComponent(databaseId),'PATCH',{is_inline:false});
    const ds=await request('/data_sources/'+encodeURIComponent(dataSourceId));
    for(const [name,def] of Object.entries(ARCHIVE_SCHEMA))if(ds.properties?.[name]?.type!==Object.keys(def)[0])throw Error('archive_notion_schema_mismatch');
    verified.add(dataSourceId);
  }
  async function ensureDatabase(conversation){
    if(conversation.database_id&&conversation.data_source_id){await verify(conversation.database_id,conversation.data_source_id);return conversation;}
    const marker='am-central-'+conversation.key;
    // The stable suffix allows recovering a successful create after a network timeout.
    const suffix=` · ${conversation.key.slice(0,12)}`;
    const matches=(await children(parentId)).filter(b=>b.type==='child_database'&&b.child_database.title.endsWith(suffix));
    if(matches.length>1)throw Error('archive_database_duplicate');
    let db;
    if(matches.length){db=await request('/databases/'+encodeURIComponent(matches[0].id));
      if(db.description?.map(x=>x.plain_text||x.text?.content||'').join('')!==marker)throw Error('archive_database_identity_mismatch');
    }else db=await request('/databases','POST',{parent:{type:'page_id',page_id:parentId},
      title:richText((conversation.display_name||`${conversation.source_kind} 對話`).slice(0,150)+suffix),description:richText(marker),
      is_inline:false,initial_data_source:{properties:ARCHIVE_SCHEMA}});
    const target={...conversation,database_id:db.id,data_source_id:db.data_sources?.[0]?.id};
    if(!target.data_source_id)throw Error('archive_data_source_missing');
    await verify(target.database_id,target.data_source_id);return target;
  }
  async function write(job,result,sender){
    await verify(job.database_id,job.data_source_id);
    const found=job.attempts>0||result.notionPageId?await request(`/data_sources/${encodeURIComponent(job.data_source_id)}/query`,'POST',{
      page_size:2,filter:{property:'識別碼',rich_text:{equals:job.key}}}):{results:[]};
    if(found.results.length>1)throw Error('archive_message_duplicate');
    const properties=archiveProperties(job,result,sender);
    if(found.results.length)return request('/pages/'+encodeURIComponent(found.results[0].id),'PATCH',{properties});
    return request('/pages','POST',{parent:{type:'data_source_id',data_source_id:job.data_source_id},properties});
  }
  return {request,children,verify,ensureDatabase,write,parentId};
}

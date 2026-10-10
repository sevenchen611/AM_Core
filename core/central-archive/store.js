import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export function conversationSource(source) {
  const kind=source?.groupId?'group':source?.roomId?'room':source?.userId?'user':'';
  const id=source?.groupId||source?.roomId||source?.userId||'';
  if(!kind || !/^[CUR][a-f0-9]{32}$/i.test(id)) throw Error('archive_source_invalid');
  return {kind,id};
}
export function archiveRecord(botId,event) {
  const source=conversationSource(event.source);
  const key=digest(`${botId}:${source.kind}:${source.id}`);
  const eventId=event.message?.id||event.webhookEventId;
  if(!eventId || !Number.isFinite(event.timestamp))throw Error('archive_event_invalid');
  // Reply credentials are mapped by hash and never stored in the message payload.
  const {replyToken,deliveryContext,...safeEvent}=event;
  if(safeEvent.message){const {quoteToken,...message}=safeEvent.message;safeEvent.message=message;}
  return {conversation:{key,botId,...source}, key:`in:${digest(`${botId}:${event.type}:${eventId}`)}`,
    at:new Date(event.timestamp).toISOString(),
    payload:{direction:'incoming',event:safeEvent,evidenceQuality:'webhook'},
    binary:['file','image','audio','video'].includes(event.message?.type),replyToken};
}
export function createArchiveStore(pool,botId) {
  async function transaction(work) {
    const db=await pool.connect();
    try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
  }
  async function append(records) {
    if(!records.length)return;
    const unique=new Map();
    for(const r of records){
      const c=r.conversation;
      if(!r.key||!c?.key||!c.botId||!c.kind||!c.id||!r.at||!r.payload)throw Error('archive_record_invalid');
      if(unique.has(r.key)&&unique.get(r.key).conversation_key!==c.key)throw Error('archive_message_source_conflict');
      if(!unique.has(r.key))unique.set(r.key,{key:r.key,conversation_key:c.key,bot_id:c.botId,source_kind:c.kind,source_id:c.id,
        display_name:c.name||'',event_at:r.at,payload:r.payload,has_binary:Boolean(r.binary),state:r.state||'pending',reply_hash:r.replyToken?digest(r.replyToken):''});
    }
    const rows=[...unique.values()],body=JSON.stringify(rows);
    return transaction(async db=>{
      await db.query(`INSERT INTO central_archive.conversations(key,bot_id,source_kind,source_id,display_name)
        SELECT DISTINCT ON(conversation_key) conversation_key,bot_id,source_kind,source_id,display_name
        FROM jsonb_to_recordset($1::jsonb) AS x(conversation_key text,bot_id text,source_kind text,source_id text,display_name text)
        ORDER BY conversation_key,(display_name<>'') DESC
        ON CONFLICT(key) DO UPDATE SET display_name=CASE WHEN EXCLUDED.display_name<>''
        THEN EXCLUDED.display_name ELSE conversations.display_name END`,[body]);
      const inserted=await db.query(`INSERT INTO central_archive.jobs(key,conversation_key,event_at,payload,has_binary,state)
        SELECT key,conversation_key,event_at,payload,has_binary,state FROM jsonb_to_recordset($1::jsonb)
        AS x(key text,conversation_key text,event_at timestamptz,payload jsonb,has_binary boolean,state text)
        ON CONFLICT(key) DO UPDATE SET
          payload=CASE WHEN jobs.payload->>'direction'='outgoing' THEN EXCLUDED.payload||jobs.payload
          WHEN jobs.payload->>'evidenceQuality'='webhook' AND jobs.payload->'history' IS NULL
          THEN EXCLUDED.payload||jobs.payload||jsonb_build_object('history',false)
          WHEN jobs.payload->>'evidenceQuality'='webhook' THEN EXCLUDED.payload||jobs.payload
          ELSE jobs.payload||EXCLUDED.payload END,
          state=CASE WHEN (NOT jobs.has_binary AND EXCLUDED.has_binary) OR
            (jobs.payload->>'evidenceQuality' IS DISTINCT FROM 'webhook' AND EXCLUDED.payload->>'evidenceQuality'='webhook')
            THEN 'pending' ELSE jobs.state END,
          has_binary=jobs.has_binary OR EXCLUDED.has_binary
          WHERE jobs.conversation_key=EXCLUDED.conversation_key RETURNING key`,[body]);
      if(inserted.rows.length!==rows.length)throw Error('archive_message_source_conflict');
      if(rows.some(r=>r.reply_hash))await db.query(`INSERT INTO central_archive.replies(token_hash,conversation_key,expires_at)
        SELECT DISTINCT ON(reply_hash) reply_hash,conversation_key,now()+interval '10 minutes'
        FROM jsonb_to_recordset($1::jsonb) AS x(reply_hash text,conversation_key text) WHERE reply_hash<>''
        ON CONFLICT(token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at`,[body]);
      await db.query('DELETE FROM central_archive.replies WHERE expires_at<now()');
    });
  }
  async function capture(events) {
    const supported=events.filter(e=>e.source && (e.source.groupId||e.source.roomId||e.source.userId));
    await append(supported.map(e=>archiveRecord(botId,e)));
  }
  async function outbound({to,replyToken,messages,key}) {
    // Compare the JSON sent to LINE with the JSONB evidence. Builders can carry
    // optional undefined properties, which JSON storage and HTTP both omit.
    messages=JSON.parse(JSON.stringify(messages));
    let c;
    if(replyToken){
      const r=await pool.query(`SELECT c.* FROM central_archive.replies r JOIN central_archive.conversations c ON c.key=r.conversation_key
        WHERE r.token_hash=$1 AND r.expires_at>now()`,[digest(replyToken)]);c=r.rows[0];
      if(!c)throw Error('archive_reply_origin_missing');
    }else{
      const source=conversationSource(to?.startsWith('C')?{groupId:to}:to?.startsWith('R')?{roomId:to}:{userId:to});
      c={key:digest(`${botId}:${source.kind}:${source.id}`),bot_id:botId,source_kind:source.kind,source_id:source.id};
    }
    const jobs=messages.map((message,index)=>{
      const media=['image','audio','video'].includes(message.type)&&message.originalContentUrl?{url:message.originalContentUrl,name:`${message.type}-${digest(key+':'+index).slice(0,12)}`} : null;
      return {key:`out:${digest(key+':'+index)}`,conversation:{key:c.key,botId:c.bot_id,kind:c.source_kind,id:c.source_id},
        at:new Date().toISOString(),state:'sending',binary:Boolean(media),payload:{direction:'outgoing',messages:[message],delivery:'pending',...(media?{media}:{})}};
    });
    await append(jobs);const jobKeys=jobs.map(x=>x.key);
    const same=await pool.query('SELECT key,payload->\'messages\' AS messages FROM central_archive.jobs WHERE key=ANY($1::text[])',[jobKeys]);
    for(const row of same.rows)if(!isDeepStrictEqual(row.messages,jobs.find(x=>x.key===row.key).payload.messages))throw Error('archive_outbound_identity_conflict');
    await pool.query(`UPDATE central_archive.jobs SET state='sending',payload=jsonb_set(payload,'{delivery}','"pending"'::jsonb)
      WHERE key=ANY($1::text[]) AND payload->>'delivery'<>'accepted'`,[jobKeys]);
    return jobKeys;
  }
  async function delivery(key,status){
    await pool.query(`UPDATE central_archive.jobs SET payload=jsonb_set(payload,'{delivery}',to_jsonb($2::text)),state='pending',
      next_at=now() WHERE key=ANY($1::text[]) AND state='sending'`,[Array.isArray(key)?key:[key],status]);
  }
  async function nextBatch(db,limit=8){
    // A crashed outbound sender is evidence of uncertainty; never resend from the archive.
    await db.query(`UPDATE central_archive.jobs SET state='pending',payload=jsonb_set(payload,'{delivery}','"unknown"'::jsonb)
      WHERE state='sending' AND created_at<now()-interval '10 minutes' AND conversation_key IN
      (SELECT key FROM central_archive.conversations WHERE bot_id=$1)`,[botId]);
    const result=await db.query(`SELECT j.*,j.has_binary AS "binary",c.source_kind,c.source_id,c.display_name,c.database_id,c.data_source_id,c.drive_folder_id
      FROM central_archive.jobs j JOIN central_archive.conversations c ON c.key=j.conversation_key
      WHERE c.bot_id=$1 AND j.state='pending' AND j.next_at<=now() ORDER BY
      (j.payload->'history' IS DISTINCT FROM 'true'::jsonb) DESC,j.has_binary DESC,j.created_at LIMIT $2`,[botId,Math.max(1,Math.min(8,limit))]);
    // Unprovisioned conversations may create a database/folder. Only one job for
    // each such conversation may run in a batch; existing targets are safe to share.
    const creating=new Set();
    return result.rows.filter(job=>{if(job.database_id&&job.data_source_id&&job.drive_folder_id)return true;
      if(creating.has(job.conversation_key))return false;creating.add(job.conversation_key);return true;});
  }
  async function next(db){return (await nextBatch(db,1))[0];}
  async function result(key,value){await pool.query('UPDATE central_archive.jobs SET result=$2::jsonb WHERE key=$1',[key,JSON.stringify(value)]);}
  async function target(key,c){await pool.query(`UPDATE central_archive.conversations SET database_id=$2,data_source_id=$3,
    drive_folder_id=$4,display_name=$5 WHERE key=$1`,[key,c.database_id,c.data_source_id,c.drive_folder_id,c.display_name]);}
  async function complete(key,value){await pool.query(`UPDATE central_archive.jobs SET state='done',completed_at=now(),error_code='',result=$2::jsonb WHERE key=$1`,[key,JSON.stringify(value)]);}
  async function needsSource(key,code){await pool.query(`UPDATE central_archive.jobs SET state='needs_source',error_code=$2 WHERE key=$1`,[key,code]);}
  async function retry(key,code){await pool.query(`UPDATE central_archive.jobs SET attempts=attempts+1,error_code=$2,
    next_at=now()+make_interval(secs=>LEAST(3600,15*power(2,LEAST(attempts,8))::int)) WHERE key=$1`,[key,code]);}
  async function stats(){const r=await pool.query(`SELECT state,count(*)::int AS count FROM central_archive.jobs j
    JOIN central_archive.conversations c ON c.key=j.conversation_key WHERE c.bot_id=$1 GROUP BY state`,[botId]);
    const c=await pool.query('SELECT count(*)::int AS count FROM central_archive.conversations WHERE bot_id=$1',[botId]);
    return {conversations:c.rows[0].count,states:Object.fromEntries(r.rows.map(x=>[x.state,x.count]))};}
  return {pool,append,capture,outbound,delivery,next,nextBatch,result,target,complete,needsSource,retry,stats};
}

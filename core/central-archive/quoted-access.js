import {archiveRecord,digest,conversationSource} from './store.js';

// Manual retrieval authorizes only this OA's existing conversation and its current member.
// It never enables project tasks, general assistant replies, or private-chat access.
export function createQuotedArchiveAccess({pool,botId,line}) {
  return async source => {
    const {kind,id}=conversationSource(source);
    if(!['group','room'].includes(kind)||source.type!==kind||!/^U[a-f0-9]{32}$/i.test(source.userId||''))return false;
    const rows=await pool.query(`SELECT key FROM central_archive.conversations
      WHERE bot_id=$1 AND source_kind=$2 AND source_id=$3`,[botId,kind,id]);
    if(rows.rows.length!==1)return false;
    const member=await line.lineGet(`/v2/bot/${kind}/${encodeURIComponent(id)}/member/${encodeURIComponent(source.userId)}`,{timeoutMs:10000});
    return member.userId===source.userId;
  };
}

export function quotedRecoveryRecord(botId,event) {
  const originalId=String(event.message?.quotedMessageId||'');
  if(!/^[0-9]{15,30}$/.test(originalId)||!event.message?.id||event.message.type!=='text'
    ||!event.message.mention?.mentionees?.some(m=>m.isSelf===true))throw Error('archive_quote_invalid');
  const {kind,id}=conversationSource(event.source);
  if(!['group','room'].includes(kind))throw Error('archive_quote_invalid');
  const recoveredAt=Date.now();
  const record=archiveRecord(botId,{type:'message',timestamp:recoveredAt,
    source:{type:kind,[kind==='group'?'groupId':'roomId']:id},
    message:{type:'file',id:originalId,contentProvider:{type:'line'}}});
  record.payload.evidenceQuality='quoted-message-recovery';
  record.payload.sender='原訊息作者未取得（回覆索取補存）';
  record.payload.quoteRecovery={requestKey:`in:${digest(`${botId}:message:${event.message.id}`)}`,
    recoveredAt:new Date(recoveredAt).toISOString(),originalTimestampUnknown:true,originalSenderUnknown:true};
  record.payload.note=`由本對話的已驗證回覆索取訊息補存；原作者與原發送時間未知。「時間」為補存時間。索取來源：${record.payload.quoteRecovery.requestKey}`;
  return record;
}

// groupId remains the v1 envelope's conversation key. Direct keys are the
// verified owner's U-id, never a caller-supplied arbitrary push recipient.
export const directId = value => typeof value === 'string' && /^U[0-9a-f]{32}$/i.test(value);
export function conversationId(event) {
  const s=event?.source;
  if(s?.type==='group' && /^C[0-9a-f]{32}$/i.test(s.groupId||'')) return s.groupId;
  if(s?.type==='user' && directId(s.userId) && !s.groupId && !s.roomId) return s.userId;
  return '';
}
export function directUofInput(event) {
  if(event?.source?.type!=='user' || !conversationId(event)) return false;
  if(event.type==='postback') return /^uof\./.test(event.postback?.data||'');
  if(event.type!=='message' || event.message?.type!=='text') return false;
  const text=String(event.message.text||'').trim();
  return /^(待簽|代簽|查詢待簽|查詢待辦)$/i.test(text)
    || /^(核准|批次核准)\s+\S/.test(text);
}

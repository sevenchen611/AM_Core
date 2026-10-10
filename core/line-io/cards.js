import { ioError } from './store.js';

// A bounded presentation contract, not arbitrary LINE JSON. Destinations and
// membership are still checked by the gateway before any provider request.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const keys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
export function buildInlineResult(message, action) {
  return {type:'flex',altText:(message + ' ' + action.label).slice(0,1500),contents:{type:'bubble',size:'kilo',
    body:{type:'box',layout:'vertical',paddingAll:'12px',contents:[{type:'box',layout:'horizontal',alignItems:'flex-end',contents:[
      {type:'text',text:message,wrap:true,flex:1},
      {type:'text',text:action.label,color:'#2563EB',decoration:'underline',flex:0,margin:'xs',
        action:{type:'postback',label:action.label,data:action.data}}]}]}}};
}

export function buildReviewCards(cards, altText) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 6) throw ioError(400, 'invalid_cards');
  const bubbles = cards.map(card => {
    if (!object(card) || !keys(card, ['title', 'subtitle', 'eyebrow', 'body', 'fields', 'actions'])
      || !text(card.title, 100) || (card.subtitle !== undefined && !text(card.subtitle, 200))
      || (card.eyebrow !== undefined && !text(card.eyebrow, 80))
      || (card.body !== undefined && !text(card.body, 3000))
      || (card.fields !== undefined && (!Array.isArray(card.fields) || card.fields.length > 12
        || card.fields.some(f => !object(f) || !keys(f, ['label','value']) || !text(f.label,80) || !text(f.value,500))))
      || !Array.isArray(card.actions) || card.actions.length > 12) throw ioError(400, 'invalid_cards');
    const actions = card.actions.map(action => {
      if (!object(action) || !keys(action, ['label','displayText','data','uri','disabled','appearance']) || !text(action.label,20)
        || (action.displayText !== undefined && !text(action.displayText,300))
        || (action.disabled !== undefined && typeof action.disabled !== 'boolean')
        || (action.appearance !== undefined && (!['primary','secondary'].includes(action.appearance) || action.disabled === true))
        || [action.data !== undefined, action.uri !== undefined, action.disabled === true].filter(Boolean).length !== 1)
        throw ioError(400, 'invalid_card_action');
      if (action.disabled) return {type:'box',layout:'vertical',backgroundColor:'#F0F2F4',cornerRadius:'8px',paddingAll:'12px',contents:[{type:'text',text:action.displayText || action.label,size:'sm',align:'center',color:'#9099A3',wrap:true}]};
      if (action.data !== undefined && !text(action.data,300)) throw ioError(400, 'invalid_card_action');
      if (action.uri !== undefined) {
        let uri; try { uri = new URL(action.uri); } catch { throw ioError(400,'invalid_card_action'); }
        if (!text(action.uri,1000) || !['http:','https:'].includes(uri.protocol) || uri.username || uri.password) throw ioError(400,'invalid_card_action');
      }
      const nativeAction = action.data
        ? {type:'postback',label:action.label,data:action.data}
        : {type:'uri',label:action.label,uri:action.uri};
      // Only named palette choices cross the API boundary; raw LINE styles and
      // colors remain invalid. Existing callers retain their action-type theme.
      const primary = (action.appearance ?? (action.data ? 'primary' : 'secondary')) === 'primary';
      // Wrapped, fully clickable filenames without truncating LINE's action label.
      if (action.displayText !== undefined) return {type:'box',layout:'vertical',
        backgroundColor:primary ? '#187566' : '#EAF2EF',cornerRadius:'8px',paddingAll:'12px',action:nativeAction,
        contents:[{type:'text',text:action.displayText,size:'sm',align:'center',color:primary ? '#FFFFFF' : '#18594F',wrap:true}]};
      return {type:'button',style:primary ? 'primary' : 'secondary',color:primary ? '#187566' : '#EAF2EF',height:'sm',action:nativeAction};
    });
    const header = [{type:'text',text:card.eyebrow || 'UOF',size:'xs',weight:'bold',color:'#BFE4D8',wrap:true},
      {type:'text',text:card.title,size:'lg',weight:'bold',color:'#FFFFFF',wrap:true,margin:'sm'}];
    if (card.subtitle) header.push({type:'text',text:card.subtitle,size:'sm',color:'#E0F1EA',wrap:true,margin:'sm'});
    const content = (card.fields || []).map(field => ({type:'box',layout:'horizontal',spacing:'md',contents:[
      {type:'text',text:field.label,size:'sm',color:'#7A8691',flex:2,wrap:true},
      {type:'text',text:field.value,size:'sm',color:'#253742',flex:5,wrap:true}]}));
    if (card.body) content.push({type:'text',text:card.body,size:'sm',color:'#344854',wrap:true,margin:content.length ? 'lg' : 'none'});
    const bubble = {type:'bubble',size:'mega',header:{type:'box',layout:'vertical',paddingAll:'20px',backgroundColor:'#18594F',contents:header},
      body:{type:'box',layout:'vertical',paddingAll:'20px',spacing:'md',contents:content.length ? content : [{type:'text',text:'請選擇下方操作',size:'sm',color:'#7A8691'}]}};
    if (actions.length) bubble.footer={type:'box',layout:'vertical',spacing:'sm',paddingAll:'16px',contents:actions};
    if (Buffer.byteLength(JSON.stringify(bubble)) > 28000) throw ioError(400,'cards_too_large');
    return bubble;
  });
  const contents = bubbles.length === 1 ? bubbles[0] : {type:'carousel',contents:bubbles};
  if (Buffer.byteLength(JSON.stringify(contents)) > 45000) throw ioError(400,'cards_too_large');
  return {type:'flex',altText:[...altText].slice(0,350).join(''),contents};
}

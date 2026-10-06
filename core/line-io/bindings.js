import crypto from 'node:crypto';
import { ioError } from './store.js';
import { createBindingStore } from './binding-store.js';
import { directId, conversationId, directUofInput } from './conversation.js';

const codeHash = code => crypto.createHash('sha256').update(code).digest('hex');
// Separate code namespaces persist the requested mode without a schema change.
// A group code cannot pair a direct chat, or the other way round.
const pairingHash = (code,direct) => codeHash(direct ? 'direct:'+code : code);
export const bindingView = row => row && ({ bindingId:row.id,status:row.status,externalUserId:row.external_user_id,
  groupId:row.group_id,userId:row.user_id,groupName:row.group_name,lineDisplayName:row.user_name,
  conversationType:directId(row.group_id)?'user':'group',
  expiresAt:row.expires_at,lastVerifiedAt:row.checked_at,inputEnabled:row.status==='bound',outputEnabled:row.status==='bound' });

export async function createBindings({pool,store:injectedStore,line,clients,router,env}) {
  const store=injectedStore || createBindingStore(pool);
  let rows=[];
  const consumed=new Map();
  // Only overlapping reads share a lookup. Delivery and binding mutations
  // always start new LINE requests; completed authorization is never cached.
  const checking=new Map();
  const revisions=new Map();
  function invalidate(groupId) {
    revisions.set(groupId,(revisions.get(groupId)||0)+1);
    for(const key of checking.keys()) if(key.startsWith(groupId+'/')) checking.delete(key);
  }
  const refresh=async()=>{rows=await store.all();};
  await refresh();
  function target(client) {
    if(!client.scopes.includes('bindings:write')) throw ioError(403,'scope_denied');
    const value=clients.find(c=>c.id===client.bindingTargetClientId && c.tenantKey===client.tenantKey && c.allowPersonalBindings);
    if(!value) throw ioError(403,'binding_target_unavailable');
    return value;
  }
  async function fetchProof(groupId,userId) {
    const revision=revisions.get(groupId)||0;
    try {
      if(directId(groupId)) {
        if(groupId!==userId) throw ioError(409,'direct_identity_changed');
        const profile=await line.lineGet(`/v2/bot/profile/${userId}`,{timeoutMs:5000});
        if(profile.userId!==userId || revision!==(revisions.get(groupId)||0)) throw ioError(409,'direct_identity_changed');
        return {groupId,userId,groupName:'LINE 1 對 1',userName:profile.displayName||''};
      }
      const [summary,count,userName]=await Promise.all([
        line.lineGet(`/v2/bot/group/${groupId}/summary`,{timeoutMs:5000}),
        line.lineGet(`/v2/bot/group/${groupId}/members/count`,{timeoutMs:5000}),
        line.resolveGroupMemberName(groupId,userId,{timeoutMs:5000}),
      ]);
      if(revision!==(revisions.get(groupId)||0)) throw ioError(409,'group_identity_changed');
      if(count.count!==1) throw ioError(409,'exclusive_group_required');
      return {groupId,userId,groupName:summary.groupName || '',userName};
    } catch(error) {
      if(error.status) throw error;
      throw ioError(error.lineStatus===404 ? 409 : 503,error.lineStatus===404 ? 'group_identity_unavailable' : 'line_lookup_unavailable');
    }
  }
  async function proof(groupId,userId,{fresh=true}={}) {
    if(fresh) return fetchProof(groupId,userId);
    const key=groupId+'/'+userId;
    if(checking.has(key)) return checking.get(key);
    const pending=fetchProof(groupId,userId);
    checking.set(key,pending);
    try {return await pending;}
    finally {if(checking.get(key)===pending) checking.delete(key);}
  }
  async function verified(row,{fresh=false}={}) {
    // A previous request's rows snapshot must not authorize a revoked binding.
    row=await store.get(row.id);
    if(!row) throw ioError(403,'group_unavailable');
    if(row.status!=='bound') return row;
    try {
      const value=await proof(row.group_id,row.user_id,{fresh}); await store.checked(row.id,value);
      const current=await store.get(row.id);
      if(current?.status==='bound' && (current.group_id!==row.group_id || current.user_id!==row.user_id)) throw ioError(403,'group_unavailable');
      return current;
    }
    catch(error) { if(error.status===409) {await store.suspend(row.group_id); await refresh(); return await store.get(row.id);} throw error; }
  }
  async function owned(client,id,account) {
    const value=target(client);
    if(!/^[0-9a-f-]{36}$/i.test(id)||typeof account!=='string'||!account) throw ioError(400,'invalid_binding_request');
    const row=await store.get(id);
    if(!row || row.tenant_key!==value.tenantKey || row.client_id!==value.id || row.external_user_id!==account) throw ioError(404,'binding_not_found');
    return {row,value};
  }
  async function handle(client,method,path,url,body) {
    if(path==='/api/v1/line/bindings/start' && method==='POST') {
      const value=target(client);
      if(!body||typeof body.externalUserId!=='string'||! /^[a-zA-Z0-9_.@-]{1,100}$/.test(body.externalUserId)
        ||typeof body.displayName!=='string'||!body.displayName.trim()||body.displayName.length>100
        ||Object.keys(body).some(k=>!['externalUserId','displayName','replace','conversationType'].includes(k))
        ||(body.conversationType!==undefined&&!['user','group'].includes(body.conversationType))
        ||(body.replace!==undefined&&typeof body.replace!=='boolean')) throw ioError(400,'invalid_binding_request');
      if(!body.replace) {const prior=await store.current(value.tenantKey,value.id,body.externalUserId); if(prior) return {...bindingView(await verified(prior)),oaFriendUrl:env.AMCORE_LINE_BINDING_OA_FRIEND_URL||''};}
      const code=crypto.randomBytes(16).toString('base64url');
      const row=await store.start({id:crypto.randomUUID(),tenantKey:value.tenantKey,clientId:value.id,account:body.externalUserId,
        displayName:body.displayName,hash:pairingHash(code,body.conversationType==='user'),expiresAt:new Date(Date.now()+600000)});
      await refresh();
      return {...bindingView(row),conversationType:body.conversationType||'group',command:`綁定 UOF ${code}`,suggestedGroupName:`${body.displayName} 的 UOF 群`,oaFriendUrl:env.AMCORE_LINE_BINDING_OA_FRIEND_URL || ''};
    }
    const match=/^\/api\/v1\/line\/bindings\/([0-9a-f-]{36})(?:\/(confirm|resume|conversation))?$/.exec(path);
    if(!match) throw ioError(404,'not_found');
    const account=method==='GET'?url.searchParams.get('externalUserId'):body?.externalUserId;
    if(body && Object.keys(body).some(k=>!(match[2]==='conversation'
      ? ['externalUserId','mode','expectedGroupId','expectedUserId','groupId'] : ['externalUserId']).includes(k))) throw ioError(400,'invalid_binding_request');
    const {row,value}=await owned(client,match[1],account);
    let result;
    if(method==='POST'&&match[2]==='conversation') {
      if(!['direct','group'].includes(body.mode) || row.status!=='bound' || body.expectedGroupId!==row.group_id || body.expectedUserId!==row.user_id
        || (body.mode==='direct' && body.groupId!==undefined)
        || (body.mode==='group' && !/^C[0-9a-f]{32}$/i.test(body.groupId||''))) throw ioError(409,'candidate_changed');
      // Migration starts with the existing verified account/LINE identity.
      // No endpoint can nominate another user or bind an arbitrary direct key.
      if((await verified(row,{fresh:true}))?.status!=='bound') throw ioError(409,'binding_not_confirmable');
      const destination=body.mode==='direct'?row.user_id:body.groupId;
      if(body.mode==='group') {
        if(clients.some(c=>c.groupIds.includes(destination)) || (await router.resolveGroupBinding(destination))?.binding) throw ioError(409,'binding_conflict');
      }
      const evidence=await proof(destination,row.user_id);
      invalidate(row.group_id); invalidate(destination);
      result=await store.switchConversation(row.id,value.tenantKey,value.id,account,body.expectedGroupId,evidence);
    }
    else if(method==='GET'&&!match[2]) result=await verified(row);
    else if(method==='POST'&&['confirm','resume'].includes(match[2])) {
      if(!row.group_id||!row.user_id) throw ioError(409,'binding_not_confirmable');
      result=await store.confirm(row.id,value.tenantKey,value.id,account,await proof(row.group_id,row.user_id),match[2]==='resume');
    } else if(method==='DELETE'&&!match[2]) {invalidate(row.group_id);result=await store.revoke(row.id,value.tenantKey,value.id,account);}
    else throw ioError(404,'not_found');
    await refresh(); return {...bindingView(result),oaFriendUrl:env.AMCORE_LINE_BINDING_OA_FRIEND_URL||''};
  }
  async function capture(events) {
    await refresh();
    let mutable=false;
    for(const [id,until] of consumed) if(until<Date.now()) consumed.delete(id);
    for(const event of events) {
      const groupId=conversationId(event);
      if(!groupId) continue;
      if(event.source.type==='user') {
        if(event.type==='unfollow') {invalidate(groupId);await store.suspend(groupId);mutable=true;}
      }
      if(['memberJoined','memberLeft','leave'].includes(event.type)) {invalidate(groupId);await store.suspend(groupId);mutable=true;}
      const text=event.type==='message'&&event.message?.type==='text'?event.message.text:'';
      if(!/^綁定\s+UOF(?:\s|$)/i.test(text)) continue;
      if(typeof event.webhookEventId!=='string'||!event.webhookEventId) throw ioError(400,'event_id_required');
      const match=/^綁定\s+UOF\s+([a-zA-Z0-9_-]{22})\s*$/.exec(text);
      if(!match||!/^U[0-9a-f]{32}$/i.test(event.source.userId||'')) continue;
      if(!Number.isSafeInteger(event.timestamp)||Math.abs(Date.now()-event.timestamp)>600000) continue;
      const hash=pairingHash(match[1],event.source.type==='user');
      if(!await store.findCode(hash)) continue;
      consumed.set(event.webhookEventId,Date.now()+600000);
      try {
        if(clients.some(c=>c.groupIds.includes(groupId))) throw ioError(409,'binding_conflict');
        const route=await router.resolveGroupBinding(groupId);
        if(route?.binding) throw ioError(409,'binding_conflict');
        await store.candidate(hash,event,await proof(groupId,event.source.userId));
        mutable=true;
      } catch(error) { if(error.status<500) continue; throw error; }
    }
    // Ordinary input already loaded the current rows. Binding/member changes
    // still refresh before capture can authorize or persist any event.
    if(mutable) await refresh();
  }
  const active=client=>rows.filter(r=>r.status==='bound'&&r.tenant_key===client.tenantKey&&r.client_id===client.id);
  // The paused general assistant admits only a live, server-issued direct code.
  async function acceptsBindingEvent(event) {
    if(event?.source?.type!=='user'||!conversationId(event)||event.type!=='message'||event.message?.type!=='text') return false;
    if(!event.webhookEventId||!Number.isSafeInteger(event.timestamp)||Math.abs(Date.now()-event.timestamp)>600000) return false;
    const match=/^綁定\s+UOF\s+([a-zA-Z0-9_-]{22})\s*$/.exec(event.message.text||'');
    return Boolean(match && await store.findCode(pairingHash(match[1],true)));
  }
  const lookup=group=>rows.find(r=>r.group_id===group&&['bound','suspended'].includes(r.status)) || rows.find(r=>r.group_id===group);
  const owns=event=>consumed.has(event?.webhookEventId)||rows.some(r=>r.group_id===conversationId(event)
    && (event?.source?.type==='group' || (event?.source?.userId===r.user_id &&
      (directUofInput(event) || event.type==='unfollow'))));
  return {handle,capture,active,lookup,owns,verified,refresh,acceptsBindingEvent};
}

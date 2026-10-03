import crypto from 'node:crypto';
import { ioError } from './store.js';
import { createBindingStore } from './binding-store.js';

const codeHash = code => crypto.createHash('sha256').update(code).digest('hex');
export const bindingView = row => row && ({ bindingId:row.id,status:row.status,externalUserId:row.external_user_id,
  groupId:row.group_id,userId:row.user_id,groupName:row.group_name,lineDisplayName:row.user_name,
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
    try { const value=await proof(row.group_id,row.user_id,{fresh}); await store.checked(row.id,value); return await store.get(row.id); }
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
        ||Object.keys(body).some(k=>!['externalUserId','displayName','replace'].includes(k))
        ||(body.replace!==undefined&&typeof body.replace!=='boolean')) throw ioError(400,'invalid_binding_request');
      if(!body.replace) {const prior=await store.current(value.tenantKey,value.id,body.externalUserId); if(prior) return bindingView(await verified(prior));}
      const code=crypto.randomBytes(16).toString('base64url');
      const row=await store.start({id:crypto.randomUUID(),tenantKey:value.tenantKey,clientId:value.id,account:body.externalUserId,
        displayName:body.displayName,hash:codeHash(code),expiresAt:new Date(Date.now()+600000)});
      await refresh();
      return {...bindingView(row),command:`綁定 UOF ${code}`,suggestedGroupName:`${body.displayName} 的 UOF 群`,oaFriendUrl:env.AMCORE_LINE_BINDING_OA_FRIEND_URL || ''};
    }
    const match=/^\/api\/v1\/line\/bindings\/([0-9a-f-]{36})(?:\/(confirm|resume))?$/.exec(path);
    if(!match) throw ioError(404,'not_found');
    const account=method==='GET'?url.searchParams.get('externalUserId'):body?.externalUserId;
    if(body && Object.keys(body).some(k=>k!=='externalUserId')) throw ioError(400,'invalid_binding_request');
    const {row,value}=await owned(client,match[1],account);
    let result;
    if(method==='GET'&&!match[2]) result=await verified(row);
    else if(method==='POST'&&['confirm','resume'].includes(match[2])) {
      if(!row.group_id||!row.user_id) throw ioError(409,'binding_not_confirmable');
      result=await store.confirm(row.id,value.tenantKey,value.id,account,await proof(row.group_id,row.user_id),match[2]==='resume');
    } else if(method==='DELETE'&&!match[2]) {invalidate(row.group_id);result=await store.revoke(row.id,value.tenantKey,value.id,account);}
    else throw ioError(404,'not_found');
    await refresh(); return bindingView(result);
  }
  async function capture(events) {
    await refresh();
    for(const [id,until] of consumed) if(until<Date.now()) consumed.delete(id);
    for(const event of events) {
      const groupId=event?.source?.type==='group'?event.source.groupId:null;
      if(!groupId) continue;
      if(['memberJoined','memberLeft','leave'].includes(event.type)) {invalidate(groupId);await store.suspend(groupId);}
      const text=event.type==='message'&&event.message?.type==='text'?event.message.text:'';
      if(!/^綁定\s+UOF(?:\s|$)/i.test(text)) continue;
      if(typeof event.webhookEventId!=='string'||!event.webhookEventId) throw ioError(400,'event_id_required');
      consumed.set(event.webhookEventId,Date.now()+600000);
      const match=/^綁定\s+UOF\s+([a-zA-Z0-9_-]{22})\s*$/.exec(text);
      if(!match||!/^U[0-9a-f]{32}$/i.test(event.source.userId||'')) continue;
      if(!Number.isSafeInteger(event.timestamp)||Math.abs(Date.now()-event.timestamp)>600000) continue;
      if(!await store.findCode(codeHash(match[1]))) continue;
      try {
        if(clients.some(c=>c.groupIds.includes(groupId))) throw ioError(409,'binding_conflict');
        const route=await router.resolveGroupBinding(groupId);
        if(route?.binding) throw ioError(409,'binding_conflict');
        await store.candidate(codeHash(match[1]),event,await proof(groupId,event.source.userId));
      } catch(error) { if(error.status<500) continue; throw error; }
    }
    await refresh();
  }
  const active=client=>rows.filter(r=>r.status==='bound'&&r.tenant_key===client.tenantKey&&r.client_id===client.id);
  const lookup=group=>rows.find(r=>r.group_id===group&&['bound','suspended'].includes(r.status)) || rows.find(r=>r.group_id===group);
  const owns=event=>consumed.has(event?.webhookEventId)||rows.some(r=>r.group_id===event?.source?.groupId);
  return {handle,capture,active,lookup,owns,verified,refresh};
}

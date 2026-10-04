import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import pg from 'pg';
import {createClaimsAuthorityIntegration} from '../modules/claims/authority-integration.js';
import {renderStaffEntry} from '../modules/claims/staff-entry.js';
test('standalone LINE form revalidates each request and cannot proxy admin APIs or forge authority',async()=>{
 const tenant={tenantId:'00000000-0000-4000-8000-000000000001',key:'hozo-am-2-0'},secret='synthetic-fixture-key-at-least-32-bytes',sid='11111111-1111-4111-8111-111111111111',expiry=Date.now()+60000;
 const token=`fs1.${sid}.${expiry}.${crypto.createHmac('sha256',secret).update(`form-selector:v1:${sid}:${expiry}`).digest('base64url')}`;
 const cipher=value=>{const key=crypto.createHash('sha256').update('encryption:'+secret).digest(),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return ['fixed-v1',iv.toString('base64url'),c.getAuthTag&&(()=>{const b=Buffer.concat([c.update(value),c.final()]);return c.getAuthTag().toString('base64url')+'.'+b.toString('base64url')})()].join('.')};
 let enabled=true,deny=false,identity=true,mode='internal_v3',selected='mobile_expense_entry',calls=[];
 const row={session_id:sid,expires_at:new Date(expiry).toISOString(),group_state:'active',oa_state:'present',member_state:'observed',group_lookup:'a'.repeat(64),group_ciphertext:cipher('synthetic-group'),binding_ciphertext:cipher('synthetic-binding'),member_ciphertext:cipher('U'+'a'.repeat(32)),available_form_keys:['mobile_expense_entry'],finance_source_ref:'source-hozo-company-group'};
 const query=async sql=>({rows:sql.includes('ca:resolve-form-session')?[{...row,selected_form_key:selected,claim_mode:mode,manual_deny:deny}]:sql.includes('ca:current-form-routing')?[{form_key:'mobile_expense_entry',enabled}]:[]});
 const Pool=pg.Pool;pg.Pool=class{on(){}async query(sql){return query(sql)}async connect(){return {query,release(){}}}};
 try {
  const fail=async()=>{throw Error('No V3 bridge allowed')};
  const integration=createClaimsAuthorityIntegration({env:{HZ2_CLAIMS_AUTHORITY_ENABLED:'true',HZ2_CLAIMS_AUTHORITY_IDENTITY_KEY:secret,HZ2_FINANCE_CLAIMS_V3_DATABASE_URL:'postgresql://synthetic:synthetic@localhost/synthetic'},platform:{},groupEntry:{enqueue:fail},receiver:{bridgeMembership:fail,bridgeWebEntry:fail},claimsLiffId:()=> 'synthetic-liff',verifyLiffUser:async()=>({ok:identity,displayName:'Verified sender'}),staffEntryRequest:async ({payload})=>{calls.push(payload);return {ok:true,claimNo:'SYNTHETIC',status:'waiting_review'}}});
  async function call(body,method='POST'){let status,result;const req=Readable.from(method==='POST'?[Buffer.from(JSON.stringify({selectorToken:token,liffAccessToken:'synthetic',...body}))]:[]);req.method=method;const res={writeHead(code){status=code},end(v){result=v}};await integration.handleSelector(req,res,{tenant,token});return {status,result}}
  const page=await call({},'GET');assert.equal(page.status,200);assert(page.result.includes('finance-line-staff-entry-v2'));assert(!page.result.includes('admin-auth.js'));assert(!page.result.includes('href="/admin-'));
  assert.equal((await call({action:'mobile_submit',direction:'in',amount:30001,sourceId:'forged',tenantKey:'other',applicant:{userId:'forged'},internalGroup:false,url:'/api/finance/transactions',businessUnitType:'project',businessUnitId:'p1'})).status,201);
  assert.equal(calls[0].sourceId,'source-hozo-company-group');assert.equal(calls[0].applicant.userId,'U'+'a'.repeat(32));assert.equal(calls[0].applicant.name,'Verified sender');assert.equal(calls[0].tenantKey,tenant.key);assert.equal(calls[0].internalGroup,true);assert(!calls[0].url);assert.equal(calls[0].action,'submit');
  for(const action of ['mobile_options','mobile_recognize'])assert.equal((await call({action})).status,200);
  assert.equal((await call({action:'mobile_admin'})).status,400);
  for(const blocked of ['deny','identity','enabled','mode','selected']){if(blocked==='deny')deny=true;if(blocked==='identity')identity=false;if(blocked==='enabled')enabled=false;if(blocked==='mode')mode='external_claim_only';if(blocked==='selected')selected=null;assert.equal((await call({action:'mobile_options'})).status,400,blocked);deny=false;identity=true;enabled=true;mode='internal_v3';selected='mobile_expense_entry';}
  assert.equal(calls.length,3);
 }finally{pg.Pool=Pool}
});
test('mobile template has both directions, isolated preview and safe embedded session data',()=>{
 const h=renderStaffEntry({token:'</script><script>forged</script>',liffId:'synthetic'});assert(h.includes('data-dir="in"'));assert(h.includes('data-dir="out"'));assert(!h.includes('hozoAuth'));assert(!h.includes('</script><script>forged'));assert(h.includes('30,000'));new Function(h.match(/<script>([\s\S]*?)<\/script>/)[1]);
 const p=renderStaffEntry({preview:true});assert(p.includes('const claimPreview=DATA.preview'));assert(p.includes('if (claimPreview) return;'));assert(p.includes('submitBtn.disabled=claimPreview'));
});

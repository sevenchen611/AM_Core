import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createClaimsAuthority,isRetiredClaimForm} from '../core/claims-authority.js';
import {createClaimsAuthorityAdminHandler,renderClaimsAuthorityAdminPage} from '../core/claims-authority-admin.js';

const owner={subject:'synthetic-owner',roles:['claims_access_admin']};
const tenant={tenantId:'00000000-0000-4000-8000-000000000001',key:'hozo-am-2-0'};
const other={tenantId:'00000000-0000-4000-8000-000000000002',key:'synthetic-other'};
const schema=await readFile(new URL('../versions/AM-IMP-2026.1004.01/config/claims-form-availability.sql',import.meta.url),'utf8');

test('real schema is idempotent, tenant isolated, audited and preserves assignments',async()=>{
 const db=new PGlite();
 try{
 await db.exec('CREATE SCHEMA am_claims; CREATE ROLE am_claims_tenant; CREATE ROLE am_claims_platform_owner; CREATE ROLE am_claims_auditor; GRANT USAGE ON SCHEMA am_claims TO am_claims_tenant; CREATE TABLE am_claims.audit(tenant_id uuid,action text,subject_lookup text,actor_subject text,detail jsonb); GRANT INSERT ON am_claims.audit TO am_claims_tenant;');
 await db.exec(schema);await db.exec(schema);
 const store={transaction:async(t,work)=>{await db.exec('BEGIN;SET LOCAL ROLE am_claims_tenant;');await db.query("SELECT set_config('app.tenant_id',$1,true)",[t.tenantId]);try{const r=await work(db);await db.exec('COMMIT');return r}catch(e){await db.exec('ROLLBACK');throw e}}};
 const authority=createClaimsAuthority({store,identityKey:'synthetic-fixture-key-at-least-32-bytes'});
 await authority.setFormEnabled({tenant,actor:owner,formKey:'legacy_other',enabled:false});
 assert.equal((await authority.listForms({tenant,actor:owner})).find(f=>f.key==='legacy_other').enabled,false);
 assert.equal((await authority.listForms({tenant:other,actor:owner})).find(f=>f.key==='legacy_other').enabled,true);
 assert.equal((await authority.listForms({tenant,actor:owner})).find(f=>f.key==='employee_expense').retired,true);
 await assert.rejects(authority.setFormEnabled({tenant,actor:owner,formKey:'employee_expense',enabled:true}),/退場/);
 await assert.rejects(authority.setFormEnabled({tenant,actor:{roles:['auditor']},formKey:'legacy_other',enabled:true}),/access denied/);
 await assert.rejects(authority.setFormEnabled({tenant,actor:owner,formKey:'legacy_other',enabled:'false'}),/指定/);
 await authority.setFormEnabled({tenant,actor:owner,formKey:'legacy_other',enabled:true});
 assert.equal((await authority.listForms({tenant,actor:owner})).find(f=>f.key==='legacy_other').enabled,true);
 const audit=await db.query('SELECT action,detail FROM am_claims.audit');assert.equal(audit.rows.length,2);
 await store.transaction(tenant,async client=>{const r=await client.query('SELECT * FROM am_claims.form_availability WHERE tenant_id=$1',[other.tenantId]);assert.equal(r.rows.length,0);await assert.rejects(client.query('INSERT INTO am_claims.form_availability(tenant_id,form_key,enabled) VALUES($1,$2,false)',[other.tenantId,'legacy_other']),/row-level security/);});
 }finally{await db.close()}
});

// Ciphertext fixture is generated locally; no production identity appears in tests.
function fixtureCipher(value){const key=crypto.createHash('sha256').update('encryption:synthetic-fixture-key-at-least-32-bytes').digest(),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(value),c.final()]);return ['fixed-v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.')}

test('existing selected links lose cached URLs; retired V3 and disabled legacy cannot be selected',async()=>{
 let enabled=false;const row={session_id:'11111111-1111-4111-8111-111111111111',expires_at:new Date(Date.now()+60000).toISOString(),group_state:'active',oa_state:'present',member_state:'observed',manual_deny:false,group_lookup:'a'.repeat(64),group_ciphertext:fixtureCipher('synthetic-group'),binding_ciphertext:fixtureCipher('synthetic-binding'),member_ciphertext:fixtureCipher('synthetic-user'),available_form_keys:['legacy_other','employee_expense'],selected_form_key:'legacy_other',resolved_url:'https://synthetic.invalid/old',claim_mode:'internal_v3'};
 const store={transaction:async(t,work)=>work({query:async sql=>{if(sql.includes('ca:resolve-form-session'))return {rows:[row]};if(sql.includes('ca:current-form-routing'))return {rows:[{form_key:'legacy_other',enabled},{form_key:'employee_expense',enabled:true}]};if(sql.includes('ca:complete-form-session')){assert(sql.includes('form_availability'));return {rows:enabled?[{session_id:row.session_id}]:[]}}throw Error(sql)}})};
 const authority=createClaimsAuthority({store,identityKey:'synthetic-fixture-key-at-least-32-bytes'});
 let r=await authority.resolveFormSelection({tenant,sessionId:row.session_id});assert.deepEqual(r.formKeys,[]);assert.equal(r.resolvedUrl,'');assert.equal(r.selectedFormKey,'');
 await assert.rejects(authority.resolveFormSelection({tenant,sessionId:row.session_id,formKey:'legacy_other'}),/不適用/);
 await assert.rejects(authority.resolveFormSelection({tenant,sessionId:row.session_id,formKey:'employee_expense'}),/不適用/);
 await assert.rejects(authority.completeFormSelection({tenant,sessionId:row.session_id,formKey:'legacy_other',resolvedUrl:'https://synthetic.invalid'}));
 enabled=true;r=await authority.resolveFormSelection({tenant,sessionId:row.session_id,formKey:'legacy_other'});assert.deepEqual(r.formKeys,['legacy_other']);assert.equal(r.claimMode,'external_claim_only');
 assert.equal(isRetiredClaimForm(other,'employee_expense'),false);
});

test('admin availability endpoint validates role/CSRF and boolean body, UI has explicit controls',async()=>{
 let verified=0,calls=0;const authority={listForms:async()=>[{key:'legacy_other',enabled:true}],setFormEnabled:async(input)=>{calls++;assert.equal(input.tenant,tenant);assert.equal(input.enabled,false);return {ok:true}}};
 const handler=createClaimsAuthorityAdminHandler({authority,resolveContext:async()=>({tenant,actor:owner}),resolveTarget:async()=>{},listTargets:async()=>[],verifyMutation:async(req)=>{verified++;if(req.csrf!=='valid')throw Error('Forbidden')}});
 const request=(path,method='GET',body={},csrf='valid')=>({url:'https://synthetic.invalid/claims-authority/api'+path,method,csrf,json:async()=>body});
 assert.equal((await handler(request('/forms'))).status,200);
 assert.equal((await handler(request('/forms/legacy_other/availability','POST',{enabled:false},'invalid'))).status,403);assert.equal(calls,0);
 assert.equal((await handler(request('/forms/legacy_other/availability','POST',{enabled:false}))).status,200);assert.equal(calls,1);assert.equal(verified,2);
 const html=renderClaimsAuthorityAdminPage({tenantKey:tenant.key});assert(html.includes('停用請款單'));assert(html.includes('已停用表單與歷史'));assert(html.includes('data-toggle-form'));const inline=html.match(/<script>([\s\S]*?)<\/script>/)[1];new Function(inline);
});

test('HOZO command filters retired/disabled forms and cannot fall back to V3 when unconfigured',async()=>{
 let formRows=[{revision:1,form_key:'employee_expense',enabled:true},{revision:1,form_key:'legacy_other',enabled:true},{revision:1,form_key:'legacy_social_insurance',enabled:false}];let opened=0;
 const store={transaction:async(t,work)=>work({query:async(sql)=>{if(sql.includes('ca:event'))return {rows:[{event_key:'synthetic'}]};if(sql.includes('ca:authorize'))return {rows:[{group_state:'active',oa_state:'present',member_state:'observed',manual_deny:false,claim_mode:'internal_v3'}]};if(sql.includes('ca:form-routing'))return {rows:formRows};return {rows:[]}}})};
 const authority=createClaimsAuthority({store,identityKey:'synthetic-fixture-key-at-least-32-bytes',openV3Claim:async({routing})=>{opened++;assert.deepEqual(routing.availableForms,['legacy_other']);assert.equal(routing.claimMode,'external_claim_only');return {}}});
 const input={tenant:{...tenant,config:{claims:{authorityRegistry:{mode:'enforce'}}}},binding:{pageId:'synthetic-binding'},event:{type:'message',webhookEventId:'synthetic-event',source:{groupId:'synthetic-group',userId:'synthetic-user'},message:{text:'請款'}}};
 const r=await authority.handleEvent(input);assert.equal(r.claim.ok,true);assert.equal(opened,1);
 formRows=[];const empty=await authority.handleEvent(input);assert.equal(empty.claim.reason,'no_forms_published');assert.equal(opened,1);
});

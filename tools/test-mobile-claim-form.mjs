import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {createClaimsAuthority,mobileFormAllowed} from '../core/claims-authority.js';
import {createClaimsAuthorityIntegration} from '../modules/claims/authority-integration.js';
import {renderClaimsAuthorityAdminPage} from '../core/claims-authority-admin.js';
const tenant={tenantId:'00000000-0000-4000-8000-000000000001',key:'hozo-am-2-0'};
const secret='synthetic-fixture-key-at-least-32-bytes';
function cipher(value){const key=crypto.createHash('sha256').update('encryption:'+secret).digest(),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(value),c.final()]);return ['fixed-v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.')}
test('mobile selector bypasses V3 and rechecks internal mode, sender, denial and availability',async()=>{
 const sid='11111111-1111-4111-8111-111111111111',expiry=Date.now()+60000;
 const token=`fs1.${sid}.${expiry}.${crypto.createHmac('sha256',secret).update(`form-selector:v1:${sid}:${expiry}`).digest('base64url')}`;
 let mode='internal_v3',deny=false,enabled=true,identity=true,bridges=0,links=0,completions=0;
 const forms=['legacy_other','mobile_expense_entry'];
 const row={session_id:sid,expires_at:new Date(expiry).toISOString(),group_state:'active',oa_state:'present',member_state:'observed',group_lookup:'a'.repeat(64),group_ciphertext:cipher('synthetic-group'),binding_ciphertext:cipher('synthetic-binding'),member_ciphertext:cipher('synthetic-user'),available_form_keys:forms,finance_source_ref:'synthetic-source'};
 const query=async sql=>{
  if(sql.includes('ca:resolve-form-session'))return {rows:[{...row,claim_mode:mode,manual_deny:deny}]};
  if(sql.includes('ca:current-form-routing'))return {rows:forms.map(form_key=>({form_key,enabled}))};
  if(sql.includes('ca:complete-form-session')){completions++;return {rows:[{session_id:sid}]}};
  return {rows:[]};
 };
 const Pool=pg.Pool;pg.Pool=class{on(){}async query(sql){return query(sql)}async connect(){return {query,release(){}}}};
 try{
 const bridge=async()=>{bridges++;throw Error('V3 must never be called');};
 const integration=createClaimsAuthorityIntegration({env:{HZ2_CLAIMS_AUTHORITY_ENABLED:'true',HZ2_CLAIMS_AUTHORITY_IDENTITY_KEY:secret,HZ2_FINANCE_CLAIMS_V3_DATABASE_URL:'postgresql://synthetic:synthetic@localhost/synthetic'},platform:{},groupEntry:{enqueue:bridge},receiver:{bridgeMembership:bridge,bridgeWebEntry:bridge},verifyLiffUser:async()=>({ok:identity}),createMobileFormLink:async()=>{links++;return 'https://synthetic.invalid/admin-finance-mobile?mode=claim';}});
 async function select(selectorToken=token,t=tenant){let status,body;const req=Readable.from([Buffer.from(JSON.stringify({action:'select',selectorToken,liffAccessToken:'synthetic-access',formKey:'mobile_expense_entry'}))]);req.method='POST';const res={writeHead(code){status=code},end(text){body=JSON.parse(text)}};await integration.handleSelector(req,res,{tenant:t,token});return {status,body}}
 assert.equal((await select()).status,200);assert.equal(links,1);assert.equal(completions,1);
 mode='external_claim_only';assert.equal((await select()).status,400);mode='internal_v3';
 deny=true;assert.equal((await select()).status,400);deny=false;
 enabled=false;assert.equal((await select()).status,400);enabled=true;
 identity=false;assert.equal((await select()).status,400);identity=true;
 assert.equal((await select('tampered')).status,400);assert.equal((await select(token,{...tenant,key:'another-tenant'})).status,400);
 assert.equal(links,1);assert.equal(bridges,0);
 }finally{pg.Pool=Pool}
});
test('publication and inventory are limited to HOZO internal staff',async()=>{
 const actor={roles:['claims_access_admin'],subject:'synthetic-owner'};let mode='external_claim_only';
 const store={transaction:async(t,work)=>work({query:async sql=>({rows:sql.includes('ca:form-groups-eligible')?[{group_lookup:'a'.repeat(64),claim_mode:mode}]:[]})})};
 const authority=createClaimsAuthority({store,identityKey:secret});
 await assert.rejects(authority.publishFormGroups({tenant,actor,formKey:'mobile_expense_entry',groupLookups:['a'.repeat(64)]}),/內部/);
 mode='internal_v3';assert.equal((await authority.publishFormGroups({tenant,actor,formKey:'mobile_expense_entry',groupLookups:['a'.repeat(64)]})).assignedCount,1);
 await assert.rejects(authority.publishFormGroups({tenant:{...tenant,key:'other'},actor,formKey:'mobile_expense_entry',groupLookups:[]}),/HOZO/);
 assert.equal(mobileFormAllowed(tenant,'mobile_expense_entry','external_claim_only'),false);
 const html=renderClaimsAuthorityAdminPage({tenantKey:tenant.key,financeBaseUrl:'https://synthetic.invalid'});assert.match(html,/admin-finance-mobile\?mode=claim&amp;preview=1|admin-finance-mobile\?mode=claim&preview=1/);new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 assert(!renderClaimsAuthorityAdminPage({tenantKey:'other'}).includes('data-form-key="mobile_expense_entry"'));
});
test('schema expands three real key constraints idempotently and preserves old records',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE SCHEMA am_claims;
 CREATE TABLE am_claims.group_forms(form_key TEXT CHECK(form_key IN('legacy_other','employee_expense')));
 CREATE TABLE am_claims.form_selection_sessions(selected_form_key TEXT CHECK(selected_form_key IS NULL OR selected_form_key IN('legacy_other','employee_expense')));
 CREATE TABLE am_claims.form_availability(form_key TEXT CHECK(form_key IN('legacy_other','employee_expense')));
 INSERT INTO am_claims.group_forms VALUES('legacy_other');`);
 const sql=await readFile(new URL('../versions/AM-IMP-2026.1004.03/config/mobile-claim-form.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 for(const [table,column] of [['group_forms','form_key'],['form_selection_sessions','selected_form_key'],['form_availability','form_key']])await db.query(`INSERT INTO am_claims.${table}(${column})VALUES($1)`,['mobile_expense_entry']);
 assert.equal((await db.query("SELECT COUNT(*) n FROM am_claims.group_forms WHERE form_key='legacy_other'")).rows[0].n,1);
 await assert.rejects(db.query("INSERT INTO am_claims.form_availability VALUES('unknown')"));
 }finally{await db.close()}
});

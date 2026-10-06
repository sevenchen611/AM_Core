import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {loadTenants} from '../core/tenants.js';
const key=process.argv[2];
const tenant=loadTenants(process.env,{warn(){}}).find(t=>t.key===key);
if(!tenant)throw new Error('Provide a known tenant key.');
const sql=await readFile(new URL('../versions/AM-IMP-2026.1006.07/schemas/leaf-calendar.sql',import.meta.url),'utf8');
if(!process.argv.includes('--apply')){console.log(JSON.stringify({dryRun:true,tenant:key,tables:['pairings','bindings','requests']}));process.exit(0);}
const prefix=tenant.envPrefix,connectionPrefix=tenant.operationalMemory?.connectionEnvPrefix||prefix;
const read=name=>process.env[`${prefix}_${name}`]||process.env[`${connectionPrefix}_${name}`];
const migrationUrl=read('AM_MEMORY_MIGRATION_DATABASE_URL'),runtimeUrl=read('AM_MEMORY_DATABASE_URL');
if(!migrationUrl||!runtimeUrl)throw new Error('Project-local migration and runtime database settings are required.');
const ssl=['1','true','require'].includes(String(read('AM_MEMORY_DATABASE_SSL')))?{rejectUnauthorized:false}:undefined;
const runtime=new pg.Client({connectionString:runtimeUrl,ssl});
const migration=new pg.Client({connectionString:migrationUrl,ssl});
try{
  await runtime.connect();
  const identity=(await runtime.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(identity.rolsuper||identity.rolbypassrls)throw new Error('Runtime role must enforce tenant RLS.');
  await migration.connect();await migration.query('BEGIN');await migration.query(sql);
  const role='"'+identity.name.replaceAll('"','""')+'"';
  await migration.query(`GRANT USAGE ON SCHEMA leaf_calendar TO ${role}`);
  await migration.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA leaf_calendar TO ${role}`);
  await migration.query('COMMIT');
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.tenant_id',$1,true)",[tenant.tenantId]);
  await runtime.query('SELECT request_id FROM leaf_calendar.requests LIMIT 0');await runtime.query('COMMIT');
  console.log(JSON.stringify({ok:true,tenant:key,forcedRls:true}));
}catch(error){await migration.query('ROLLBACK').catch(()=>{});console.error('Calendar schema setup failed. '+(error.code||'SETUP_ERROR'));process.exitCode=1;}
finally{await runtime.end().catch(()=>{});await migration.end().catch(()=>{});}

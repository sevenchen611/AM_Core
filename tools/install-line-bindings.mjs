import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
const url=process.env.LINE_BINDINGS_MIGRATION_DATABASE_URL,role=process.env.LINE_BINDINGS_RUNTIME_ROLE;
if(!url||!/^[a-z_][a-z0-9_]{0,62}$/.test(role||''))throw new Error('Provide private migration URL and validated runtime role');
const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
try {
  await pool.query('BEGIN');
  await pool.query(await readFile(new URL('../versions/AM-IMP-2026.0929.04/schemas/line-bindings.sql',import.meta.url),'utf8'));
  await pool.query(`GRANT USAGE ON SCHEMA line_bindings TO "${role}"`);
  await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA line_bindings TO "${role}"`);
  // Existing event RLS remains authoritative; cleanup is restricted by personal binding IDs and configured client IDs.
  await pool.query(`GRANT DELETE ON line_io.line_io_events,line_io.line_io_sends TO "${role}"`);
  await pool.query('COMMIT');
  console.log('Personal LINE binding schema installed; no live rows or secrets exported.');
}catch {await pool.query('ROLLBACK').catch(()=>{});console.error('Migration failed; check private credentials, existing IO schema and runtime role.');process.exitCode=1;}
finally {await pool.end();}

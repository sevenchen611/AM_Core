// Run with a migration administrator URL in LINE_DIRECTORY_MIGRATION_DATABASE_URL.
// No credentials or deployment-specific role names are stored in this repository.
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const connectionString = process.env.LINE_DIRECTORY_MIGRATION_DATABASE_URL;
const role = process.env.LINE_DIRECTORY_RUNTIME_ROLE;
if (!connectionString || !/^[a-z_][a-z0-9_]{0,62}$/.test(role || '')) {
  throw new Error('Provide a migration administrator URL and a validated runtime role name in the environment');
}
const pool = new Pool({ connectionString,ssl:{ rejectUnauthorized:true },max:1,connectionTimeoutMillis:10000,statement_timeout:15000 });
try {
  await pool.query(await readFile(new URL('../versions/AM-IMP-2026.0929.03/schemas/line-directory.sql',import.meta.url),'utf8'));
  await pool.query(`GRANT USAGE ON SCHEMA line_directory TO "${role}"`);
  await pool.query(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA line_directory TO "${role}"`);
  console.log('LINE directory migration and restricted metadata grants completed; message RLS was not changed.');
} catch {
  console.error('LINE directory migration failed; verify the private migration credentials and role.');
  process.exitCode = 1;
} finally { await pool.end(); }

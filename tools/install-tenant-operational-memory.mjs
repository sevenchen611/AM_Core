// Install the AM-IMP-2026.0718.01 PostgreSQL foundation for one AM Platform tenant.
// Secrets are read only from the process environment and never printed.
//
// Usage:
//   node --env-file=.env tools/install-tenant-operational-memory.mjs forest

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadTenants } from '../core/tenants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tenantKey = String(process.argv[2] || '').trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!tenantKey) throw new Error('Usage: node --env-file=.env tools/install-tenant-operational-memory.mjs <tenant-key>');

const tenant = loadTenants(process.env, { warn: () => {} }).find((item) => item.key === tenantKey);
if (!tenant) throw new Error(`Unknown tenant: ${tenantKey}`);
if (!UUID_RE.test(String(tenant.tenantId || ''))) throw new Error(`Tenant ${tenantKey} has no valid tenantId.`);

const prefix = tenant.envPrefix;
const connectionPrefix = String(tenant.operationalMemory?.connectionEnvPrefix || prefix).toUpperCase();
const migrationUrl = process.env[`${prefix}_AM_MEMORY_MIGRATION_DATABASE_URL`]
  || process.env[`${connectionPrefix}_AM_MEMORY_MIGRATION_DATABASE_URL`]
  || process.env.AM_MEMORY_MIGRATION_DATABASE_URL
  || '';
const runtimeUrl = process.env[`${prefix}_AM_MEMORY_DATABASE_URL`]
  || process.env[`${connectionPrefix}_AM_MEMORY_DATABASE_URL`]
  || process.env.AM_MEMORY_DATABASE_URL
  || '';
if (!migrationUrl) throw new Error(`${prefix}_AM_MEMORY_MIGRATION_DATABASE_URL is required.`);
if (!runtimeUrl) throw new Error(`${prefix}_AM_MEMORY_DATABASE_URL is required.`);

function poolConfig(connectionString) {
  const ssl = String(process.env[`${prefix}_AM_MEMORY_DATABASE_SSL`]
    || process.env[`${connectionPrefix}_AM_MEMORY_DATABASE_SSL`]
    || process.env.AM_MEMORY_DATABASE_SSL
    || '').toLowerCase();
  return {
    connectionString,
    max: 1,
    connectionTimeoutMillis: 15_000,
    ssl: ['1', 'true', 'require'].includes(ssl) ? { rejectUnauthorized: false } : undefined,
  };
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Unsafe PostgreSQL identifier.');
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function identity(pool) {
  const result = await pool.query('SELECT current_user, current_database(), version() AS version');
  return result.rows[0];
}

async function hasSchema(pool) {
  const result = await pool.query("SELECT to_regclass('am_memory.source_records') IS NOT NULL AS present");
  return Boolean(result.rows[0]?.present);
}

async function verifySchema(pool) {
  const expected = [
    'tenants', 'source_records', 'raw_messages', 'processing_jobs', 'events',
    'event_sources', 'tasks', 'task_history', 'decisions', 'knowledge_items',
    'access_grants', 'answer_logs', 'projection_outbox',
  ];
  const result = await pool.query(
    `SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'am_memory' AND tablename = ANY($1::text[])`,
    [expected],
  );
  const found = new Set(result.rows.map((row) => row.tablename));
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Operational-memory schema is incomplete: ${missing.join(', ')}`);
}

async function seedTenant(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
    await client.query(
      `INSERT INTO am_memory.tenants (tenant_id, tenant_key, display_name, status, settings)
       VALUES ($1, $2, $3, 'active', $4::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET
         tenant_key = EXCLUDED.tenant_key,
         display_name = EXCLUDED.display_name,
         settings = am_memory.tenants.settings || EXCLUDED.settings,
         updated_at = clock_timestamp()`,
      [tenant.tenantId, tenant.key, tenant.displayName,
        JSON.stringify({ packageVersion: 'AM-IMP-2026.0718.01', activationMode: 'shadow' })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function grantRuntimeRole(pool, runtimeRole) {
  const role = quoteIdentifier(runtimeRole);
  await pool.query(`GRANT USAGE ON SCHEMA am_memory TO ${role}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA am_memory TO ${role}`);
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA am_memory TO ${role}`);
  await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA am_memory TO ${role}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA am_memory GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA am_memory GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA am_memory GRANT EXECUTE ON FUNCTIONS TO ${role}`);
}

async function ensureRuntimeRole(pool, connectionString) {
  const parsed = new URL(connectionString);
  const username = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  if (!username || !password) throw new Error('Runtime database URL must include a username and password.');
  const role = quoteIdentifier(username);
  const secret = quoteLiteral(password);
  const existing = await pool.query(
    'SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = $1',
    [username],
  );
  if (!existing.rowCount) {
    await pool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${secret}`);
  } else if (existing.rows[0].rolsuper || existing.rows[0].rolcreatedb || existing.rows[0].rolcreaterole) {
    throw new Error('Existing runtime role has unsafe administrative privileges.');
  }
}

async function verifyRuntimeIsolation(pool) {
  const noContext = await pool.query('SELECT count(*)::int AS count FROM am_memory.tenants');
  if (Number(noContext.rows[0]?.count) !== 0) throw new Error('RLS fails closed check: runtime role can read without tenant context.');

  const ownClient = await pool.connect();
  try {
    await ownClient.query('BEGIN');
    await ownClient.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
    const own = await ownClient.query('SELECT tenant_key FROM am_memory.tenants');
    if (own.rows.length !== 1 || own.rows[0].tenant_key !== tenant.key) {
      throw new Error('RLS own-tenant check failed.');
    }
    await ownClient.query('COMMIT');
  } catch (error) {
    await ownClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    ownClient.release();
  }

  const otherClient = await pool.connect();
  try {
    await otherClient.query('BEGIN');
    await otherClient.query("SELECT set_config('app.tenant_id', $1, true)", ['00000000-0000-4000-8000-000000000099']);
    const other = await otherClient.query('SELECT count(*)::int AS count FROM am_memory.tenants');
    if (Number(other.rows[0]?.count) !== 0) throw new Error('RLS cross-tenant check failed.');
    await otherClient.query('COMMIT');
  } catch (error) {
    await otherClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    otherClient.release();
  }
}

const migrationPool = new pg.Pool(poolConfig(migrationUrl));
const runtimePool = new pg.Pool(poolConfig(runtimeUrl));
try {
  await ensureRuntimeRole(migrationPool, runtimeUrl);
  const [migrationIdentity, runtimeIdentity] = await Promise.all([identity(migrationPool), identity(runtimePool)]);
  if (migrationIdentity.current_database !== runtimeIdentity.current_database) {
    throw new Error('Migration and runtime connections must target the same PostgreSQL database.');
  }
  if (migrationIdentity.current_user === runtimeIdentity.current_user) {
    throw new Error('Runtime connection must use a restricted role distinct from the migration/schema-owner role.');
  }

  const schemaAlreadyPresent = await hasSchema(migrationPool);
  if (!schemaAlreadyPresent) {
    const schemaPath = path.join(root, 'versions', 'AM-IMP-2026.0718.01', 'schemas', 'postgresql-operational-memory.sql');
    await migrationPool.query(fs.readFileSync(schemaPath, 'utf8'));
  }
  await verifySchema(migrationPool);
  await seedTenant(migrationPool);
  await grantRuntimeRole(migrationPool, runtimeIdentity.current_user);
  await verifyRuntimeIsolation(runtimePool);

  console.log(JSON.stringify({
    ok: true,
    tenant: tenant.key,
    package: 'AM-IMP-2026.0718.01',
    schemaCreated: !schemaAlreadyPresent,
    postgresMajor: String(migrationIdentity.version || '').match(/PostgreSQL (\d+)/)?.[1] || null,
    runtimeRoleSeparated: true,
    rlsVerified: true,
  }, null, 2));
} finally {
  await Promise.allSettled([migrationPool.end(), runtimePool.end()]);
}

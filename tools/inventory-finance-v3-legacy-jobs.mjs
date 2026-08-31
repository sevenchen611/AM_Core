import pg from 'pg';

const databaseUrl = String(
  process.env.HZ2_AM_MEMORY_DATABASE_URL
  || process.env.FOREST_AM_MEMORY_DATABASE_URL
  || process.env.AM_MEMORY_DATABASE_URL
  || '',
).trim();
const tenantId = 'a72c78d7-5035-4e6e-8caf-9ec4d58c914f';
if (!databaseUrl) throw new Error('HZ2_AM_MEMORY_DATABASE_URL, FOREST_AM_MEMORY_DATABASE_URL, or AM_MEMORY_DATABASE_URL is required.');

const parsed = new URL(databaseUrl);
const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
const client = new pg.Client({ connectionString: databaseUrl, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const result = await client.query(`
    SELECT status, count(*)::int AS count,
           min(created_at) AS oldest_created_at,
           max(updated_at) AS newest_updated_at
      FROM am_memory.processing_jobs
     WHERE tenant_id = $1
       AND job_kind = 'finance_claim_v3_group_entry'
     GROUP BY status
     ORDER BY status
  `, [tenantId]);
  const active = result.rows.filter((row) => ['queued', 'retry', 'leased'].includes(row.status));
  console.log(JSON.stringify({ tenantId, jobKind: 'finance_claim_v3_group_entry', rows: result.rows, activeCount: active.reduce((sum, row) => sum + row.count, 0) }, null, 2));
  await client.query('ROLLBACK');
  if (active.length) process.exitCode = 2;
} finally {
  await client.end();
}

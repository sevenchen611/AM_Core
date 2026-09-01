import pg from 'pg';

export function financeClaimsV3PoolConfig(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  return {
    connectionString: databaseUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 4,
    min: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  };
}

export function createFinanceClaimsV3Pool(databaseUrl, { onError = () => {} } = {}) {
  const pool = new pg.Pool(financeClaimsV3PoolConfig(databaseUrl));
  pool.on('error', (error) => {
    try { onError(error); } catch { /* pool errors must not crash observability */ }
  });
  return pool;
}

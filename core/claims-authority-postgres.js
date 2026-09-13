const ROLE_NAMES = Object.freeze({
  tenant: 'am_claims_tenant',
  discovery: 'am_claims_discovery_writer',
  platform: 'am_claims_platform_owner',
  worker: 'am_claims_worker',
});

async function inTransaction(pool, role, setup, work) {
  if (!pool?.connect) throw new Error(`Claims authority ${role} pool is unavailable.`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROLE_NAMES[role]}`);
    if (setup) await setup(client);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createClaimsAuthorityPostgresStore({
  tenantPool,
  discoveryPool,
  platformPool,
  workerPool,
} = {}) {
  return {
    transaction(tenant, work) {
      if (!tenant?.tenantId) throw new Error('Claims authority tenant id is required.');
      return inTransaction(tenantPool, 'tenant', (client) => client.query(
        "SELECT set_config('app.tenant_id',$1,true)",
        [tenant.tenantId],
      ), work);
    },
    discoveryTransaction(work) {
      return inTransaction(discoveryPool, 'discovery', null, work);
    },
    platformTransaction(actor, work) {
      if (!actor?.roles?.includes('platform_owner')) throw new Error('Claims authority platform access denied.');
      return inTransaction(platformPool, 'platform', null, work);
    },
    async leaseOutbox({ workerId, limit = 25, leaseSeconds = 60 } = {}) {
      if (!String(workerId || '')) throw new Error('Claims authority outbox worker id is required.');
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
      const safeLeaseSeconds = Math.max(10, Math.min(900, Number(leaseSeconds) || 60));
      return inTransaction(workerPool, 'worker', null, async (client) => {
        const result = await client.query(
          `/* ca:lease-outbox */ WITH candidates AS (
             SELECT tenant_id,event_key FROM am_claims.outbox
             WHERE status IN ('pending','retry') AND available_at<=now()
               AND (lease_expires_at IS NULL OR lease_expires_at<now())
             ORDER BY available_at,created_at
             FOR UPDATE SKIP LOCKED LIMIT $1
           )
           UPDATE am_claims.outbox o
           SET status='processing',lease_owner=$2,lease_expires_at=now()+make_interval(secs=>$3),attempts=o.attempts+1,updated_at=now()
           FROM candidates c WHERE o.tenant_id=c.tenant_id AND o.event_key=c.event_key
           RETURNING o.*`,
          [safeLimit, String(workerId), safeLeaseSeconds],
        );
        return result.rows || [];
      });
    },
    completeOutbox({ workerId, tenantId, eventKey }) {
      return inTransaction(workerPool, 'worker', null, async (client) => {
        const result = await client.query(
          "/* ca:complete-outbox */ UPDATE am_claims.outbox SET status='sent',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,sent_at=now(),updated_at=now() WHERE tenant_id=$1 AND event_key=$2 AND status='processing' AND lease_owner=$3 RETURNING event_key",
          [tenantId, eventKey, workerId],
        );
        if (!result.rows?.length) throw new Error('Claims authority outbox lease was lost.');
        return result.rows[0];
      });
    },
    failOutbox({ workerId, tenantId, eventKey, error, maxAttempts = 8 }) {
      const safeMax = Math.max(1, Math.min(30, Number(maxAttempts) || 8));
      return inTransaction(workerPool, 'worker', null, async (client) => {
        const result = await client.query(
          `/* ca:fail-outbox */ UPDATE am_claims.outbox
           SET status=CASE WHEN attempts>=$4 THEN 'dead' ELSE 'retry' END,
               available_at=CASE WHEN attempts>=$4 THEN available_at ELSE now()+make_interval(secs=>LEAST(3600,POWER(2,LEAST(attempts,10))::integer)) END,
               lease_owner=NULL,lease_expires_at=NULL,last_error=$5,updated_at=now()
           WHERE tenant_id=$1 AND event_key=$2 AND status='processing' AND lease_owner=$3
           RETURNING event_key,status,attempts`,
          [tenantId, eventKey, workerId, safeMax, String(error?.message || error || 'Unknown dispatch failure').slice(0, 300)],
        );
        if (!result.rows?.length) throw new Error('Claims authority outbox lease was lost.');
        return result.rows[0];
      });
    },
  };
}

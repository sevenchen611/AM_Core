import assert from 'node:assert/strict';
import { createOperationalMemory } from '../core/operational-memory.js';

const tenant = {
  key: 'hozo-am-2-0',
  tenantId: 'a72c78d7-5035-4e6e-8caf-9ec4d58c914f',
  envPrefix: 'HZ2',
  operationalMemory: {
    enabled: true,
    activationMode: 'enforce',
    connectionEnvPrefix: 'FOREST',
  },
};
const job = {
  job_id: '00000000-0000-4000-8000-000000000001',
  status: 'queued',
  attempt_count: 0,
  max_attempts: 6,
  input_payload: { event: { eventId: 'evt-001' } },
  idempotency_key: 'evt-001',
};
const calls = [];
const client = {
  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });
    if (normalized.startsWith('SELECT job_id, status')) return { rows: [{ ...job }] };
    if (normalized.startsWith('WITH ready AS')) {
      job.status = 'leased';
      job.attempt_count += 1;
      return { rows: [{ ...job }] };
    }
    if (normalized.startsWith('UPDATE am_memory.processing_jobs') && normalized.includes("status = $3")) {
      job.status = params[2];
      return { rows: [{ job_id: job.job_id, status: job.status, attempt_count: job.attempt_count, max_attempts: job.max_attempts }] };
    }
    return { rows: [] };
  },
  release() {},
};
const memory = createOperationalMemory({
  env: {
    FOREST_AM_MEMORY_DATABASE_URL: 'postgres://runtime.example/am-memory',
    FOREST_AM_MEMORY_DATABASE_SSL: '1',
  },
  logger: { warn() {} },
  poolFactory: () => ({ connect: async () => client, end: async () => {} }),
});

const enqueued = await memory.enqueueProcessingJob(tenant, {
  jobKind: 'finance_claim_v3_group_entry',
  idempotencyKey: 'evt-001',
  maxAttempts: 6,
  inputPayload: job.input_payload,
});
assert.equal(enqueued.ok, true);
assert.equal(enqueued.job.idempotency_key, 'evt-001');

const leased = await memory.leaseProcessingJobs(tenant, {
  jobKind: 'finance_claim_v3_group_entry',
  limit: 2,
  leaseSeconds: 100,
});
assert.equal(leased.length, 1);
assert.equal(leased[0].attempt_count, 1);
assert.ok(calls.some((call) => call.sql.includes("status = 'leased' AND lease_expires_at <= clock_timestamp()")));

const settled = await memory.settleProcessingJob(tenant, {
  jobId: job.job_id,
  status: 'retry',
  retryDelaySeconds: 15,
  errorPayload: { reason: 'gateway_uncertain' },
});
assert.equal(settled.status, 'retry');
assert.ok(calls.some((call) => call.sql.includes("WHERE tenant_id = $1 AND job_id = $2 AND status = 'leased'")));

await memory.close();
console.log('Generic persistent processing job store dry-run passed.');

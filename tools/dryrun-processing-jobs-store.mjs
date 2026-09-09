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
const identities = new Map();
const financeIdentities = new Map();
const client = {
  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });
    if (normalized.startsWith('INSERT INTO am_memory.processing_jobs') && normalized.includes("'finance-line-notification'")) {
      const key = `${params[0]}:${params[1]}`;
      if (financeIdentities.has(key)) return { rows: [], rowCount: 0 };
      financeIdentities.set(key, {
        job_id: '00000000-0000-4000-8000-000000000003',
        status: 'retry',
        input_payload: JSON.parse(params[2]),
        output_payload: {},
        created_at: new Date().toISOString(),
      });
      return { rows: [{ job_id: '00000000-0000-4000-8000-000000000003' }], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT job_id, status, input_payload, output_payload, created_at')) {
      const key = `${params[0]}:${params[1]}`;
      return { rows: financeIdentities.has(key) ? [{ ...financeIdentities.get(key) }] : [] };
    }
    if (normalized.startsWith('UPDATE am_memory.processing_jobs') && normalized.includes("job_kind = 'finance-line-notification'")) {
      const key = `${params[0]}:${params[1]}`;
      const row = financeIdentities.get(key);
      if (!row || (row.status === 'succeeded' && row.output_payload.deliveryEvidence === 'verified')) return { rows: [], rowCount: 0 };
      row.status = params[2];
      row.input_payload = { ...row.input_payload, deliveryStatus: params[3] };
      if (params[2] === 'succeeded') row.output_payload = JSON.parse(params[4]);
      return { rows: [{ job_id: row.job_id }], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT status, output_payload') && normalized.includes("job_kind = 'finance-line-notification'")) {
      const key = `${params[0]}:${params[1]}`;
      const row = financeIdentities.get(key);
      return { rows: row ? [{ status: row.status, output_payload: row.output_payload }] : [] };
    }
    if (normalized.startsWith('INSERT INTO am_memory.processing_jobs') && normalized.includes('completed_at')) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      if (identities.has(key)) return { rows: [], rowCount: 0 };
      identities.set(key, params[3]);
      return { rows: [{ job_id: '00000000-0000-4000-8000-000000000002' }], rowCount: 1 };
    }
    if (normalized.startsWith("SELECT input_payload ->> 'payloadDigest'")) {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      const payloadDigest = identities.get(key);
      return { rows: payloadDigest ? [{ payload_digest: payloadDigest }] : [] };
    }
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

const firstIdentity = await memory.bindProcessingIdentity(tenant, {
  jobKind: 'finance-line-notification',
  idempotencyKey: 'bank-draft-notification:v1:11111111-1111-4111-8111-111111111111',
  payloadDigest: 'a'.repeat(64),
});
assert.deepEqual(firstIdentity, { ok: true, conflict: false, replayed: false });

const replayedIdentity = await memory.bindProcessingIdentity(tenant, {
  jobKind: 'finance-line-notification',
  idempotencyKey: 'bank-draft-notification:v1:11111111-1111-4111-8111-111111111111',
  payloadDigest: 'a'.repeat(64),
});
assert.deepEqual(replayedIdentity, { ok: true, conflict: false, replayed: true });

const conflictingIdentity = await memory.bindProcessingIdentity(tenant, {
  jobKind: 'finance-line-notification',
  idempotencyKey: 'bank-draft-notification:v1:11111111-1111-4111-8111-111111111111',
  payloadDigest: 'b'.repeat(64),
});
assert.deepEqual(conflictingIdentity, { ok: true, conflict: true, replayed: true });

const financeInput = {
  sourceNotificationId: 'bank-draft-notification:v1:22222222-2222-4222-8222-222222222222',
  payloadDigest: 'c'.repeat(64),
  routeDigest: 'd'.repeat(64),
  providerRetryKey: `finance-provider:v1:${'e'.repeat(64)}`,
};
const firstFinance = await memory.bindFinanceNotificationIdentity(tenant, financeInput);
assert.equal(firstFinance.ok, true);
assert.equal(firstFinance.delivered, false);
assert.equal(firstFinance.manual, false);
assert.equal(firstFinance.replayed, false);
assert.ok(Date.parse(firstFinance.createdAt));

const uncertainFinance = await memory.markFinanceNotificationUncertain(
  tenant, financeInput.sourceNotificationId, 'provider_delivery_unconfirmed',
);
assert.deepEqual(uncertainFinance, { ok: true });
const replayedFinance = await memory.bindFinanceNotificationIdentity(tenant, financeInput);
assert.equal(replayedFinance.replayed, true);
assert.equal(replayedFinance.delivered, false);

const deliveredFinance = await memory.markFinanceNotificationDelivered(
  tenant, financeInput.sourceNotificationId, 'f'.repeat(64),
);
assert.deepEqual(deliveredFinance, { ok: true });
const deliveredReplay = await memory.bindFinanceNotificationIdentity(tenant, financeInput);
assert.equal(deliveredReplay.delivered, true);

const unverifiedSucceededInput = {
  sourceNotificationId: 'bank-draft-notification:v1:33333333-3333-4333-8333-333333333333',
  payloadDigest: '1'.repeat(64),
  routeDigest: '2'.repeat(64),
  providerRetryKey: `finance-provider:v1:${'3'.repeat(64)}`,
};
financeIdentities.set(`${tenant.tenantId}:${unverifiedSucceededInput.sourceNotificationId}`, {
  job_id: '00000000-0000-4000-8000-000000000004',
  status: 'succeeded',
  input_payload: {
    contract: 'hozo-rental-finance-group-mention-v1',
    payloadDigest: unverifiedSucceededInput.payloadDigest,
    routeDigest: unverifiedSucceededInput.routeDigest,
    providerRetryKey: unverifiedSucceededInput.providerRetryKey,
  },
  output_payload: {},
  created_at: new Date().toISOString(),
});
const unverifiedSucceeded = await memory.bindFinanceNotificationIdentity(tenant, unverifiedSucceededInput);
assert.equal(unverifiedSucceeded.legacyUnverified, true);
assert.equal(unverifiedSucceeded.delivered, false);

let poolAttempts = 0;
let poolErrorHandler = null;
const warnings = [];
const recoveringMemory = createOperationalMemory({
  env: {
    FOREST_AM_MEMORY_DATABASE_URL: 'postgres://runtime.example/recovering-memory',
    FOREST_AM_MEMORY_DATABASE_SSL: '1',
  },
  logger: { warn(message) { warnings.push(message); } },
  poolFactory: async () => {
    poolAttempts += 1;
    if (poolAttempts === 1) throw new Error('transient pool initialization');
    return {
      on(event, handler) { if (event === 'error') poolErrorHandler = handler; },
      connect: async () => client,
      end: async () => {},
    };
  },
});
await assert.rejects(
  recoveringMemory.bindProcessingIdentity(tenant, {
    jobKind: 'finance-line-notification', idempotencyKey: 'pool-recovery', payloadDigest: '1'.repeat(64),
  }),
  /transient pool initialization/,
);
const recovered = await recoveringMemory.bindProcessingIdentity(tenant, {
  jobKind: 'finance-line-notification', idempotencyKey: 'pool-recovery', payloadDigest: '1'.repeat(64),
});
assert.equal(recovered.ok, true);
assert.equal(poolAttempts, 2);
assert.equal(typeof poolErrorHandler, 'function');
assert.doesNotThrow(() => poolErrorHandler(new Error('idle client failure')));
assert.deepEqual(warnings, ['[operational-memory] idle PostgreSQL pool error']);

await memory.close();
await recoveringMemory.close();
console.log('Generic persistent processing job store and immutable identity binding dry-run passed.');

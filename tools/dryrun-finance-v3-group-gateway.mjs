import assert from 'node:assert/strict';
import claimsModule, { __test } from '../modules/claims/index.js';

const {
  financeV3GroupEntryConfig,
  financeV3GroupEvent,
  forwardFinanceV3GroupEvent,
  notifyFinanceV3Applicant,
  enqueueFinanceV3GroupEvent,
  drainFinanceV3GroupQueue,
  parseCommand,
} = __test;

const tenant = {
  key: 'hozo-am-2-0',
  config: {
    claims: {
      v3GroupEntry: {
        enabledEnv: 'TEST_V3_ENABLED',
        gatewayUrlEnv: 'TEST_V3_URL',
        gatewayTokenEnv: 'TEST_V3_TOKEN',
      },
    },
  },
};
const ctx = {
  tenant,
  text: '請款',
  event: {
    webhookEventId: 'evt-safe-001',
    timestamp: Date.parse('2026-08-31T03:00:00.000Z'),
    source: { type: 'group', groupId: 'Cgroup-safe-12345678901234567890', userId: 'Uuser-safe-123456789012345678901' },
    message: { id: 'message-001', type: 'text', text: '請款' },
  },
};

function response(body, { status = 200, url = 'https://gateway.example/control/finance/group-events/v3', redirected = false } = {}) {
  const value = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  Object.defineProperties(value, { url: { value: url }, redirected: { value: redirected } });
  return value;
}

const disabled = financeV3GroupEntryConfig(tenant, {});
assert.deepEqual({ enabled: disabled.enabled, ready: disabled.ready }, { enabled: false, ready: false });

const env = {
  TEST_V3_ENABLED: 'true',
  TEST_V3_URL: 'https://gateway.example/ignored?route=old',
  TEST_V3_TOKEN: 'gateway-token-with-at-least-32-characters',
};
const configured = financeV3GroupEntryConfig(tenant, env);
assert.equal(configured.ready, true);
assert.equal(configured.endpoint, 'https://gateway.example/control/finance/group-events/v3');

assert.equal(financeV3GroupEvent({ ...ctx, text: '我要請款' }), null);
assert.equal(financeV3GroupEvent(ctx).contractVersion, 'finance-claims-v3.group-event-ingress-v1');
assert.equal(parseCommand('費用申請').kind, 'open');

let observed = null;
let result = await forwardFinanceV3GroupEvent(ctx, {
  env,
  fetchImpl: async (url, options) => {
    observed = { url, options, body: JSON.parse(options.body) };
    return response({
      contractVersion: 'finance-claims-v3.group-event-ingress-v1',
      eventId: 'evt-safe-001',
      accepted: 1,
      intercepted: 1,
      queued: 1,
      replayed: 0,
    });
  },
});
assert.deepEqual(result, { handled: true, delivered: true, replayed: false });
assert.equal(observed.url, configured.endpoint);
assert.equal(observed.options.headers.authorization, `Bearer ${env.TEST_V3_TOKEN}`);
assert.deepEqual(Object.keys(observed.body).sort(), ['contractVersion', 'eventId', 'eventType', 'message', 'occurredAt', 'source']);
assert.deepEqual(observed.body.message, { type: 'text', text: '請款' });
assert.equal(JSON.stringify(observed.body).includes('replyToken'), false);

result = await forwardFinanceV3GroupEvent(ctx, {
  env,
  fetchImpl: async () => response({
    contractVersion: 'finance-claims-v3.group-event-ingress-v1',
    eventId: 'evt-safe-001',
    accepted: 1,
    intercepted: 1,
    queued: 0,
    replayed: 0,
  }),
});
assert.equal(result.reason, 'identity_not_allowed');

result = await forwardFinanceV3GroupEvent(ctx, {
  env,
  fetchImpl: async () => response({
    contractVersion: 'finance-claims-v3.group-event-ingress-v1',
    eventId: 'evt-safe-001',
    accepted: 1,
    intercepted: 1,
    queued: 1,
    replayed: 0,
  }, { url: 'https://attacker.invalid/control/finance/group-events/v3', redirected: true }),
});
assert.equal(result.reason, 'gateway_invalid');

result = await forwardFinanceV3GroupEvent(ctx, {
  env: { ...env, TEST_V3_TOKEN: 'short' },
  fetchImpl: async () => { throw new Error('must not fetch'); },
});
assert.equal(result.reason, 'gateway_unavailable');

let privateTarget = '';
claimsModule.init({
  pushLineMessage: async (target) => { privateTarget = target; },
});
assert.equal(await notifyFinanceV3Applicant(ctx, '新版入口暫時無法使用'), true);
assert.equal(privateTarget, ctx.event.source.userId);

const persisted = new Map();
const settlements = [];
const memory = {
  async enqueueProcessingJob(_tenant, input) {
    if (!persisted.has(input.idempotencyKey)) {
      persisted.set(input.idempotencyKey, {
        job_id: '00000000-0000-4000-8000-000000000001',
        status: 'queued',
        attempt_count: 0,
        max_attempts: input.maxAttempts,
        input_payload: input.inputPayload,
        idempotency_key: input.idempotencyKey,
      });
    }
    return { ok: true, job: persisted.get(input.idempotencyKey) };
  },
  async leaseProcessingJobs() {
    const job = persisted.get('evt-safe-001');
    if (!job || !['queued', 'retry'].includes(job.status)) return [];
    job.status = 'leased';
    job.attempt_count += 1;
    return [{ ...job }];
  },
  async settleProcessingJob(_tenant, input) {
    const job = persisted.get('evt-safe-001');
    assert.equal(job.status, 'leased');
    job.status = input.status;
    settlements.push({ ...input });
    return { job_id: job.job_id, status: job.status, attempt_count: job.attempt_count, max_attempts: job.max_attempts };
  },
};
claimsModule.init({
  operationalMemory: memory,
  pushLineMessage: async (target) => { privateTarget = target; },
  logger: { warn() {} },
});
assert.equal((await enqueueFinanceV3GroupEvent(ctx)).queued, true);
assert.equal((await enqueueFinanceV3GroupEvent(ctx)).queued, true);
assert.equal(persisted.size, 1);

let deliveryAttempts = 0;
let drained = await drainFinanceV3GroupQueue(tenant, {
  env,
  timeoutMs: 70_000,
  fetchImpl: async () => {
    deliveryAttempts += 1;
    throw new Error('cold start');
  },
});
assert.deepEqual(drained, { processed: 1, delivered: 0, retried: 1, failed: 0 });
assert.equal(persisted.get('evt-safe-001').status, 'retry');
assert.equal(settlements[0].retryDelaySeconds, 5);

drained = await drainFinanceV3GroupQueue(tenant, {
  env,
  timeoutMs: 70_000,
  fetchImpl: async () => {
    deliveryAttempts += 1;
    return response({
      contractVersion: 'finance-claims-v3.group-event-ingress-v1',
      eventId: 'evt-safe-001',
      accepted: 1,
      intercepted: 1,
      queued: 1,
      replayed: 0,
    });
  },
});
assert.deepEqual(drained, { processed: 1, delivered: 1, retried: 0, failed: 0 });
assert.equal(persisted.get('evt-safe-001').status, 'succeeded');
assert.equal(deliveryAttempts, 2);

console.log('Finance Claims v3 葉小蝸 group gateway dry-run passed.');

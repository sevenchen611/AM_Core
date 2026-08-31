import assert from 'node:assert/strict';
import claimsModule, { __test } from '../modules/claims/index.js';

const {
  financeV3GroupEntryConfig,
  financeV3GroupEvent,
  forwardFinanceV3GroupEvent,
  notifyFinanceV3Applicant,
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

console.log('Finance Claims v3 葉小蝸 group gateway dry-run passed.');

import assert from 'node:assert/strict';
import { createClaimsAuthorityIntegration } from '../modules/claims/authority-integration.js';

const databaseUrl = 'postgres://test:test@127.0.0.1:1/claims_unavailable';
const env = {
  HZ2_CLAIMS_AUTHORITY_ENABLED: 'true',
  HZ2_CLAIMS_AUTHORITY_IDENTITY_KEY: 'test-only-identity-key-with-at-least-32-characters',
  HZ2_FINANCE_CLAIMS_V3_DATABASE_URL: databaseUrl,
};
const warnings = [];
let unhandledRejections = 0;
const onUnhandledRejection = () => { unhandledRejections += 1; };
process.on('unhandledRejection', onUnhandledRejection);

const integration = createClaimsAuthorityIntegration({
  env,
  platform: { logger: { warn: (message) => warnings.push(message) } },
  groupEntry: { enqueue: async () => ({ status: 503 }) },
  receiver: { bridgeMembership: async () => ({ status: 503 }) },
});

// The production fast scheduler does not touch the authority migration promise
// until its first tick. Give the connection failure time to occur before that.
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(unhandledRejections, 0, 'startup must not leave a rejected migration promise unhandled');
await assert.rejects(integration.runOutbox(), /ECONNREFUSED|connect/iu);
await new Promise((resolve) => setTimeout(resolve, 25));
process.off('unhandledRejection', onUnhandledRejection);

assert.equal(unhandledRejections, 0, 'database failure must stay handled while finance operations fail closed');
assert.ok(warnings.some((message) => message.includes('Claims authority migration failed closed')));
console.log('claims authority unavailable-database startup dry-run passed');

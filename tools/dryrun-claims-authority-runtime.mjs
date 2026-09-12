import assert from 'node:assert/strict';
import { createClaimsAuthorityRuntimeAdapter, claimsAuthorityFallbackMessages } from '../core/claims-authority-runtime.js';

const replies = [];
const makeAdapter = (result) => createClaimsAuthorityRuntimeAdapter({
  authority: { handleEvent: async () => result },
  replyLine: async (_event, message) => replies.push(message),
});
const event = { type: 'message', message: { type: 'text', text: '請款' } };

await makeAdapter({ handled: true, state: 'unassigned' }).handle({ event });
assert.equal(replies.pop(), claimsAuthorityFallbackMessages.unbound);
await makeAdapter({ handled: true, mode: 'enforce', claim: { ok: false, reason: 'identity_unavailable' } }).handle({ event });
assert.equal(replies.pop(), claimsAuthorityFallbackMessages.identityUnavailable);
await makeAdapter({ handled: true, mode: 'enforce', claim: { ok: false, reason: 'not_ready_or_denied' } }).handle({ event });
assert.equal(replies.pop(), claimsAuthorityFallbackMessages.denied);
const ok = await makeAdapter({ handled: true, mode: 'enforce', claim: { ok: true }, v3: { ttlMinutes: 10 } }).handle({ event });
assert.equal(ok.v3.ttlMinutes, 10);
assert.equal(replies.length, 0);

console.log('claims authority runtime dry-run passed');

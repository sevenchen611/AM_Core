import assert from 'node:assert/strict';
import fs from 'node:fs';
import { __test as integration } from '../modules/claims/authority-integration.js';
import { __test as claims } from '../modules/claims/index.js';

const tenantKey = 'hozo-test';
const financeGroup = `C${'a'.repeat(32)}`;
const partnerGroup = `C${'b'.repeat(32)}`;
const financeReference = 'line-ref:v1:11111111-1111-4111-8111-111111111111';
const partnerReference = 'line-ref:v1:22222222-2222-4222-8222-222222222222';
const env = {
  HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON: JSON.stringify({ bindings: [
    { tenantKey, type: 'group_binding', target: financeGroup, identityReference: financeReference },
    { tenantKey, type: 'group_binding', target: partnerGroup, identityReference: partnerReference },
  ] }),
};

const recipients = integration.groupRecipientRegistry(env);
assert.equal(recipients.get(`${tenantKey}:${financeGroup}`), financeReference);
assert.equal(recipients.get(`${tenantKey}:${partnerGroup}`), partnerReference);
assert.notEqual(recipients.get(`${tenantKey}:${financeGroup}`), recipients.get(`${tenantKey}:${partnerGroup}`));
assert.equal(recipients.has(`${tenantKey}:C${'c'.repeat(32)}`), false);
const ambiguousRecipients = integration.groupRecipientRegistry({
  HZ2_FINANCE_CLAIMS_V3_RECIPIENT_BINDINGS_JSON: JSON.stringify({ bindings: [
    { tenantKey, type: 'group_binding', target: financeGroup, identityReference: financeReference },
    { tenantKey, type: 'group_binding', target: financeGroup, identityReference: partnerReference },
  ] }),
});
assert.equal(ambiguousRecipients.has(`${tenantKey}:${financeGroup}`), false);

const replyCalls = [];
const pushCalls = [];
const deliveryInput = { groupId: financeGroup, idempotencyKey: 'origin-event', event: { replyToken: 'reply-token' } };
let delivery = await integration.deliverSelectorToOrigin({
  replyLineMessage: async (...args) => replyCalls.push(args),
  pushLineMessage: async (...args) => pushCalls.push(args),
}, deliveryInput, 'https://liff.line.me/synthetic?selector=safe');
assert.equal(delivery.channel, 'reply');
assert.equal(replyCalls[0][0], 'reply-token');
assert.equal(pushCalls.length, 0);

delivery = await integration.deliverSelectorToOrigin({
  replyLineMessage: async () => { throw new Error('expired reply token'); },
  pushLineMessage: async (...args) => pushCalls.push(args),
}, deliveryInput, 'https://liff.line.me/synthetic?selector=safe');
assert.equal(delivery.channel, 'push');
assert.equal(pushCalls[0][0], financeGroup);
assert.notEqual(pushCalls[0][0], partnerGroup);

const selectorToken = `fs1.33333333-3333-4333-8333-333333333333.${Date.now() + 60_000}.${'x'.repeat(43)}`;
const selectorCookie = integration.selectorSessionCookie(selectorToken, Date.now() + 60_000);
assert.match(selectorCookie, /^am_claims_form_selector=/u);
assert.match(selectorCookie, /Path=\/claims\/liff/u);
assert.match(selectorCookie, /HttpOnly/u);
assert.match(selectorCookie, /Secure/u);
assert.match(selectorCookie, /SameSite=Lax/u);

const callback = new URL('https://example.test/claims/liff?code=oauth-code&state=oauth-state');
assert.equal(claims.selectorTokenFromRequest(callback, selectorCookie), selectorToken);
assert.equal(claims.selectorTokenFromRequest(new URL('https://example.test/claims/liff'), selectorCookie), '');
assert.equal(claims.selectorTokenFromRequest(new URL(`https://example.test/claims/liff?selector=${encodeURIComponent(selectorToken)}`)), selectorToken);
assert.equal(claims.selectorTokenFromRequest(new URL(`https://example.test/claims/liff?liff.state=${encodeURIComponent(`?selector=${selectorToken}`)}`)), selectorToken);

const legacyPreview = claims.liffHtml(null, null, { previewType: 'labor_health_insurance' });
assert.match(legacyPreview, /儲存為我的範本/u);
assert.match(legacyPreview, /請補上本次請款月份、日期與附件/u);
assert.match(legacyPreview, /action:'getTemplate'/u);
assert.match(legacyPreview, /action:'saveTemplate'/u);
const integrationSource = fs.readFileSync(new URL('../modules/claims/authority-integration.js', import.meta.url), 'utf8');
assert.match(integrationSource, /bridgeMembership[\s\S]*startsWith\('legacy_'\)/u);
assert.match(integrationSource, /identityReference[\s\S]*createLegacyFormLink/u);

console.log('claims authority origin routing and LIFF OAuth recovery dry-run passed');

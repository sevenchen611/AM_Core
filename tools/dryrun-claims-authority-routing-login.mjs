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
assert.match(legacyPreview, /儲存具名範本/u);
assert.match(legacyPreview, /新增另一張/u);
assert.match(legacyPreview, /套用選取範本/u);
assert.match(legacyPreview, /刪除選取範本/u);
assert.match(legacyPreview, /請補上本次請款月份、日期與附件/u);
assert.match(legacyPreview, /action:'listTemplates'/u);
assert.match(legacyPreview, /action:'saveTemplate'/u);
assert.match(legacyPreview, /action:'deleteTemplate'/u);
const integrationSource = fs.readFileSync(new URL('../modules/claims/authority-integration.js', import.meta.url), 'utf8');
assert.equal(integration.requiresFinanceMembership('external_claim_only', 'legacy_social_insurance'), false);
assert.equal(integration.requiresFinanceMembership('internal_v3', 'employee_expense'), true);
assert.throws(() => integration.requiresFinanceMembership('external_claim_only', 'employee_expense'), /外部廠商群組/u);
assert.match(integrationSource, /requiresFinanceMembership\(selected\.claimMode[\s\S]*bridgeMembership/u);
assert.match(integrationSource, /sourceId: selected\.sourceId, groupReference: selected\.groupReference, claimMode: selected\.claimMode/u);

const externalPayload = claims.normalizeClaimSubmission({
  type: 'labor_health_insurance',
  period: '2026-09',
  lines: [{ description: '勞保費', amount: 100 }],
  totals: { requestedAmount: 100, companyExpenseAmount: 80, employeeRecoverableAmount: 20, currency: 'TWD' },
}, {
  tenantKey, tenantId: 'tenant-uuid', bindingId: 'notion-page-id', sourceGroupName: '外部廠商群組',
  externalSubmissionId: 'submission-one', requestedByName: '申請人',
  financeSourceId: 'source-partner', financeGroupReference: partnerReference,
  authoritySelection: { formKey: 'legacy_social_insurance' },
}, {}, { userId: 'U-synthetic', displayName: '申請人' });
assert.equal(externalPayload.source.id, 'source-partner');
assert.equal(externalPayload.source.groupReference, partnerReference);
assert.equal(externalPayload.source.groupBindingId, partnerReference);
assert.notEqual(externalPayload.source.groupBindingId, 'notion-page-id');

const migrationSource = fs.readFileSync(new URL('../versions/AM-IMP-2026.0916.01/config/claims-group-modes.sql', import.meta.url), 'utf8');
assert.match(migrationSource, /claim_mode IN \('external_claim_only','internal_v3'\)/u);
assert.match(migrationSource, /claims_groups_platform_read[\s\S]*claims_members_platform_read/u);

console.log('claims authority origin routing and LIFF OAuth recovery dry-run passed');

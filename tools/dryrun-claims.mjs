import assert from 'node:assert/strict';
import claims, { __test } from '../modules/claims/index.js';

const tenant = {
  key: 'hozo-am-2-0',
  tenantId: 'a72c78d7-5035-4e6e-8caf-9ec4d58c914f',
  dataSources: { groupBindings: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  config: {
    claims: {
      enabled: true,
      liffId: '1234567890-claims',
      rentalBaseUrl: 'https://rental.example.test',
      rentalTokenEnv: 'DRYRUN_RENTAL_TOKEN',
      eventTokenEnv: 'DRYRUN_EVENT_TOKEN',
      allowedSubmitterUserIdsByBinding: { '0123456789abcdef0123456789abcdef': ['U0123456789abcdef0123456789abcdef'] },
    },
  },
};

process.env.DRYRUN_RENTAL_TOKEN = 'rental-token';
process.env.DRYRUN_EVENT_TOKEN = 'event-token';

assert.equal(claims.name, 'claims');
assert.deepEqual(__test.parseCommand('請款'), { kind: 'open', draftText: '' });
assert.deepEqual(__test.parseCommand('我要請款'), { kind: 'open', draftText: '' });
assert.deepEqual(__test.parseCommand('#請款 勞健保 4,627'), { kind: 'draft', draftText: '勞健保 4,627' });
assert.deepEqual(__test.parseCommand('請款明細如下'), { kind: 'none' });

const session = {
  externalSubmissionId: 'amc_hozo-am-2-0_submission',
  tenantKey: tenant.key,
  tenantId: tenant.tenantId,
  bindingId: '0123456789abcdef0123456789abcdef',
  sourceGroupName: '好住寓好 vs. 葉綠宿',
  requestedByName: 'Bonnie',
};
const payload = __test.normalizeClaimSubmission({
  type: 'labor_health_insurance',
  period: '2026-06',
  lines: [
    { description: '公司負擔', amount: 3776 },
    { description: '陸昱晴個人負擔', amount: 851, employeeReference: 'Maggie' },
  ],
  totals: { requestedAmount: 4627, companyExpenseAmount: 3776, employeeRecoverableAmount: 851, currency: 'TWD' },
  attachments: [{ id: 'att-1', name: '2026-06-insurance.pdf', contentType: 'application/pdf', size: 1024 }],
}, session, tenant, { userId: 'U0123456789abcdef0123456789abcdef', displayName: 'Bonnie' });
assert.equal(payload.externalSubmissionId, session.externalSubmissionId);
assert.equal(payload.source.groupBindingId, session.bindingId);
assert.equal(payload.source.actor.reference, 'U0123456789abcdef0123456789abcdef');
assert.equal(payload.claim.totals.requestedAmount, 4627);
assert.equal(payload.claim.lines.length, 2);
assert.equal(JSON.stringify(payload).includes('groupId'), false);
assert.throws(() => __test.normalizeClaimSubmission({
  type: 'labor_health_insurance', period: '2026-06', lines: [{ description: '錯誤', amount: 100 }],
  totals: { requestedAmount: 99, currency: 'TWD' }, attachments: [],
}, session, tenant, { userId: 'U0123456789abcdef0123456789abcdef', displayName: 'Bonnie' }));

const event = __test.normalizeClaimEvent({
  eventId: 'evt_claim_202606_0001', tenantKey: tenant.key, tenantId: tenant.tenantId,
  bindingId: session.bindingId, claimId: 'claim-001', claimNumber: 'CLM-202606-0001',
  status: 'paid', amount: 4627, currency: 'TWD', paidAt: '2026-08-04T10:00:00+08:00',
}, tenant);
assert.equal(event.status, 'paid');
assert.match(__test.eventMessage(event), /CLM-202606-0001/);
assert.throws(() => __test.normalizeClaimEvent({ ...event, text: '不允許的任意訊息' }, tenant));
assert.throws(() => __test.normalizeClaimEvent({ ...event, groupId: 'C0123456789' }, tenant));

const sent = [];
claims.init({
  publicLinkSecret: 'dryrun-public-secret',
  logger: { warn() {} },
  notionRequest: async () => ({
    parent: { type: 'data_source_id', data_source_id: tenant.dataSources.groupBindings },
    properties: {
      'LINE 群組 ID': { rich_text: [{ plain_text: 'C0123456789abcdef0123456789abcdef' }] },
      '群組名稱': { title: [{ plain_text: '好住寓好 vs. 葉綠宿' }] },
      狀態: { select: { name: '啟用' } },
      啟用功能: { multi_select: [{ name: '請款' }] },
      請款送件權限: { select: { name: '指定成員' } },
      請款指定送件人: { rich_text: [{ plain_text: '["U0123456789abcdef0123456789abcdef"]' }] },
    },
  }),
  replyLineMessage: async (_, message) => sent.push(message),
  pushLineMessage: async (_, message) => sent.push(message),
});
const handled = await claims.onMessage({
  tenant,
  binding: { pageId: session.bindingId, groupId: 'C0123456789abcdef0123456789abcdef', groupName: '舊名稱', status: '啟用', capabilities: ['請款'] },
  groupId: 'C0123456789abcdef0123456789abcdef',
  senderName: 'Bonnie',
  event: { replyToken: 'reply-token', source: { userId: 'U0123456789abcdef0123456789abcdef' } },
  text: '#請款 6 月勞健保費 4,627 元',
});
assert.equal(handled, true);
assert.equal(sent.length, 1);
assert.match(sent[0], /草稿預覽/);
assert.match(sent[0], /liff\.line\.me/);
assert.equal(await claims.onMessage({ tenant, text: '這不是請款命令' }), false);

console.log('claims dry-run passed: commands, draft-only opening, group allowlist, sanitized Rental payload, totals, and structured event validation.');

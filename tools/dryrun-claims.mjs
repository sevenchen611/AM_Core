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
assert.deepEqual(__test.parseCommand('請款按鈕'), { kind: 'open', draftText: '' });
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
  dueDate: '2026-07-10',
  note: '請於到期日前完成付款。',
  attachments: [{ id: 'att-1', name: '2026-06-insurance.pdf', contentType: 'application/pdf', size: 1024 }],
}, session, tenant, { userId: 'U0123456789abcdef0123456789abcdef', displayName: 'Bonnie' });
assert.equal(payload.externalSubmissionId, session.externalSubmissionId);
assert.equal(payload.source.groupBindingId, session.bindingId);
assert.equal(payload.source.actor.reference, 'U0123456789abcdef0123456789abcdef');
assert.equal(payload.claim.totals.requestedAmount, 4627);
assert.equal(payload.claim.lines.length, 2);
assert.equal(JSON.stringify(payload).includes('groupId'), false);
assert.equal(JSON.stringify(payload).includes('data:application/pdf'), false);
const uploadPayload = __test.normalizeAttachmentUpload({
  id: 'att-2',
  name: 'receipt.pdf',
  contentType: 'application/pdf',
  size: 9,
  dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
});
assert.equal(uploadPayload.dataUrl, 'data:application/pdf;base64,JVBERi0xLjQ=');
assert.throws(() => __test.normalizeClaimSubmission({
  type: 'labor_health_insurance', period: '2026-06', lines: [{ description: '錯誤', amount: 100 }],
  totals: { requestedAmount: 99, currency: 'TWD' }, attachments: [],
}, session, tenant, { userId: 'U0123456789abcdef0123456789abcdef', displayName: 'Bonnie' }));

const originalFetch = globalThis.fetch;
const uploadCalls = [];
globalThis.fetch = async (url, options = {}) => {
  uploadCalls.push({ url: String(url), options });
  return new Response(JSON.stringify({ ok: true, attachmentId: 'claim-attachment-1', receiptUrl: '/api/finance/receipt?project=mingyi&id=docrcpt-1' }), { status: 201 });
};
const uploadResult = await __test.uploadRentalClaimAttachment(tenant, 'amc_claim_001', uploadPayload);
globalThis.fetch = originalFetch;
assert.equal(uploadResult.receiptUrl, '/api/finance/receipt?project=mingyi&id=docrcpt-1');
assert.match(uploadCalls[0].url, /\/api\/integrations\/finance\/claims\/amc_claim_001\/attachments$/);
assert.equal(JSON.parse(uploadCalls[0].options.body).dataUrl, uploadPayload.dataUrl);

const missingSourceError = __test.rentalClaimError(403, {
  error: 'No active finance claim source matches this tenant and group binding.',
});
assert.equal(missingSourceError.message, '此群組尚未完成 Rental 請款來源設定，請聯絡財務管理員。');
assert.match(missingSourceError.detail, /status=403/);
assert.match(missingSourceError.detail, /No active finance claim source/);
assert.equal(
  __test.rentalClaimError(403, { error: 'Claim tenant identity does not match this configured source.' }).message,
  '此群組的 Rental 租戶設定不一致，請聯絡財務管理員。',
);
assert.equal(
  __test.rentalClaimError(400, { error: 'Claim line amounts must total the claim amount.' }).message,
  '請款資料未通過 Rental 驗證，請檢查明細與總額後重試。',
);
assert.equal(
  __test.rentalClaimError(503, { error: 'upstream unavailable' }).message,
  'Rental 請款服務暫時無法處理，請稍後重試。',
);

const detailedPushes = [];
const detailedResult = {
  claimNumber: 'CLM-202608-TEST',
  sourceName: '葉綠宿 -> 好住寓好 請款',
  reviewerName: 'Maggie',
  reviewerLineUserId: 'U480627aaad7650bdd40117714fa69bc1',
  reviewUrl: 'https://rental.example.test/admin-finance.html?claim=CLM-202608-TEST#claim-requests-panel',
};
const detailedDelivered = await __test.notifyInitialStatus(session, { groupId: 'C0123456789abcdef0123456789abcdef' },
  detailedResult, payload, {
    pushLineMessage: async (to, text, mention, delivery) => detailedPushes.push({ to, text, mention, delivery }),
    logger: { warn() {} },
  });
assert.equal(detailedDelivered, true);
assert.equal(detailedPushes.length, 1);
assert.deepEqual(detailedPushes[0].mention, { name: 'Maggie', userId: 'U480627aaad7650bdd40117714fa69bc1' });
assert.match(detailedPushes[0].text, /Maggie，新請款已送出，待您核准/);
assert.match(detailedPushes[0].text, /單號：CLM-202608-TEST/);
assert.match(detailedPushes[0].text, /送件人：Bonnie/);
assert.match(detailedPushes[0].text, /1\. 公司負擔：NT\$3,776/);
assert.match(detailedPushes[0].text, /2\. 陸昱晴個人負擔：NT\$851/);
assert.match(detailedPushes[0].text, /好住寓好公司負擔：NT\$3,776/);
assert.match(detailedPushes[0].text, /員工應收／扣回：NT\$851/);
assert.match(detailedPushes[0].text, /付款到期日：2026-07-10/);
assert.match(detailedPushes[0].text, /附件：1 件（2026-06-insurance\.pdf）/);
assert.match(detailedPushes[0].text, /開啟核准頁：https:\/\/rental\.example\.test/);
assert.match(detailedPushes[0].delivery.retryKey, /notification:1$/);
assert.equal(__test.splitLineMessage('明細'.repeat(3000)).length, 2);

const notificationWarnings = [];
const notificationDelivered = await __test.notifyInitialStatus(session, { groupId: 'C0123456789abcdef0123456789abcdef' },
  { claimNumber: 'CLM-202608-TEST' }, payload, {
    pushLineMessage: async () => { throw new Error('simulated LINE failure'); },
    logger: { warn: (message) => notificationWarnings.push(message) },
  });
assert.equal(notificationDelivered, false);
assert.match(notificationWarnings[0], /simulated LINE failure/);

const event = __test.normalizeClaimEvent({
  eventId: 'evt_claim_202606_0001', tenantKey: tenant.key, tenantId: tenant.tenantId,
  bindingId: session.bindingId, claimId: 'claim-001', claimNumber: 'CLM-202606-0001',
  status: 'paid', amount: 4627, currency: 'TWD', paidAt: '2026-08-04T10:00:00+08:00',
}, tenant);
assert.equal(event.status, 'paid');
assert.match(__test.eventMessage(event), /CLM-202606-0001/);
const bankReviewEvent = __test.normalizeClaimEvent({
  eventId: 'bank-review-claim-001-12345678', tenantKey: tenant.key, tenantId: tenant.tenantId,
  bindingId: session.bindingId, claimId: 'claim-001', claimNumber: 'CLM-202606-0001',
  status: 'bank_review_approved', amount: 4627, currency: 'TWD',
  claimTitle: '6 月份勞健保', expectedDisbursementDate: '2026-08-12',
  occurredAt: '2026-08-11T10:00:00+08:00',
}, tenant);
const bankReviewMessage = __test.eventMessage(bankReviewEvent);
assert.match(bankReviewMessage, /名目：6 月份勞健保/);
assert.match(bankReviewMessage, /審核通過金額：NT\$4,627/);
assert.match(bankReviewMessage, /預計放款：2026-08-12/);
assert.match(bankReviewMessage, /尚未放行/);
assert.match(bankReviewMessage, /不代表款項已實際放行或入帳/);
assert.throws(() => __test.normalizeClaimEvent({ ...bankReviewEvent, expectedDisbursementDate: '2026-13-40' }, tenant));
assert.throws(() => __test.normalizeClaimEvent({ ...bankReviewEvent, expectedDisbursementDate: '2026-02-30' }, tenant));
const unscheduledBankReview = __test.normalizeClaimEvent({
  ...bankReviewEvent, eventId: 'bank-review-claim-001-87654321', expectedDisbursementDate: '',
}, tenant);
assert.match(__test.eventMessage(unscheduledBankReview), /尚未排定（待銀行最終放行後，以網銀實際入帳時間為準）/);
assert.throws(() => __test.normalizeClaimEvent({ ...event, text: '不允許的任意訊息' }, tenant));
assert.throws(() => __test.normalizeClaimEvent({ ...event, groupId: 'C0123456789' }, tenant));

const sent = [];
claims.init({
  publicLinkSecret: 'dryrun-public-secret',
  logger: { warn() {} },
  notionRequest: async (path) => {
    if (String(path).includes('fedcba9876543210fedcba9876543210')) {
      throw Object.assign(new Error('Binding is not active for claims.'), { statusCode: 409 });
    }
    return ({
    parent: { type: 'data_source_id', data_source_id: tenant.dataSources.groupBindings },
    properties: {
      'LINE 群組 ID': { rich_text: [{ plain_text: 'C0123456789abcdef0123456789abcdef' }] },
      '群組名稱': { title: [{ plain_text: '好住寓好 vs. 葉綠宿' }] },
      狀態: { select: { name: '啟用' } },
      啟用功能: { multi_select: [{ name: '請款' }] },
      請款送件權限: { select: { name: '指定成員' } },
      請款指定送件人: { rich_text: [{ plain_text: '["U0123456789abcdef0123456789abcdef"]' }] },
    },
    });
  },
  replyLineMessage: async (_, message) => sent.push(message),
  pushLineMessage: async (_, message) => sent.push(message),
});
const directHandled = await claims.onDirectMessage({
  tenant,
  personalBinding: {
    displayName: 'Bonnie',
    groupBindingIds: ['fedcba9876543210fedcba9876543210', session.bindingId],
  },
  senderName: 'Bonnie',
  directUserId: 'U0123456789abcdef0123456789abcdef',
  event: {
    replyToken: 'direct-reply-token',
    source: { type: 'user', userId: 'U0123456789abcdef0123456789abcdef' },
  },
  text: '我要請款',
});
assert.equal(directHandled, true);
assert.equal(sent.length, 1);
assert.equal(sent[0].type, 'flex');
assert.equal(sent[0].contents.footer.contents[0].action.label, '開啟請款單');
assert.match(sent[0].contents.footer.contents[0].action.uri, /liff\.line\.me/);
assert.match(sent[0].contents.header.contents[1].text, /好住寓好/);

const multiSourceHandled = await claims.onDirectMessage({
  tenant,
  personalBinding: {
    displayName: 'Bonnie',
    groupBindingIds: [session.bindingId, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  },
  senderName: 'Bonnie',
  directUserId: 'U0123456789abcdef0123456789abcdef',
  event: {
    replyToken: 'direct-multi-source-reply-token',
    source: { type: 'user', userId: 'U0123456789abcdef0123456789abcdef' },
  },
  text: '我要請款',
});
assert.equal(multiSourceHandled, true);
assert.equal(sent.length, 2);
assert.equal(sent[1].type, 'flex');
assert.equal(sent[1].altText, '請選擇請款來源後開啟請款單。');
assert.equal(sent[1].contents.type, 'carousel');
assert.equal(sent[1].contents.contents.length, 2);
const sourceLinks = sent[1].contents.contents.map((bubble) => bubble.footer.contents[0].action.uri);
assert.equal(new Set(sourceLinks).size, 2);
sourceLinks.forEach((link) => assert.match(link, /liff\.line\.me/));

const handled = await claims.onMessage({
  tenant,
  binding: { pageId: session.bindingId, groupId: 'C0123456789abcdef0123456789abcdef', groupName: '舊名稱', status: '啟用', capabilities: ['請款'] },
  groupId: 'C0123456789abcdef0123456789abcdef',
  senderName: 'Bonnie',
  event: { replyToken: 'reply-token', source: { userId: 'U0123456789abcdef0123456789abcdef' } },
  text: '#請款 6 月勞健保費 4,627 元',
});
assert.equal(handled, true);
assert.equal(sent.length, 3);
assert.equal(sent[2].type, 'flex');
assert.equal(sent[2].contents.footer.contents[0].action.label, '開啟請款單');
assert.match(sent[2].contents.footer.contents[0].action.uri, /liff\.line\.me/);
assert.match(sent[2].altText, /草稿/);
assert.equal(await claims.onMessage({ tenant, text: '這不是請款命令' }), false);

console.log('claims dry-run passed: commands, draft-only opening, group allowlist, sanitized Rental payload, totals, and structured event validation.');

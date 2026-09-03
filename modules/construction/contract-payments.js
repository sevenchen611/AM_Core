// Engineering contract payment-management domain service.
//
// This module records a controlled payment-claim workflow only. It must never
// call a bank, create a transfer instruction, store account numbers, or mark a
// claim paid from an assumption. The signed/frozen contract version and its
// payment milestones remain the authority for every schedule item.

import crypto from 'node:crypto';

export const PAYMENT_WORKFLOW_VERSION = 'engineering-contract-payment-control.v1';

export const PAYMENT_ROLES = Object.freeze({
  submit: 'engineering_contract_payment_submit',
  review: 'engineering_contract_payment_review',
  approve: 'engineering_contract_payment_approve',
});

export const PAYMENT_CLAIM_STATUSES = Object.freeze([
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'cancelled',
]);

export const PAYMENT_EVENT_TYPES = Object.freeze([
  'claim_submitted',
  'claim_review_started',
  'claim_changes_requested',
  'claim_approved',
  'claim_rejected',
  'claim_cancelled',
]);

const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'cancelled']);
const ACTIVE_SIGNING_STATUSES = new Set(['confirmed', 'completed']);
const SHA256 = /^[a-f0-9]{64}$/;
const PUBLIC_CLAIM_FIELDS = new Set([
  'id', 'contractId', 'contractNumber', 'projectCode', 'milestoneId',
  'milestoneLabel', 'versionId', 'versionNo', 'amount', 'currency', 'status',
  'submittedAt', 'reviewedAt', 'approvedAt', 'reviewDueAt', 'nextAction',
  'nextActionOwner', 'evidenceCount', 'evidenceKinds', 'sourceSummary',
]);

function paymentError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value, max = 1000) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function unwrap(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'value') ? value.value : value;
}

function iso(value, field, required = true) {
  const source = text(value, 80);
  if (!source && !required) return '';
  if (!source || !Number.isFinite(Date.parse(source))) {
    throw paymentError('PAYMENT_TIMESTAMP_INVALID', field + ' 必須是有效時間。', 400, { field });
  }
  return new Date(source).toISOString();
}

function amount(value, field = 'amount') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1000000000000) {
    throw paymentError('PAYMENT_AMOUNT_INVALID', '請款金額必須是正數。', 400, { field });
  }
  return Math.round(number * 100) / 100;
}

function currency(value) {
  const normalized = text(value || 'TWD', 8).toUpperCase();
  if (normalized !== 'TWD') throw paymentError('PAYMENT_CURRENCY_UNSUPPORTED', '工程合約付款目前僅支援 TWD。');
  return normalized;
}

function id(value, field) {
  const normalized = text(value, 160);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(normalized)) {
    throw paymentError('PAYMENT_IDENTIFIER_INVALID', field + ' 不合法。', 400, { field });
  }
  return normalized;
}

function requiredText(value, field, label, max = 1000) {
  const normalized = text(value, max);
  if (!normalized) throw paymentError('PAYMENT_FIELD_REQUIRED', label + ' 為必填。', 400, { field });
  return normalized;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function requireContext(context, role) {
  const tenant = object(context?.tenant);
  const actor = requiredText(context?.actor, 'actor', '操作者', 240);
  if (!tenant.key) throw paymentError('PAYMENT_TENANT_REQUIRED', '缺少工程租戶內容。', 403);
  const permissions = new Set(array(context?.permissions).map((item) => text(item, 120)));
  if (!permissions.has(role)) {
    throw paymentError('PAYMENT_ROLE_REQUIRED', '目前角色無權執行這個付款控制動作。', 403, { role });
  }
  if (!context?.scope) throw paymentError('PAYMENT_PROJECT_SCOPE_REQUIRED', '缺少授權的工程專案範圍。', 403);
  return { tenant, actor, scope: context.scope };
}

function scopeAllows(scope, contract) {
  if (scope?.all === true) return true;
  const values = scope instanceof Set ? scope : new Set(array(scope?.projectIds || scope?.projects || scope));
  const project = text(first(contract?.projectId, contract?.project_id, contract?.projectNotionPageId,
    contract?.project_notion_page_id, contract?.projectCode, contract?.project_code), 160);
  return values.has(project);
}

function versionPackage(version) {
  return object(first(version?.documentPackage, version?.contractSnapshot?.documentPackage,
    version?.contract_snapshot?.documentPackage, version?.snapshot?.documentPackage));
}

function lifecycleStatus(context) {
  return text(first(context?.signingSession?.status, context?.signing_session?.status,
    context?.contract?.signingStatus, context?.contract?.signing_status), 100).toLowerCase();
}

function assertContractAuthority(contractContext, context) {
  const contract = object(contractContext?.contract);
  const version = object(contractContext?.version);
  if (!contract.id || !version.id) {
    throw paymentError('PAYMENT_CONTRACT_CONTEXT_INCOMPLETE', '缺少權威合約或版本資料，不能建立付款作業。', 409);
  }
  if (!scopeAllows(context.scope, contract)) {
    throw paymentError('PAYMENT_PROJECT_OUT_OF_SCOPE', '此合約不在目前工程專案授權範圍內。', 403);
  }
  const versionStatus = text(version.status, 100).toLowerCase();
  if (!new Set(['frozen', 'issued', 'superseded']).has(versionStatus)) {
    throw paymentError('PAYMENT_VERSION_NOT_FROZEN', '付款作業只能引用已凍結的合約版本。', 409);
  }
  if (!SHA256.test(text(first(version.bundleSha256, version.bundle_sha256), 80).toLowerCase())) {
    throw paymentError('PAYMENT_VERSION_EVIDENCE_MISSING', '合約版本缺少凍結雜湊，不能建立付款作業。', 409);
  }
  const signing = lifecycleStatus(contractContext);
  if (!ACTIVE_SIGNING_STATUSES.has(signing)) {
    throw paymentError('PAYMENT_SIGNING_NOT_CONFIRMED', '雙方簽署及我方確認完成前，不可建立請款作業。', 409);
  }
  return { contract, version };
}

function normalizeMilestone(value, version, contract) {
  const source = object(value);
  const milestoneId = id(first(source.id, source.milestoneId, source.milestone_id), 'milestoneId');
  const label = requiredText(first(source.label, source.name), 'milestoneLabel', '付款期別', 240);
  const scheduledAmount = Number(first(source.amount, source.scheduledAmount));
  const percentage = Number(first(source.percentage, source.ratio));
  const contractAmount = Number(first(contract.amount, contract.contract_amount));
  const computedAmount = Number.isFinite(scheduledAmount) && scheduledAmount > 0
    ? scheduledAmount
    : (Number.isFinite(percentage) && percentage > 0 && Number.isFinite(contractAmount) && contractAmount > 0
      ? Math.round(contractAmount * percentage) / 100 : NaN);
  if (!Number.isFinite(computedAmount) || computedAmount <= 0) {
    throw paymentError('PAYMENT_MILESTONE_AMOUNT_UNKNOWN', '付款條件缺少可核對的期別金額，請先修正合約版本。', 409, {
      milestoneId, versionId: version.id,
    });
  }
  return Object.freeze({
    id: milestoneId,
    label,
    amount: Math.round(computedAmount * 100) / 100,
    currency: currency(first(contract.currency, source.currency, 'TWD')),
    trigger: text(first(source.trigger, source.triggerText, source.trigger_text), 1000),
    dueAt: text(first(source.fixedDueAt, source.fixed_due_at, source.dueDate, source.due_date), 80),
    evidenceRequired: text(first(source.evidenceRequired, source.evidence_required), 2000),
  });
}

export function derivePaymentSchedule(contractContext, context) {
  const authority = assertContractAuthority(contractContext, context);
  const contract = authority.contract;
  const version = authority.version;
  const packageValue = versionPackage(version);
  const milestones = array(first(packageValue.paymentMilestones, packageValue.payment_milestones));
  if (!milestones.length) {
    throw paymentError('PAYMENT_SCHEDULE_MISSING', '這份已簽約合約沒有付款條件，請由合約管理者以新版處理。', 409);
  }
  return Object.freeze({
    contractId: id(contract.id, 'contractId'),
    projectId: id(first(contract.projectId, contract.project_id, contract.projectNotionPageId,
      contract.project_notion_page_id), 'projectId'),
    contractNumber: text(first(contract.contractNumber, contract.contract_number), 160),
    projectCode: text(first(contract.projectCode, contract.project_code), 160),
    versionId: id(version.id, 'versionId'),
    versionNo: Number(first(version.versionNo, version.version_no)) || 0,
    versionFingerprint: text(first(version.bundleSha256, version.bundle_sha256), 64).toLowerCase(),
    milestones: Object.freeze(milestones.map((item) => normalizeMilestone(item, version, contract))),
  });
}

function normalizeEvidence(input) {
  const source = object(input);
  const evidenceId = id(first(source.id, source.evidenceId, source.evidence_id), 'evidenceId');
  const kind = requiredText(first(source.kind, source.type, source.documentKind), 'evidenceKind', '請款佐證類型', 80);
  const sha256 = text(first(source.sha256, source.sha_256), 64).toLowerCase();
  if (!SHA256.test(sha256)) {
    throw paymentError('PAYMENT_EVIDENCE_HASH_INVALID', '每一份請款佐證都必須有 SHA-256 雜湊。', 400, { evidenceId });
  }
  return Object.freeze({ id: evidenceId, kind, sha256 });
}

function normalizeEvidenceList(value) {
  const records = array(value).map(normalizeEvidence);
  if (!records.length) {
    throw paymentError('PAYMENT_EVIDENCE_REQUIRED', '提交請款前，至少要附上一份可核對的佐證。', 400);
  }
  if (new Set(records.map((item) => item.id)).size !== records.length) {
    throw paymentError('PAYMENT_EVIDENCE_DUPLICATE', '請款佐證不可重複。', 400);
  }
  return Object.freeze(records);
}

function idempotencyKey(value) {
  const key = text(value, 160);
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(key)) {
    throw paymentError('PAYMENT_IDEMPOTENCY_KEY_INVALID', '付款控制動作需要有效且至少 16 字元的冪等鍵。', 400);
  }
  return key;
}

function nextAction(status) {
  return ({
    submitted: { label: '由獨立覆核者核對請款條件與佐證。', owner: 'payment_reviewer' },
    under_review: { label: '完成請款覆核，提出核准或補件結論。', owner: 'payment_reviewer' },
    changes_requested: { label: '補齊請款佐證後，重新提交。', owner: 'claim_submitter' },
    approved: { label: '已核准請款；財務仍須依公司既有制度另行辦理，系統未發起付款。', owner: 'finance_process_owner' },
    rejected: { label: '請款已駁回；如需重提，應建立新請款與新佐證。', owner: 'claim_submitter' },
    cancelled: { label: '請款已取消。', owner: 'none' },
  })[status] || { label: '請核對付款作業狀態。', owner: 'payment_controller' };
}

function publicClaim(claim) {
  const output = {};
  for (const key of PUBLIC_CLAIM_FIELDS) {
    if (claim && Object.hasOwn(claim, key)) output[key] = claim[key];
  }
  const status = text(output.status, 80);
  output.status = status;
  output.evidenceCount = Number(output.evidenceCount ?? array(claim?.evidence).length) || 0;
  output.evidenceKinds = array(output.evidenceKinds || array(claim?.evidence).map((item) => item.kind))
    .map((item) => text(item, 80)).filter(Boolean);
  output.nextAction = text(output.nextAction || nextAction(status).label, 300);
  output.nextActionOwner = text(output.nextActionOwner || nextAction(status).owner, 100);
  output.sourceSummary = text(output.sourceSummary, 300);
  return Object.freeze(output);
}

function eventShape({ type, claim, actor, at, authority, idempotency, details = {} }) {
  if (!PAYMENT_EVENT_TYPES.includes(type)) throw paymentError('PAYMENT_EVENT_TYPE_INVALID', '付款事件類型不合法。', 500);
  return Object.freeze({
    eventType: type,
    eventVersion: PAYMENT_WORKFLOW_VERSION,
    contractId: id(claim.contractId, 'contractId'),
    claimId: id(claim.id, 'claimId'),
    occurredAt: iso(at, 'occurredAt'),
    actorKind: 'internal_user',
    actor: text(actor, 240),
    authority: Object.freeze({
      role: text(authority.role, 120),
      projectScopeConfirmed: authority.projectScopeConfirmed === true,
      separationConfirmed: authority.separationConfirmed === true,
    }),
    idempotencyKey: idempotencyKey(idempotency),
    evidenceFingerprint: fingerprint(array(claim.evidence).map((item) => ({
      id: item.id, kind: item.kind, sha256: item.sha256,
    }))),
    details: Object.freeze(details),
  });
}

function actionResult(claim, event, replayed = false) {
  return Object.freeze({
    workflowVersion: PAYMENT_WORKFLOW_VERSION,
    replayed,
    claim: publicClaim(claim),
    audit: Object.freeze({
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      actorKind: event.actorKind,
      authorityRole: event.authority.role,
      evidenceFingerprint: event.evidenceFingerprint,
    }),
    paymentExecution: Object.freeze({
      initiated: false,
      message: '本動作只記錄請款控制與核准證據，未建立匯款、扣款或付款指令。',
    }),
  });
}

async function resolveReplay(store, tenant, action, key, contractId) {
  if (typeof store.findPaymentIdempotency !== 'function') return null;
  const replay = unwrap(await store.findPaymentIdempotency(tenant, { action, idempotencyKey: key, contractId }));
  if (!replay) return null;
  return {
    claim: object(replay.claim || replay),
    event: object(replay.event || {
      eventType: replay.eventType || action,
      occurredAt: replay.occurredAt,
      actorKind: 'internal_user',
      actor: '',
      authority: { role: '' },
      evidenceFingerprint: replay.evidenceFingerprint || '',
      idempotencyKey: key,
    }),
  };
}

function requireStoreMethod(store, name) {
  if (!store || typeof store[name] !== 'function') {
    throw paymentError('PAYMENT_STORE_UNAVAILABLE', '付款控制儲存介面尚未就緒。', 503, { method: name });
  }
}

function claimForCreate(schedule, milestone, input, actor, submittedAt, evidence) {
  const value = amount(input.amount);
  if (value > milestone.amount + 0.01) {
    throw paymentError('PAYMENT_CLAIM_EXCEEDS_MILESTONE', '請款金額不可超過合約付款期別金額。', 409, {
      claimedAmount: value, milestoneAmount: milestone.amount,
    });
  }
  return Object.freeze({
    id: id(input.claimId, 'claimId'),
    contractId: schedule.contractId,
    projectId: schedule.projectId,
    contractNumber: schedule.contractNumber,
    projectCode: schedule.projectCode,
    versionId: schedule.versionId,
    versionNo: schedule.versionNo,
    versionFingerprint: schedule.versionFingerprint,
    milestoneId: milestone.id,
    milestoneLabel: milestone.label,
    amount: value,
    currency: milestone.currency,
    status: 'submitted',
    submittedAt,
    submittedBy: actor,
    sourceSummary: requiredText(input.sourceSummary, 'sourceSummary', '請款依據說明', 300),
    evidence,
    evidenceCount: evidence.length,
    evidenceKinds: evidence.map((item) => item.kind),
    reviewDueAt: iso(input.reviewDueAt, 'reviewDueAt', false),
  });
}

function assertClaimState(claim, expected) {
  const status = text(claim?.status, 80);
  if (!expected.includes(status)) {
    throw paymentError('PAYMENT_CLAIM_STATE_INVALID', '目前請款狀態不能執行此動作。', 409, {
      currentStatus: status, expected,
    });
  }
}

export function createEngineeringContractPaymentService({ store, clock = () => new Date() } = {}) {
  async function schedule(context, contractId) {
    const verified = requireContext(context, PAYMENT_ROLES.submit);
    requireStoreMethod(store, 'getContractPaymentContext');
    const contractContext = unwrap(await store.getContractPaymentContext(verified.tenant, {
      contractId: id(contractId, 'contractId'),
    }));
    return derivePaymentSchedule(contractContext, verified);
  }

  async function submitClaim(context, input = {}) {
    const verified = requireContext(context, PAYMENT_ROLES.submit);
    requireStoreMethod(store, 'getContractPaymentContext');
    requireStoreMethod(store, 'createPaymentClaim');
    requireStoreMethod(store, 'appendPaymentEvent');
    const key = idempotencyKey(input.idempotencyKey);
    const contractId = id(input.contractId, 'contractId');
    const replay = await resolveReplay(store, verified.tenant, 'claim_submitted', key, contractId);
    if (replay) return actionResult(replay.claim, replay.event, true);
    const contractContext = unwrap(await store.getContractPaymentContext(verified.tenant, { contractId }));
    const paymentSchedule = derivePaymentSchedule(contractContext, verified);
    const milestone = paymentSchedule.milestones.find((item) => item.id === id(input.milestoneId, 'milestoneId'));
    if (!milestone) throw paymentError('PAYMENT_MILESTONE_NOT_FOUND', '找不到這個合約付款期別。', 404);
    const submittedAt = iso(first(input.submittedAt, clock().toISOString()), 'submittedAt');
    const evidence = normalizeEvidenceList(input.evidence);
    const claim = claimForCreate(paymentSchedule, milestone, input, verified.actor, submittedAt, evidence);
    const event = eventShape({
      type: 'claim_submitted', claim, actor: verified.actor, at: submittedAt,
      authority: { role: PAYMENT_ROLES.submit, projectScopeConfirmed: true, separationConfirmed: true },
      idempotency: key,
      details: { milestoneId: milestone.id, amount: claim.amount, currency: claim.currency },
    });
    const saved = unwrap(await store.createPaymentClaim(verified.tenant, {
      claim, idempotencyKey: key, actor: verified.actor,
    }));
    const persisted = object(saved.claim || saved) || claim;
    await store.appendPaymentEvent(verified.tenant, { event, idempotencyKey: key });
    return actionResult({ ...claim, ...persisted }, event);
  }

  async function reviewClaim(context, input = {}) {
    const verified = requireContext(context, PAYMENT_ROLES.review);
    requireStoreMethod(store, 'getPaymentClaim');
    requireStoreMethod(store, 'recordPaymentReview');
    requireStoreMethod(store, 'appendPaymentEvent');
    const claimId = id(input.claimId, 'claimId');
    const key = idempotencyKey(input.idempotencyKey);
    const claim = object(unwrap(await store.getPaymentClaim(verified.tenant, { claimId })));
    if (!claim.id || !scopeAllows(verified.scope, claim)) throw paymentError('PAYMENT_CLAIM_NOT_FOUND', '找不到此範圍內的請款。', 404);
    const replay = await resolveReplay(store, verified.tenant, 'claim_review_started', key, id(claim.contractId, 'contractId'));
    if (replay) return actionResult(replay.claim, replay.event, true);
    assertClaimState(claim, ['submitted', 'changes_requested', 'under_review']);
    if (text(claim.submittedBy, 240) === verified.actor) {
      throw paymentError('PAYMENT_REVIEW_SEPARATION_REQUIRED', '請款提交人不得覆核自己的請款。', 409);
    }
    const decision = text(input.decision, 80);
    if (!['start_review', 'changes_requested', 'rejected'].includes(decision)) {
      throw paymentError('PAYMENT_REVIEW_DECISION_INVALID', '覆核決定必須是開始覆核、要求補件或駁回。');
    }
    const reviewedAt = iso(first(input.reviewedAt, clock().toISOString()), 'reviewedAt');
    const nextStatus = decision === 'start_review' ? 'under_review'
      : (decision === 'changes_requested' ? 'changes_requested' : 'rejected');
    const updated = {
      ...claim,
      status: nextStatus,
      reviewedAt,
      reviewedBy: verified.actor,
      reviewSummary: requiredText(input.summary, 'summary', '覆核說明', 500),
    };
    const type = decision === 'start_review' ? 'claim_review_started'
      : (decision === 'changes_requested' ? 'claim_changes_requested' : 'claim_rejected');
    const event = eventShape({
      type, claim: updated, actor: verified.actor, at: reviewedAt,
      authority: { role: PAYMENT_ROLES.review, projectScopeConfirmed: true, separationConfirmed: true },
      idempotency: key, details: { decision },
    });
    const saved = unwrap(await store.recordPaymentReview(verified.tenant, {
      claimId, expectedStatus: text(claim.status, 80), claim: updated, idempotencyKey: key, actor: verified.actor,
    }));
    await store.appendPaymentEvent(verified.tenant, { event, idempotencyKey: key });
    return actionResult({ ...updated, ...object(saved.claim || saved) }, event);
  }

  async function approveClaim(context, input = {}) {
    const verified = requireContext(context, PAYMENT_ROLES.approve);
    requireStoreMethod(store, 'getPaymentClaim');
    requireStoreMethod(store, 'recordPaymentApproval');
    requireStoreMethod(store, 'appendPaymentEvent');
    const claimId = id(input.claimId, 'claimId');
    const key = idempotencyKey(input.idempotencyKey);
    const claim = object(unwrap(await store.getPaymentClaim(verified.tenant, { claimId })));
    if (!claim.id || !scopeAllows(verified.scope, claim)) throw paymentError('PAYMENT_CLAIM_NOT_FOUND', '找不到此範圍內的請款。', 404);
    const replay = await resolveReplay(store, verified.tenant, 'claim_approved', key, id(claim.contractId, 'contractId'));
    if (replay) return actionResult(replay.claim, replay.event, true);
    assertClaimState(claim, ['under_review']);
    if (text(claim.submittedBy, 240) === verified.actor || text(claim.reviewedBy, 240) === verified.actor) {
      throw paymentError('PAYMENT_APPROVAL_SEPARATION_REQUIRED', '核准人不得同時是請款提交人或覆核人。', 409);
    }
    const approvedAt = iso(first(input.approvedAt, clock().toISOString()), 'approvedAt');
    const updated = {
      ...claim,
      status: 'approved',
      approvedAt,
      approvedBy: verified.actor,
      approvalSummary: requiredText(input.summary, 'summary', '核准說明', 500),
    };
    const event = eventShape({
      type: 'claim_approved', claim: updated, actor: verified.actor, at: approvedAt,
      authority: { role: PAYMENT_ROLES.approve, projectScopeConfirmed: true, separationConfirmed: true },
      idempotency: key, details: { amount: updated.amount, currency: updated.currency },
    });
    const saved = unwrap(await store.recordPaymentApproval(verified.tenant, {
      claimId, expectedStatus: 'under_review', claim: updated, idempotencyKey: key, actor: verified.actor,
    }));
    await store.appendPaymentEvent(verified.tenant, { event, idempotencyKey: key });
    return actionResult({ ...updated, ...object(saved.claim || saved) }, event);
  }

  async function getClaim(context, claimId) {
    const verified = requireContext(context, PAYMENT_ROLES.submit);
    requireStoreMethod(store, 'getPaymentClaim');
    const claim = object(unwrap(await store.getPaymentClaim(verified.tenant, { claimId: id(claimId, 'claimId') })));
    if (!claim.id || !scopeAllows(verified.scope, claim)) throw paymentError('PAYMENT_CLAIM_NOT_FOUND', '找不到此範圍內的請款。', 404);
    return publicClaim(claim);
  }

  return Object.freeze({ schedule, submitClaim, reviewClaim, approveClaim, getClaim });
}

export const __test = Object.freeze({
  PAYMENT_WORKFLOW_VERSION,
  PAYMENT_ROLES,
  PAYMENT_CLAIM_STATUSES,
  PAYMENT_EVENT_TYPES,
  PAYMENT_CLAIM_TERMINAL_STATUSES: TERMINAL_STATUSES,
  derivePaymentSchedule,
  normalizeEvidence,
  normalizeEvidenceList,
  publicClaim,
  eventShape,
  nextAction,
  fingerprint,
});

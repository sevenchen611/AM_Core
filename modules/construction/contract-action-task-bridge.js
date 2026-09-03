import { createHash } from 'node:crypto';

// This bridge is intentionally a pure planning boundary. It does not know how
// to write a Notion task, send LINE, or call a production task API. A
// project-local adapter must review and apply a returned intent under its own
// tenant, authorization, source-evidence, and sensitive-task rules.

export const ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION = '2026-09-03.contract-action-task-bridge.v1';

const ACTIONS_WITHOUT_TASK = new Set(['', 'none']);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled', 'no_action']);

const ACTION_DEFINITIONS = Object.freeze({
  issue_signing_request: Object.freeze({ title: '簽發並送出工程合約簽署邀請', status: 'pending', sensitive: 'contractual' }),
  assign_party_a_signer: Object.freeze({ title: '指定工程合約甲方簽署人', status: 'pending', sensitive: 'contractual' }),
  sign_party_a: Object.freeze({ title: '請工程合約甲方完成線上簽署', status: 'waiting', sensitive: 'contractual' }),
  sign_party_b: Object.freeze({ title: '請工程合約乙方完成線上簽署', status: 'waiting', sensitive: 'contractual' }),
  confirm_signature_evidence: Object.freeze({ title: '核對工程合約甲、乙方簽署證據並由我方確認', status: 'pending', sensitive: 'contractual' }),
  archive_confirmed_contract: Object.freeze({ title: '完成已確認工程合約的歸檔與收據', status: 'pending', sensitive: 'contractual' }),
  review_and_reissue: Object.freeze({ title: '檢視工程合約簽署異常並決定是否重新簽發', status: 'pending', sensitive: 'contractual' }),
  review_declined_signature: Object.freeze({ title: '檢視工程合約拒簽原因並決定修訂或重送', status: 'pending', sensitive: 'contractual' }),
  verify_party_a_requirement: Object.freeze({ title: '核對工程合約凍結版本中的甲方簽署型態', status: 'pending', sensitive: 'contractual' }),
  reconcile_authoritative_signing_data: Object.freeze({ title: '核對工程合約權威簽署資料與控制頁差異', status: 'pending', sensitive: 'contractual' }),
});

export class EngineeringContractTaskBridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EngineeringContractTaskBridgeError';
    this.code = code;
    this.details = details;
  }
}

function text(value, max = 500) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, max);
}

function requireText(value, field, max = 500) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new EngineeringContractTaskBridgeError('INVALID_FIELD', field + ' must be a non-empty string', { field });
  }
  return normalized;
}

function iso(value, field) {
  const normalized = requireText(value, field, 80);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new EngineeringContractTaskBridgeError('INVALID_TIMESTAMP', field + ' must be an ISO timestamp', { field });
  }
  return new Date(normalized).toISOString();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stableHash(parts) {
  return createHash('sha256')
    .update(parts.map((part) => text(part, 1_000)).join('|'))
    .digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  if (!value || typeof value !== 'object') return JSON.stringify(value ?? null);
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function normalizeEvidence(evidence, tenantKey) {
  const source = object(evidence);
  const evidenceTenantKey = text(source.tenantKey, 160);
  if (evidenceTenantKey && evidenceTenantKey !== tenantKey) {
    throw new EngineeringContractTaskBridgeError('CROSS_TENANT_EVIDENCE', 'Evidence belongs to another tenant', {
      expectedTenantKey: tenantKey,
      evidenceTenantKey,
    });
  }
  return Object.freeze({
    tenantKey,
    sourceType: text(source.sourceType, 80) || 'engineering_contract_event',
    sourceId: requireText(source.sourceId, 'sourceEvidence.sourceId', 200),
    locator: requireText(source.locator, 'sourceEvidence.locator', 600),
    occurredAt: iso(source.occurredAt, 'sourceEvidence.occurredAt'),
    summary: requireText(source.summary, 'sourceEvidence.summary', 800),
  });
}

function uniqueEvidence(evidence) {
  const seen = new Set();
  return evidence.filter((item) => {
    const key = [item.sourceType, item.sourceId, item.locator, item.occurredAt].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionDefinition(actionCode, actionLabel) {
  return ACTION_DEFINITIONS[actionCode] || {
    title: text(actionLabel, 240) || '處理工程合約控制待辦',
    status: 'pending',
    sensitive: 'contractual',
  };
}

function semanticKey({ tenantKey, projectId, contractId, actionCode }) {
  return 'engineering-contract-action:' + stableHash([
    ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION, tenantKey, projectId, contractId, actionCode,
  ]);
}

function stateFingerprint(controlState) {
  const state = object(controlState);
  return stableHash([
    state.stage,
    state.underlyingStage,
    state.waitingOn,
    object(state.primaryNextAction).code,
    object(state.partyA).status,
    object(state.partyB).status,
    object(state.internal).status,
    object(state.archive).status,
    object(state.health).status,
    stableJson(object(state.timestamps)),
  ]);
}

function sourceStatusEvidence({ observedAt, controlState, sourceEvidence }) {
  return Object.freeze({
    type: 'engineering_contract_control_state_observed',
    observedAt,
    stage: text(controlState.stage, 100),
    underlyingStage: text(controlState.underlyingStage, 100),
    waitingOn: text(controlState.waitingOn, 100),
    sourceRefs: sourceEvidence.map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      locator: item.locator,
      occurredAt: item.occurredAt,
      summary: item.summary,
    })),
  });
}

function existingMatch(existingTaskIntents, key) {
  return list(existingTaskIntents)
    .filter((item) => object(item).semanticKey === key)
    .sort((left, right) => Date.parse(text(right.updatedAt || right.observedAt)) - Date.parse(text(left.updatedAt || left.observedAt)))[0] || null;
}

/**
 * Builds one append-only instruction for project-local task handling.
 *
 * The instruction is never a task write. It contains deterministic keys for
 * deduplication and enough project-local evidence to let the receiving task
 * adapter create/update a task safely. Missing goal or evidence deliberately
 * degrades the output to a candidate requiring confirmation.
 */
export function deriveEngineeringContractActionTaskIntent(input = {}) {
  const source = object(input);
  const tenantKey = requireText(source.tenantKey, 'tenantKey', 160);
  const projectId = requireText(source.projectId, 'projectId', 200);
  const contract = object(source.contract);
  const contractId = requireText(contract.id ?? source.contractId, 'contract.id', 200);
  const controlState = object(source.controlState);
  const primaryAction = object(controlState.primaryNextAction);
  const actionCode = text(primaryAction.code, 100);
  const observedAt = iso(source.observedAt ?? source.now, 'observedAt');

  if (ACTIONS_WITHOUT_TASK.has(actionCode)) {
    return Object.freeze({
      bridgeVersion: ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION,
      operation: 'no_action',
      reason: 'control_state_has_no_actionable_next_step',
      tenantKey,
      projectId,
      contractId,
      observedAt,
    });
  }

  const goal = object(source.projectGoal);
  const projectGoalId = text(goal.id ?? source.projectGoalId, 200);
  const projectGoalTitle = text(goal.title ?? source.projectGoalTitle, 300);
  const normalizedEvidence = [];
  const evidenceErrors = [];
  for (const candidate of list(source.sourceEvidence)) {
    try {
      normalizedEvidence.push(normalizeEvidence(candidate, tenantKey));
    } catch (error) {
      evidenceErrors.push({ code: error.code ?? 'INVALID_EVIDENCE', message: error.message });
    }
  }
  const sourceEvidence = uniqueEvidence(normalizedEvidence);
  const key = semanticKey({ tenantKey, projectId, contractId, actionCode });
  const fingerprint = stateFingerprint(controlState);
  const current = existingMatch(source.existingTaskIntents, key);
  const formal = Boolean(projectGoalId) && sourceEvidence.length > 0 && evidenceErrors.length === 0;
  const definition = actionDefinition(actionCode, primaryAction.label);
  const candidateReasons = [
    ...(projectGoalId ? [] : [{ code: 'PROJECT_GOAL_REQUIRED', message: '尚未連結專案目標，僅能保留為候選待辦。' }]),
    ...(sourceEvidence.length ? [] : [{ code: 'SOURCE_EVIDENCE_REQUIRED', message: '缺少可稽核的工程合約來源證據，僅能保留為候選待辦。' }]),
    ...evidenceErrors,
  ];

  if (current && current.stateFingerprint === fingerprint && !TERMINAL_TASK_STATUSES.has(text(current.status, 80))) {
    return Object.freeze({
      bridgeVersion: ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION,
      operation: 'deduplicated',
      reason: 'same_contract_action_and_control_state_already_planned',
      tenantKey,
      projectId,
      contractId,
      semanticKey: key,
      stateFingerprint: fingerprint,
      existingTaskIntentId: text(current.taskIntentId ?? current.id, 200) || null,
      observedAt,
    });
  }

  const status = formal ? definition.status : 'candidate';
  const statusChangeEvidence = sourceStatusEvidence({ observedAt, controlState, sourceEvidence });
  const operation = current ? 'update_task_intent' : 'create_task_intent';
  const idempotencyKey = 'engineering-contract-action-state:' + stableHash([key, fingerprint]);
  const titleSuffix = text(contract.number ?? contract.title ?? source.contractTitle, 300);
  const title = titleSuffix ? definition.title + '：' + titleSuffix : definition.title;

  return Object.freeze({
    bridgeVersion: ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION,
    operation,
    idempotencyKey,
    semanticKey: key,
    stateFingerprint: fingerprint,
    tenantKey,
    projectId,
    contractId,
    observedAt,
    task: Object.freeze({
      taskIntentId: text(current?.taskIntentId ?? current?.id, 200) || null,
      title,
      status,
      formalizationStatus: formal ? 'formal' : 'candidate',
      confirmationStatus: formal ? 'confirmed' : 'pending_confirmation',
      sensitivity: definition.sensitive,
      projectGoalId: projectGoalId || null,
      projectGoalTitle: projectGoalTitle || null,
      actionCode,
      actionLabel: text(primaryAction.label, 300) || definition.title,
      waitingOn: text(controlState.waitingOn, 120) || null,
      nextAction: text(primaryAction.label, 500) || definition.title,
      contractReference: Object.freeze({
        contractId,
        contractNumber: text(contract.number, 160) || null,
        contractTitle: text(contract.title, 300) || null,
        stage: text(controlState.stage, 100),
        underlyingStage: text(controlState.underlyingStage, 100),
      }),
      sourceEvidence: Object.freeze(sourceEvidence),
      statusChangeEvidence,
      candidateReasons: Object.freeze(candidateReasons),
      requiresProjectOwnerConfirmation: definition.sensitive === 'contractual',
    }),
    transition: Object.freeze({
      fromStatus: text(current?.status, 80) || null,
      toStatus: status,
      observedAt,
      evidence: statusChangeEvidence,
      appliedRuleRefs: Object.freeze(['AMCore:engineering-contract-action-task-bridge.v1']),
    }),
    delivery: Object.freeze({
      mode: 'adapter_must_apply_explicitly',
      writesPerformed: false,
      forbiddenSideEffects: Object.freeze(['notion_write', 'line_send', 'production_task_mutation']),
    }),
  });
}

export const __test = Object.freeze({ semanticKey, stateFingerprint, stableHash });

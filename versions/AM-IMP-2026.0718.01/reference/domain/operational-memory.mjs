import { createHash } from 'node:crypto';

export const TASK_STATUSES = Object.freeze([
  'candidate',
  'pending',
  'in_progress',
  'waiting',
  'pending_completion_confirmation',
  'completed',
  'cancelled',
  'no_action'
]);

export const DECISION_STATUSES = Object.freeze([
  'draft',
  'active',
  'superseded',
  'revoked'
]);

export const KNOWLEDGE_STATUSES = Object.freeze([
  'candidate',
  'verified',
  'deprecated',
  'expired'
]);

export const RECONCILIATION_ACTIONS = Object.freeze([
  'update_existing_task',
  'create_new_event_task',
  'mark_judged_no_task',
  'request_confirmation'
]);

const EVIDENCE_SOURCE_TYPES = new Set([
  'line_message',
  'line_thread',
  'meeting',
  'daily_report',
  'system_suggestion',
  'attachment',
  'notion_page',
  'manual_correction'
]);

const SENSITIVE_CATEGORIES = new Set([
  'financial',
  'contractual',
  'legal',
  'hr',
  'tax',
  'external_commitment'
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OperationalMemoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OperationalMemoryError';
    this.code = code;
    this.details = details;
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OperationalMemoryError('INVALID_FIELD', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function requireUuid(value, field) {
  const normalized = requireString(value, field);
  if (!UUID_RE.test(normalized)) {
    throw new OperationalMemoryError('INVALID_UUID', `${field} must be a UUID`, { field });
  }
  return normalized.toLowerCase();
}

function normalizeIso(value, field) {
  const normalized = requireString(value, field);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new OperationalMemoryError('INVALID_TIMESTAMP', `${field} must be an ISO timestamp`, { field });
  }
  return new Date(normalized).toISOString();
}

export function assertTenantContext(context) {
  if (!context || typeof context !== 'object') {
    throw new OperationalMemoryError('TENANT_CONTEXT_REQUIRED', 'TenantContext is required');
  }

  const tenantId = requireUuid(context.tenantId, 'tenantContext.tenantId');
  const tenantKey = requireString(context.tenantKey, 'tenantContext.tenantKey');
  const timezone = requireString(context.timezone, 'tenantContext.timezone');

  return Object.freeze({ ...context, tenantId, tenantKey, timezone });
}

export function normalizeTaskText(value) {
  return requireString(value, 'taskText')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-Hant')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function buildIdempotencyKey(kind, parts) {
  requireString(kind, 'kind');
  if (!parts || typeof parts !== 'object') {
    throw new OperationalMemoryError('INVALID_IDEMPOTENCY_PARTS', 'Idempotency key parts are required');
  }

  const tenantId = requireUuid(parts.tenantId, 'parts.tenantId');
  const stableParts = Object.entries(parts)
    .filter(([key]) => key !== 'tenantId')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value ?? '').normalize('NFKC').trim()}`);

  const digest = createHash('sha256')
    .update([kind, tenantId, ...stableParts].join('|'))
    .digest('hex');

  return `${kind}:${digest}`;
}

export function buildMeetingTaskIdempotencyKey({ tenantId, meetingRef, checkboxText }) {
  return buildIdempotencyKey('meeting-checkbox', {
    tenantId,
    meetingRef: requireString(meetingRef, 'meetingRef'),
    checkboxText: normalizeTaskText(checkboxText)
  });
}

export function validateEvidenceRef(evidence, expectedTenantId) {
  const tenantId = requireUuid(expectedTenantId, 'expectedTenantId');
  if (!evidence || typeof evidence !== 'object') {
    throw new OperationalMemoryError('EVIDENCE_REQUIRED', 'EvidenceRef must be an object');
  }

  const evidenceTenantId = requireUuid(evidence.tenantId, 'evidence.tenantId');
  if (evidenceTenantId !== tenantId) {
    throw new OperationalMemoryError('CROSS_TENANT_EVIDENCE', 'EvidenceRef belongs to a different tenant', {
      expectedTenantId: tenantId,
      evidenceTenantId
    });
  }

  const sourceType = requireString(evidence.sourceType, 'evidence.sourceType');
  if (!EVIDENCE_SOURCE_TYPES.has(sourceType)) {
    throw new OperationalMemoryError('UNSUPPORTED_EVIDENCE_TYPE', `Unsupported evidence type: ${sourceType}`);
  }

  const normalized = {
    ...evidence,
    tenantId,
    sourceType,
    sourceId: requireString(evidence.sourceId, 'evidence.sourceId'),
    occurredAt: normalizeIso(evidence.occurredAt, 'evidence.occurredAt'),
    locator: requireString(evidence.locator, 'evidence.locator'),
    contentHash: requireString(evidence.contentHash, 'evidence.contentHash'),
    excerpt: requireString(evidence.excerpt, 'evidence.excerpt')
  };

  if (sourceType === 'line_message' || sourceType === 'line_thread') {
    requireString(evidence.groupId, 'evidence.groupId');
    requireString(evidence.senderId, 'evidence.senderId');
    requireString(evidence.senderName, 'evidence.senderName');
  }

  if (sourceType === 'meeting') {
    requireString(evidence.meetingRef, 'evidence.meetingRef');
    if (evidence.isCheckboxTask === true) {
      requireString(evidence.checkboxText, 'evidence.checkboxText');
    }
  }

  if (sourceType === 'system_suggestion') {
    requireString(evidence.underlyingSourceId, 'evidence.underlyingSourceId');
  }

  return Object.freeze(normalized);
}

export function evaluateEvidenceGate({
  tenantContext,
  entityType,
  targetConfirmationStatus,
  targetStatus,
  evidenceRefs = [],
  projectGoalId = null,
  appliedRuleRefs = [],
  sensitivity = null,
  ownerConfirmed = false,
  knowledgeApproval = null
}) {
  const tenant = assertTenantContext(tenantContext);
  const normalizedEntityType = requireString(entityType, 'entityType');
  const formalTarget = ['confirmed', 'formal', 'active', 'verified'].includes(targetConfirmationStatus)
    || ['active', 'verified'].includes(targetStatus);
  const errors = [];
  const warnings = [];
  const normalizedEvidence = [];

  for (const evidence of evidenceRefs) {
    try {
      normalizedEvidence.push(validateEvidenceRef(evidence, tenant.tenantId));
    } catch (error) {
      errors.push({ code: error.code ?? 'INVALID_EVIDENCE', message: error.message });
    }
  }

  if (formalTarget && normalizedEvidence.length === 0) {
    errors.push({ code: 'SOURCE_EVIDENCE_GATE_FAILED', message: 'Formal state requires project-local evidence' });
  }

  if (normalizedEntityType === 'task' && formalTarget && !projectGoalId) {
    errors.push({ code: 'PROJECT_GOAL_REQUIRED', message: 'A formal task must link to a project goal' });
  }

  if (normalizedEntityType === 'knowledge' && targetStatus === 'verified') {
    if (!knowledgeApproval?.approvedBy || !knowledgeApproval?.approvedAt) {
      errors.push({ code: 'KNOWLEDGE_APPROVAL_REQUIRED', message: 'Verified knowledge requires explicit approval' });
    }
  }

  if (targetStatus === 'completed' && SENSITIVE_CATEGORIES.has(sensitivity) && ownerConfirmed !== true) {
    errors.push({ code: 'OWNER_CONFIRMATION_REQUIRED', message: 'Sensitive completion requires owner confirmation' });
  }

  if (formalTarget && appliedRuleRefs.length === 0) {
    warnings.push({ code: 'NO_RULE_TRACE', message: 'No applied rule reference was recorded' });
  }

  return Object.freeze({
    allowed: errors.length === 0,
    errors,
    warnings,
    normalizedEvidence
  });
}

function copyTask(task) {
  return {
    ...task,
    sourceEventIds: [...(task.sourceEventIds ?? [])],
    evidenceRefs: [...(task.evidenceRefs ?? [])]
  };
}

export function reconcileTask({ tenantContext, existingTask = null, decision, now }) {
  const tenant = assertTenantContext(tenantContext);
  if (!decision || typeof decision !== 'object') {
    throw new OperationalMemoryError('DECISION_REQUIRED', 'ReconciliationDecision is required');
  }

  const action = requireString(decision.action, 'decision.action');
  if (!RECONCILIATION_ACTIONS.includes(action)) {
    throw new OperationalMemoryError('INVALID_RECONCILIATION_ACTION', `Unsupported action: ${action}`);
  }

  const detectedAt = normalizeIso(now, 'now');
  const evidenceRefs = (decision.evidenceRefs ?? []).map((evidence) => validateEvidenceRef(evidence, tenant.tenantId));

  if (action === 'mark_judged_no_task') {
    return Object.freeze({
      outcome: action,
      task: null,
      transition: null,
      judgment: {
        tenantId: tenant.tenantId,
        detectedAt,
        reasons: decision.reasons ?? [],
        evidenceRefs
      }
    });
  }

  if (action === 'request_confirmation') {
    return Object.freeze({
      outcome: action,
      task: existingTask ? Object.freeze(copyTask(existingTask)) : null,
      transition: null,
      judgment: {
        tenantId: tenant.tenantId,
        detectedAt,
        reasons: decision.reasons ?? [],
        evidenceRefs
      }
    });
  }

  if (existingTask && requireUuid(existingTask.tenantId, 'existingTask.tenantId') !== tenant.tenantId) {
    throw new OperationalMemoryError('CROSS_TENANT_TASK', 'Task belongs to a different tenant');
  }

  if (action === 'create_new_event_task' && existingTask) {
    throw new OperationalMemoryError('DUPLICATE_TASK_RISK', 'Creation action cannot include an existing task');
  }

  if (action === 'update_existing_task' && !existingTask) {
    throw new OperationalMemoryError('MATCHED_TASK_REQUIRED', 'Update action requires an existing task');
  }

  if (existingTask && decision.expectedEntityVersion !== existingTask.version) {
    throw new OperationalMemoryError('OPTIMISTIC_CONCURRENCY_CONFLICT', 'Task version changed; reload and reconcile again', {
      expected: decision.expectedEntityVersion,
      actual: existingTask.version
    });
  }

  const requestedStatus = decision.changes?.status ?? existingTask?.status ?? 'pending';
  if (!TASK_STATUSES.includes(requestedStatus)) {
    throw new OperationalMemoryError('INVALID_TASK_STATUS', `Unsupported task status: ${requestedStatus}`);
  }

  let effectiveStatus = requestedStatus;
  if (
    requestedStatus === 'completed'
    && SENSITIVE_CATEGORIES.has(decision.sensitivity)
    && decision.ownerConfirmed !== true
  ) {
    effectiveStatus = 'pending_completion_confirmation';
  }

  const hasGoal = Boolean(decision.projectGoalId ?? existingTask?.projectGoalId);
  const formalizationStatus = evidenceRefs.length > 0 && hasGoal ? 'formal' : 'candidate';
  if (formalizationStatus === 'candidate') effectiveStatus = 'candidate';

  const previous = existingTask ? copyTask(existingTask) : null;
  const task = {
    ...(previous ?? {}),
    tenantId: tenant.tenantId,
    taskId: decision.taskId ?? previous?.taskId ?? null,
    projectId: decision.projectId ?? previous?.projectId ?? null,
    projectGoalId: decision.projectGoalId ?? previous?.projectGoalId ?? null,
    title: decision.changes?.title ?? previous?.title ?? decision.summary,
    description: decision.changes?.description ?? previous?.description ?? null,
    assigneeId: decision.changes?.assigneeId ?? previous?.assigneeId ?? null,
    requesterId: decision.changes?.requesterId ?? previous?.requesterId ?? null,
    dueAt: decision.changes?.dueAt ?? previous?.dueAt ?? null,
    waitingFor: decision.changes?.waitingFor ?? previous?.waitingFor ?? null,
    blocker: decision.changes?.blocker ?? previous?.blocker ?? null,
    status: effectiveStatus,
    confirmationStatus: evidenceRefs.length > 0 ? 'confirmed' : 'pending',
    formalizationStatus,
    version: (previous?.version ?? 0) + 1,
    updatedAt: detectedAt,
    sourceEventIds: Array.from(new Set([...(previous?.sourceEventIds ?? []), ...(decision.sourceEventIds ?? [])])),
    evidenceRefs: [...(previous?.evidenceRefs ?? []), ...evidenceRefs]
  };

  const transition = {
    tenantId: tenant.tenantId,
    taskId: task.taskId,
    fromVersion: previous?.version ?? 0,
    toVersion: task.version,
    fromStatus: previous?.status ?? null,
    toStatus: task.status,
    detectedAt,
    reason: (decision.reasons ?? []).join('; '),
    evidenceRefs,
    appliedRuleRefs: decision.appliedRuleRefs ?? [],
    sourceEventIds: decision.sourceEventIds ?? []
  };

  return Object.freeze({
    outcome: action,
    task: Object.freeze(task),
    transition: Object.freeze(transition),
    judgment: null
  });
}

export function supersedeDecision({ tenantContext, currentDecision, replacement, evidenceRefs, now }) {
  const tenant = assertTenantContext(tenantContext);
  if (requireUuid(currentDecision.tenantId, 'currentDecision.tenantId') !== tenant.tenantId) {
    throw new OperationalMemoryError('CROSS_TENANT_DECISION', 'Decision belongs to a different tenant');
  }

  const normalizedEvidence = evidenceRefs.map((evidence) => validateEvidenceRef(evidence, tenant.tenantId));
  if (normalizedEvidence.length === 0) {
    throw new OperationalMemoryError('SOURCE_EVIDENCE_GATE_FAILED', 'Decision replacement requires evidence');
  }

  const replacedAt = normalizeIso(now, 'now');
  const replacementId = requireString(replacement.decisionId, 'replacement.decisionId');
  const prior = Object.freeze({
    ...currentDecision,
    status: 'superseded',
    supersededBy: replacementId,
    updatedAt: replacedAt
  });
  const next = Object.freeze({
    ...replacement,
    tenantId: tenant.tenantId,
    status: 'active',
    supersedesDecisionId: currentDecision.decisionId,
    evidenceRefs: normalizedEvidence,
    updatedAt: replacedAt
  });

  return Object.freeze({ prior, next });
}

export function deriveTaskFlags(task, now) {
  const checkedAt = new Date(normalizeIso(now, 'now'));
  const terminal = task.status === 'completed' || task.status === 'cancelled' || task.status === 'no_action';
  const overdue = Boolean(task.dueAt) && !terminal && new Date(task.dueAt) < checkedAt;
  return Object.freeze({ terminal, overdue });
}

export function buildStructuredAnswer({ tenantContext, intent, project, tasks = [], decisions = [], events = [], sources = [], asOf }) {
  const tenant = assertTenantContext(tenantContext);
  const visibleSources = sources.map((source) => validateEvidenceRef(source, tenant.tenantId));
  const timestamp = normalizeIso(asOf, 'asOf');

  if (!project && tasks.length === 0 && decisions.length === 0 && events.length === 0) {
    return Object.freeze({
      intent,
      asOf: timestamp,
      known: false,
      currentStatus: '目前沒有足夠且可追溯的資料可以回答。',
      latestProgress: null,
      nextAction: null,
      owners: [],
      pendingConfirmation: ['請補充專案、時間、人員或來源範圍。'],
      sources: visibleSources
    });
  }

  return Object.freeze({
    intent,
    asOf: timestamp,
    known: true,
    currentStatus: project?.latestSummary ?? project?.status ?? null,
    latestProgress: events[0]?.summary ?? null,
    nextAction: project?.nextAction ?? tasks.find((task) => !deriveTaskFlags(task, timestamp).terminal)?.nextAction ?? null,
    owners: Array.from(new Set([
      project?.ownerName,
      ...tasks.map((task) => task.assigneeName),
      ...decisions.map((decision) => decision.decisionMakerName)
    ].filter(Boolean))),
    pendingConfirmation: [
      ...(project?.blockers ?? []),
      ...tasks.filter((task) => task.status === 'pending_completion_confirmation').map((task) => task.title)
    ],
    sources: visibleSources
  });
}

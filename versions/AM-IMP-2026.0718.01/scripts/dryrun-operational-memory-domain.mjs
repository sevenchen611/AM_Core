import assert from 'node:assert/strict';
import {
  OperationalMemoryError,
  buildIdempotencyKey,
  buildMeetingTaskIdempotencyKey,
  deriveTaskFlags,
  evaluateEvidenceGate,
  reconcileTask,
  supersedeDecision
} from '../reference/domain/operational-memory.mjs';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const context = { tenantId: TENANT_A, tenantKey: 'fixture-am', timezone: 'Asia/Taipei' };

function evidence(overrides = {}) {
  return {
    tenantId: TENANT_A,
    sourceType: 'line_message',
    sourceId: 'line-message-001',
    occurredAt: '2026-07-18T01:00:00.000Z',
    locator: 'line://fixture/group-1/message-001',
    contentHash: 'sha256:fixture-message-001',
    excerpt: '請在週五前寄出報價單。',
    groupId: 'group-1',
    senderId: 'user-1',
    senderName: 'Fixture User',
    ...overrides
  };
}

const sourceKey1 = buildIdempotencyKey('line-message', {
  tenantId: TENANT_A,
  channel: 'line',
  externalMessageId: 'message-001'
});
const sourceKey2 = buildIdempotencyKey('line-message', {
  externalMessageId: 'message-001',
  tenantId: TENANT_A,
  channel: 'line'
});
assert.equal(sourceKey1, sourceKey2, 'idempotency key must not depend on object key order');

assert.equal(
  buildMeetingTaskIdempotencyKey({ tenantId: TENANT_A, meetingRef: 'meeting-1', checkboxText: ' [ ] 寄 出 報價單 ' }),
  buildMeetingTaskIdempotencyKey({ tenantId: TENANT_A, meetingRef: 'meeting-1', checkboxText: '[ ] 寄 出 報價單' }),
  'normalized meeting checkbox text should deduplicate'
);

const noEvidence = evaluateEvidenceGate({
  tenantContext: context,
  entityType: 'task',
  targetConfirmationStatus: 'formal',
  projectGoalId: 'goal-1'
});
assert.equal(noEvidence.allowed, false);
assert(noEvidence.errors.some((item) => item.code === 'SOURCE_EVIDENCE_GATE_FAILED'));

const noGoal = evaluateEvidenceGate({
  tenantContext: context,
  entityType: 'task',
  targetConfirmationStatus: 'formal',
  evidenceRefs: [evidence()]
});
assert.equal(noGoal.allowed, false);
assert(noGoal.errors.some((item) => item.code === 'PROJECT_GOAL_REQUIRED'));

const crossTenantEvidence = evaluateEvidenceGate({
  tenantContext: context,
  entityType: 'task',
  targetConfirmationStatus: 'formal',
  projectGoalId: 'goal-1',
  evidenceRefs: [evidence({ tenantId: TENANT_B })]
});
assert.equal(crossTenantEvidence.allowed, false);
assert(crossTenantEvidence.errors.some((item) => item.code === 'CROSS_TENANT_EVIDENCE'));

const created = reconcileTask({
  tenantContext: context,
  now: '2026-07-18T02:00:00.000Z',
  decision: {
    action: 'create_new_event_task',
    taskId: 'task-1',
    projectId: 'project-1',
    projectGoalId: 'goal-1',
    summary: '完成並寄出報價單',
    changes: { status: 'in_progress', assigneeId: 'user-2', dueAt: '2026-07-18T08:00:00.000Z' },
    evidenceRefs: [evidence()],
    appliedRuleRefs: ['shared:source-evidence-gate'],
    sourceEventIds: ['event-1'],
    reasons: ['明確交辦與期限']
  }
});
assert.equal(created.task.status, 'in_progress');
assert.equal(created.task.version, 1);
assert.equal(created.transition.fromStatus, null);

const updated = reconcileTask({
  tenantContext: context,
  existingTask: created.task,
  now: '2026-07-18T03:00:00.000Z',
  decision: {
    action: 'update_existing_task',
    expectedEntityVersion: 1,
    changes: { status: 'waiting', waitingFor: '客戶確認' },
    evidenceRefs: [evidence({ sourceId: 'line-message-002', contentHash: 'sha256:fixture-message-002', excerpt: '修改版已寄出，等待客戶確認。' })],
    appliedRuleRefs: ['shared:update-existing-before-create'],
    sourceEventIds: ['event-2'],
    reasons: ['後續訊息更新同一交付']
  }
});
assert.equal(updated.task.taskId, created.task.taskId);
assert.equal(updated.task.version, 2);
assert.equal(updated.task.status, 'waiting');
assert.equal(updated.task.sourceEventIds.length, 2);

const sensitive = reconcileTask({
  tenantContext: context,
  existingTask: updated.task,
  now: '2026-07-18T04:00:00.000Z',
  decision: {
    action: 'update_existing_task',
    expectedEntityVersion: 2,
    changes: { status: 'completed' },
    sensitivity: 'contractual',
    ownerConfirmed: false,
    evidenceRefs: [evidence({ sourceId: 'line-message-003', contentHash: 'sha256:fixture-message-003', excerpt: '合約已簽。' })],
    appliedRuleRefs: ['shared:sensitive-close-confirmation'],
    sourceEventIds: ['event-3'],
    reasons: ['可能完成但需 owner 確認']
  }
});
assert.equal(sensitive.task.status, 'pending_completion_confirmation');

const replaced = supersedeDecision({
  tenantContext: context,
  currentDecision: { tenantId: TENANT_A, decisionId: 'decision-1', status: 'active', statement: '會議 15:00' },
  replacement: { decisionId: 'decision-2', statement: '會議改為 16:00' },
  evidenceRefs: [evidence({ sourceId: 'line-message-004', contentHash: 'sha256:fixture-message-004', excerpt: '會議改成四點。' })],
  now: '2026-07-18T05:00:00.000Z'
});
assert.equal(replaced.prior.status, 'superseded');
assert.equal(replaced.prior.supersededBy, 'decision-2');
assert.equal(replaced.next.supersedesDecisionId, 'decision-1');

assert.equal(deriveTaskFlags({ status: 'waiting', dueAt: '2026-07-18T01:00:00.000Z' }, '2026-07-18T06:00:00.000Z').overdue, true);
assert.equal(deriveTaskFlags({ status: 'completed', dueAt: '2026-07-18T01:00:00.000Z' }, '2026-07-18T06:00:00.000Z').overdue, false);

console.log('Operational memory domain dry-run passed: idempotency, evidence, tenant isolation, reconciliation, sensitive closure, supersession, and overdue derivation.');

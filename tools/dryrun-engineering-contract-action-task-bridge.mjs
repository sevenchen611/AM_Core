import assert from 'node:assert/strict';
import {
  ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION,
  deriveEngineeringContractActionTaskIntent,
} from '../modules/construction/contract-action-task-bridge.js';

const base = {
  tenantKey: 'engineering',
  projectId: 'project-demolition',
  projectGoal: { id: 'goal-demolition-closeout', title: '完成拆除工程合約的可追溯簽署與履約控制' },
  contract: { id: 'contract-demolition', number: 'DEM-2026-001', title: '拆除工程合約' },
  observedAt: '2026-09-03T08:30:00.000Z',
  controlState: {
    stage: 'awaiting_internal_confirmation',
    underlyingStage: 'awaiting_internal_confirmation',
    waitingOn: 'engineering_am',
    primaryNextAction: { code: 'confirm_signature_evidence', label: '核對簽署證據並由我方確認' },
    partyA: { status: 'signed' },
    partyB: { status: 'signed' },
    internal: { status: 'awaiting_confirmation' },
    archive: { status: 'not_ready' },
    health: { status: 'healthy' },
    timestamps: {
      partyASignedAt: '2026-09-03T08:00:00.000Z',
      partyBSignedAt: '2026-09-03T08:10:00.000Z',
      lastEventAt: '2026-09-03T08:10:00.000Z',
    },
  },
  sourceEvidence: [{
    tenantKey: 'engineering',
    sourceType: 'engineering_contract_event',
    sourceId: 'session-demolition:event-confirmed-ready',
    locator: 'engineering-contracts://contract-demolition/signing/session-demolition',
    occurredAt: '2026-09-03T08:10:00.000Z',
    summary: '甲、乙方簽署證據已收到，等待工程 AM 核對確認。',
  }],
};

const created = deriveEngineeringContractActionTaskIntent(base);
assert.equal(created.bridgeVersion, ENGINEERING_CONTRACT_ACTION_TASK_BRIDGE_VERSION);
assert.equal(created.operation, 'create_task_intent');
assert.equal(created.task.formalizationStatus, 'formal');
assert.equal(created.task.status, 'pending');
assert.equal(created.task.projectGoalId, 'goal-demolition-closeout');
assert.equal(created.task.sourceEvidence.length, 1);
assert.equal(created.transition.evidence.sourceRefs.length, 1);
assert.equal(created.delivery.writesPerformed, false);
assert.deepEqual(created.delivery.forbiddenSideEffects, ['notion_write', 'line_send', 'production_task_mutation']);

const duplicate = deriveEngineeringContractActionTaskIntent({
  ...base,
  existingTaskIntents: [{
    id: 'task-intent-1',
    semanticKey: created.semanticKey,
    stateFingerprint: created.stateFingerprint,
    status: 'pending',
    updatedAt: '2026-09-03T08:30:00.000Z',
  }],
});
assert.equal(duplicate.operation, 'deduplicated');
assert.equal(duplicate.existingTaskIntentId, 'task-intent-1');

const updated = deriveEngineeringContractActionTaskIntent({
  ...base,
  observedAt: '2026-09-03T08:40:00.000Z',
  controlState: {
    ...base.controlState,
    stage: 'awaiting_archive',
    underlyingStage: 'awaiting_archive',
    primaryNextAction: { code: 'archive_confirmed_contract', label: '完成已確認合約的歸檔與收據' },
    internal: { status: 'confirmed' },
    archive: { status: 'awaiting_archive' },
  },
  existingTaskIntents: [{
    id: 'task-intent-1',
    semanticKey: created.semanticKey,
    stateFingerprint: created.stateFingerprint,
    status: 'pending',
    updatedAt: '2026-09-03T08:30:00.000Z',
  }],
});
assert.equal(updated.operation, 'create_task_intent', 'A new action gets a distinct semantic key');
assert.notEqual(updated.semanticKey, created.semanticKey);
assert.equal(updated.task.actionCode, 'archive_confirmed_contract');

const missingGoal = deriveEngineeringContractActionTaskIntent({ ...base, projectGoal: null });
assert.equal(missingGoal.operation, 'create_task_intent');
assert.equal(missingGoal.task.formalizationStatus, 'candidate');
assert.equal(missingGoal.task.status, 'candidate');
assert(missingGoal.task.candidateReasons.some((item) => item.code === 'PROJECT_GOAL_REQUIRED'));

const missingEvidence = deriveEngineeringContractActionTaskIntent({ ...base, sourceEvidence: [] });
assert.equal(missingEvidence.task.formalizationStatus, 'candidate');
assert(missingEvidence.task.candidateReasons.some((item) => item.code === 'SOURCE_EVIDENCE_REQUIRED'));

const crossTenantEvidence = deriveEngineeringContractActionTaskIntent({
  ...base,
  sourceEvidence: [{ ...base.sourceEvidence[0], tenantKey: 'another-tenant' }],
});
assert.equal(crossTenantEvidence.task.formalizationStatus, 'candidate');
assert.equal(crossTenantEvidence.task.sourceEvidence.length, 0);
assert(crossTenantEvidence.task.candidateReasons.some((item) => item.code === 'CROSS_TENANT_EVIDENCE'));

const archived = deriveEngineeringContractActionTaskIntent({
  ...base,
  controlState: {
    ...base.controlState,
    stage: 'archived',
    underlyingStage: 'archived',
    primaryNextAction: { code: 'none', label: '流程已歸檔' },
  },
});
assert.equal(archived.operation, 'no_action');

console.log('Engineering contract action-task bridge dry run passed.');

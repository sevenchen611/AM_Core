import assert from 'node:assert/strict';
import { createEngineeringContractControlCenterService } from '../modules/construction/contract-control-center.js';

const tenant = { key: 'engineering-test' };
const rows = [
  { id: 'contract-1', contract_number: 'DEM-001', title: '拆除工程合約', project_notion_page_id: 'project-demolition', current_version_id: 'version-1', signing_external_session_id: 'session-1' },
  { id: 'contract-2', contract_number: 'NEW-002', title: '新建工程合約', project_notion_page_id: 'project-new', current_version_id: 'version-2', signing_external_session_id: 'session-2' },
  { id: 'contract-3', contract_number: 'ARC-003', title: '已歸檔工程合約', project_notion_page_id: 'project-demolition', current_version_id: 'version-3', signing_external_session_id: 'session-3', workflow_state: 'issued' },
];
const versions = {
  'version-1': { id: 'version-1', contract_snapshot: { documentPackage: { partyAProfileSnapshot: { profileType: 'individual' }, paymentMilestones: [{ name: '第一期' }], acceptanceCriteria: [{ criterion: '結構驗收' }] } } },
  'version-2': { id: 'version-2', contract_snapshot: { documentPackage: { partyAProfileSnapshot: { profileType: 'company', assets: { large_seal: { fileId: 'private-file' } } } } } },
  'version-3': { id: 'version-3', contract_snapshot: { documentPackage: { partyAProfileSnapshot: { profileType: 'individual' } } } },
};
const bundles = {
  'session-1': {
    session: { external_session_id: 'session-1', status: 'signed', party_a_signer_line_user_id: 'party-a-private', party_a_submission: { receivedAt: '2026-09-03T01:00:00.000Z' }, submission: { receivedAt: '2026-09-03T01:02:00.000Z' } },
    events: [{ event_type: 'party_a_signed', occurred_at: '2026-09-03T01:00:00.000Z' }, { event_type: 'signed', occurred_at: '2026-09-03T01:02:00.000Z', token_hash: 'must-not-leak' }],
    artifacts: [{ artifact_kind: 'signed_pdf', created_at: '2026-09-03T01:03:00.000Z' }],
  },
  'session-2': {
    session: { external_session_id: 'session-2', status: 'sent' },
    events: [{ event_type: 'sent', occurred_at: '2026-09-03T02:00:00.000Z' }],
  },
  'session-3': {
    contract: { id: 'contract-3' },
    version: { id: 'version-3' },
    session: {
      external_session_id: 'session-3', status: 'completed', partyASignerLineUserId: 'party-a-private',
      partyASubmission: { receivedAt: '2026-09-03T02:10:00.000Z' },
      submission: { receivedAt: '2026-09-03T02:12:00.000Z' },
      confirmedAt: '2026-09-03T02:14:00.000Z', completedAt: '2026-09-03T02:15:00.000Z',
    },
    events: [
      { event_type: 'party_a_signed', occurred_at: '2026-09-03T02:10:00.000Z' },
      { event_type: 'signed', occurred_at: '2026-09-03T02:12:00.000Z' },
      { event_type: 'confirmed', occurred_at: '2026-09-03T02:14:00.000Z' },
      { event_type: 'completed', occurred_at: '2026-09-03T02:15:00.000Z' },
    ],
    artifacts: [
      { artifact_kind: 'signed_pdf', created_at: '2026-09-03T02:15:01.000Z' },
      { artifact_kind: 'evidence_receipt', created_at: '2026-09-03T02:15:02.000Z' },
    ],
  },
};
const store = {
  async status() { return { configured: true, schemaReady: true, schemaVersion: '2026-09-02.engineering-contract-evidence.v9', archiveSchemaReady: true }; },
  async listContracts() { return rows; },
  // Deliberately emulate the bare production getContract query. Detail must
  // use listContracts so the signing session projection remains available.
  async getContract(_tenant, { contractId }) {
    const row = rows.find((item) => item.id === contractId);
    return row ? { id: row.id, project_notion_page_id: row.project_notion_page_id, workflow_state: row.workflow_state } : null;
  },
  async getVersion(_tenant, id) { return versions[id] || null; },
  async getSigningBundle(_tenant, id) { return bundles[id] || null; },
};
const service = createEngineeringContractControlCenterService({ store, clock: () => new Date('2026-09-03T03:00:00.000Z') });
const model = await service.list({ tenant, scope: new Set(['project-demolition', 'project-new']) });
assert.equal(model.contracts.length, 3);
const demolition = model.contracts.find((contract) => contract.contractId === 'contract-1');
assert.equal(demolition.workflowStatus, 'awaiting_internal_confirmation');
assert.equal(demolition.partyA.label, '甲方已簽署');
assert.equal(demolition.partyB.label, '乙方已簽署');
assert.ok(demolition.queueKeys.includes('pending_internal_confirmation'));
assert.equal(demolition.paymentStatus, '尚未建立付款執行紀錄');
const scoped = await service.list({ tenant, scope: new Set(['project-demolition']) });
assert.deepEqual(scoped.contracts.map((contract) => contract.contractId), ['contract-1', 'contract-3']);
const detail = await service.detail({ tenant, scope: new Set(['project-demolition']) }, 'contract-1');
assert.equal(detail.timeline.length, 3);
assert.equal(JSON.stringify(detail).includes('must-not-leak'), false);
const archived = await service.detail({ tenant, scope: new Set(['project-demolition']) }, 'contract-3');
const archivedSummary = model.contracts.find((contract) => contract.contractId === 'contract-3');
assert.equal(archived.contract.workflowStatus, 'archived');
assert.equal(archived.contract.overallStatus, '簽署與歸檔完成');
assert.equal(archived.contract.partyA.label, '甲方已簽署');
assert.equal(archived.contract.partyB.label, '乙方已簽署');
assert.equal(archived.contract.currentHolder, '無');
assert.equal(archived.contract.nextAction, '流程已歸檔');
assert.equal(archived.contract.dueAt, '');
assert.equal(archived.contract.blockers.length, 0);
assert.deepEqual(
  {
    workflowStatus: archived.contract.workflowStatus,
    partyA: archived.contract.partyA.label,
    partyB: archived.contract.partyB.label,
    nextAction: archived.contract.nextAction,
  },
  {
    workflowStatus: archivedSummary.workflowStatus,
    partyA: archivedSummary.partyA.label,
    partyB: archivedSummary.partyB.label,
    nextAction: archivedSummary.nextAction,
  },
  'summary and detail must use the same authoritative signing projection',
);
assert.equal(archived.timeline.length, 6);
assert.deepEqual(archived.timeline.slice(-2).map((event) => event.label), [
  '最終簽署合約 PDF 已封存', '簽署證據收據已封存',
]);
await assert.rejects(() => service.detail({ tenant, scope: new Set(['project-new']) }, 'contract-1'), { code: 'CONTRACT_NOT_FOUND' });
console.log('dryrun-engineering-contract-control-center: OK');

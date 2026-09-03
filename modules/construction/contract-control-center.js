// Engineering contract control-center read service.
//
// This module deliberately composes only PostgreSQL-backed contract evidence.
// It never reads Notion status as authority and it never invokes issuance,
// signing, confirmation, outbox, LINE, Drive, or task mutations.

import { deriveEngineeringContractControlState } from './contract-control-state.js';

const QUEUE_KEYS = Object.freeze({
  pendingSigning: 'pending_signing',
  pendingMyConfirmation: 'pending_internal_confirmation',
  paymentManagement: 'payment',
  acceptanceManagement: 'acceptance',
  dataAttention: 'data_health',
});

function text(value, max = 400) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, max);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function unwrap(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
    ? value.value : value;
}

function safeIso(value) {
  const source = text(value, 80);
  return source && Number.isFinite(Date.parse(source)) ? new Date(source).toISOString() : '';
}

function controlError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function scopeAllows(scope, contract) {
  if (!scope) return true;
  const projectRef = text(first(contract.projectNotionPageId, contract.project_notion_page_id, contract.projectCode, contract.project_code), 160);
  return scope.has(projectRef);
}

function stageLabel(stage) {
  return ({
    not_issued: '待簽發',
    awaiting_party_a_assignment: '待指定甲方簽署人',
    awaiting_party_a: '待甲方簽署',
    awaiting_party_b: '待乙方簽署',
    awaiting_internal_confirmation: '雙方已簽，待我方確認',
    awaiting_archive: '我方已確認，待歸檔',
    archived: '簽署與歸檔完成',
    revoked: '已撤銷',
    expired: '已逾期',
    declined: '已拒簽',
    party_a_requirement_unknown: '甲方簽署條件待核對',
    data_attention: '狀態不可判定',
  })[text(stage, 100)] || '狀態待核對';
}

function ownerLabel(value) {
  return ({
    engineering_am: '工程 AM',
    party_a: '甲方',
    party_b: '乙方',
    data_reconciliation: '資料管理者',
    none: '無',
  })[text(value, 100)] || '工程 AM';
}

function partyLabel(party, role) {
  const status = text(party?.status, 100);
  const labels = role === 'partyA' ? {
    frozen_company_seal: '公司章已隨版本凍結',
    signed: '甲方已簽署',
    pending_signature: '待甲方簽署',
    signer_assignment_required: '待指定甲方簽署人',
    not_issued: '尚未簽發',
    revoked: '已撤銷',
    expired: '已逾期',
    declined: '已拒簽',
    unknown: '甲方簽署條件待核對',
  } : {
    signed: '乙方已簽署',
    opened: '乙方已開啟，待簽署',
    pending_signature: '待乙方簽署',
    not_issued: '尚未簽發',
    revoked: '已撤銷',
    expired: '已逾期',
    declined: '已拒簽',
  };
  return labels[status] || (role === 'partyA' ? '甲方狀態待核對' : '乙方狀態待核對');
}

function partyPresentation(party, role, state) {
  const timestamps = state.timestamps || {};
  const signedAt = role === 'partyA' ? timestamps.partyASignedAt : timestamps.partyBSignedAt;
  const holder = state.waitingOn === (role === 'partyA' ? 'party_a' : 'party_b')
    ? ownerLabel(state.waitingOn) : '';
  const detail = text(party?.source, 180) === 'party_a_profile_snapshot.large_seal'
    ? '公司甲方不需線上簽署；用印證據已隨凍結版本保存。'
    : '';
  return {
    label: partyLabel(party, role),
    status: text(party?.status, 100),
    sentAt: timestamps.sentAt || '',
    receivedAt: timestamps.receivedAt || '',
    signedAt: signedAt || '',
    holder,
    detail,
  };
}

function paymentSummary(version) {
  const snapshot = object(first(version.contractSnapshot, version.contract_snapshot, version.snapshot));
  const packageValue = object(first(snapshot.documentPackage, version.documentPackage));
  const milestones = arrayOf(first(packageValue.paymentMilestones, packageValue.payment_milestones));
  return {
    label: milestones.length ? '尚未建立付款執行紀錄' : '未設定付款條件',
    requiresAttention: false,
    count: milestones.length,
  };
}

function acceptanceSummary(version) {
  const snapshot = object(first(version.contractSnapshot, version.contract_snapshot, version.snapshot));
  const packageValue = object(first(snapshot.documentPackage, version.documentPackage));
  const criteria = arrayOf(first(packageValue.acceptanceCriteria, packageValue.acceptance_criteria));
  return {
    label: criteria.length ? '尚未建立驗收執行紀錄' : '未設定驗收標準',
    requiresAttention: false,
    count: criteria.length,
  };
}

function timelineLabel(type) {
  return ({
    issued: '正式簽發',
    sent: 'LINE 已接受發送',
    opened: '簽署頁已開啟',
    party_a_opened: '甲方簽署頁已開啟',
    party_a_signed: '甲方已簽署',
    signed: '乙方已簽署',
    confirmed: '我方已確認',
    completed: '最終歸檔完成',
    revoked: '簽署已撤銷',
    expired: '簽署已逾期',
    declined: '簽署已拒絕',
  })[type] || '合約事件';
}

function safeTimeline(bundle) {
  const events = arrayOf(bundle?.events).map((event) => {
    const source = object(event);
    const type = text(first(source.type, source.eventType, source.event_type), 100);
    return {
      type,
      label: timelineLabel(type),
      occurredAt: safeIso(first(source.at, source.occurredAt, source.occurred_at, source.recordedAt, source.recorded_at)),
      actor: text(first(source.actorKind, source.actor_kind), 80),
      summary: '',
    };
  }).filter((event) => event.occurredAt);
  const artifacts = arrayOf(bundle?.artifacts).map((artifact) => ({
    type: 'artifact_registered',
    label: '證據檔已保存',
    occurredAt: safeIso(artifact?.created_at || artifact?.createdAt),
    actor: 'system',
    summary: text(artifact?.artifact_kind || artifact?.artifactKind, 100),
  })).filter((event) => event.occurredAt);
  return [...events, ...artifacts].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

function queueKeys(state, payment, acceptance) {
  const membership = object(state.queueMembership);
  const keys = [];
  if (membership.pendingSigning) keys.push(QUEUE_KEYS.pendingSigning);
  if (membership.pendingMyConfirmation) keys.push(QUEUE_KEYS.pendingMyConfirmation);
  if (membership.paymentManagement || payment.requiresAttention) keys.push(QUEUE_KEYS.paymentManagement);
  if (membership.acceptanceManagement || acceptance.requiresAttention) keys.push(QUEUE_KEYS.acceptanceManagement);
  if (membership.dataAttention) keys.push(QUEUE_KEYS.dataAttention);
  return keys;
}

function dataHealth(state, additionalIssues = []) {
  const issues = [...arrayOf(state.health?.issues), ...additionalIssues];
  const status = issues.some((item) => item.severity === 'blocking') ? 'blocked'
    : (issues.length ? 'attention' : text(state.health?.status, 80) || 'healthy');
  return {
    status,
    label: status === 'healthy' ? '健康' : (status === 'attention' ? '待核對' : '不可判定'),
    issues,
  };
}

function contractPresentation(raw, version, bundle, state, additionalIssues = []) {
  const payment = paymentSummary(version || {});
  const acceptance = acceptanceSummary(version || {});
  const health = dataHealth(state, additionalIssues);
  const stage = health.status === 'blocked' ? 'data_attention' : state.stage;
  const presentation = {
    id: text(first(raw.id, state.contractId), 160),
    contractId: text(first(raw.id, state.contractId), 160),
    contractNumber: text(first(raw.contract_number, raw.contractNumber), 160),
    title: text(first(raw.title, raw.contract_title, raw.name), 300),
    projectName: text(first(raw.project_code, raw.projectCode), 160),
    overallStatus: stageLabel(stage),
    workflowStatus: stage,
    partyA: partyPresentation(state.partyA, 'partyA', state),
    partyB: partyPresentation(state.partyB, 'partyB', state),
    currentHolder: ownerLabel(state.waitingOn),
    nextAction: health.status === 'blocked'
      ? '先修復權威資料或 schema，再處理合約流程'
      : text(state.primaryNextAction?.label, 300),
    nextActionOwner: ownerLabel(health.status === 'blocked' ? 'data_reconciliation' : state.primaryNextAction?.owner),
    dueAt: safeIso(bundle?.session?.expiresAt || bundle?.session?.expires_at),
    paymentStatus: payment.label,
    acceptanceStatus: acceptance.label,
    dataHealth: health.label,
    health: { status: health.status, label: health.label },
    lastEventAt: state.timestamps?.lastEventAt || '',
    queueKeys: queueKeys(state, payment, acceptance),
    blockers: health.issues.map((item) => text(item.message || item.label, 400)).filter(Boolean),
  };
  return Object.freeze(presentation);
}

async function loadVersion(store, tenant, raw) {
  const versionId = text(first(raw.current_version_id, raw.currentVersionId), 160);
  if (versionId && typeof store.getVersion === 'function') return unwrap(await store.getVersion(tenant, versionId));
  if (typeof store.listVersions !== 'function') return null;
  const versions = arrayOf(unwrap(await store.listVersions(tenant, raw.id)));
  return versions.sort((left, right) => Number(right.version_no || right.versionNo || 0) - Number(left.version_no || left.versionNo || 0))[0] || null;
}

async function buildRecord(store, tenant, raw, runtime) {
  let version = null;
  let bundle = null;
  const issues = [];
  try {
    version = await loadVersion(store, tenant, raw);
  } catch {
    issues.push({ code: 'version_load_failed', severity: 'blocking', message: '無法讀取權威合約版本；請由資料管理者核對。' });
  }
  const sessionId = text(first(raw.signing_external_session_id, raw.signingExternalSessionId), 160);
  if (sessionId && typeof store.getSigningBundle === 'function') {
    try {
      bundle = unwrap(await store.getSigningBundle(tenant, sessionId));
    } catch {
      issues.push({ code: 'signing_bundle_load_failed', severity: 'blocking', message: '無法讀取權威簽署證據；不可用摘要狀態代替。' });
    }
  }
  const state = deriveEngineeringContractControlState({
    contract: raw,
    version: version || {},
    signingBundle: bundle || {},
    runtime,
  });
  return {
    presentation: contractPresentation(raw, version || {}, bundle || {}, state, issues),
    state,
    version,
    bundle,
  };
}

function runtimeFromStatus(status) {
  return {
    configured: status?.configured === true,
    databaseConfigured: status?.configured === true,
    schemaReady: status?.schemaReady === true,
    schemaVersion: text(status?.schemaVersion, 160),
  };
}

async function readyStore(store, tenant) {
  if (!store || typeof store.status !== 'function' || typeof store.listContracts !== 'function') {
    throw controlError('CONTRACT_CONTROL_STORE_UNAVAILABLE', '工程合約權威資料庫未就緒，無法顯示控制狀態。');
  }
  const status = unwrap(await store.status(tenant));
  if (status?.configured !== true) {
    throw controlError('CONTRACT_CONTROL_DATABASE_NOT_CONFIGURED', '工程合約資料庫尚未設定，不能以 Notion 狀態代替。');
  }
  if (status?.schemaReady !== true) {
    throw controlError('CONTRACT_CONTROL_SCHEMA_NOT_READY', '工程合約資料庫 schema 尚未就緒，不能以快取或 Notion 狀態代替。');
  }
  return { status, runtime: runtimeFromStatus(status) };
}

export function createEngineeringContractControlCenterService({ store, clock = () => new Date() } = {}) {
  async function list(context = {}) {
    const tenant = context.tenant;
    if (!tenant?.key) throw controlError('CONTRACT_TENANT_REQUIRED', '缺少工程租戶內容。', 403);
    const { status, runtime } = await readyStore(store, tenant);
    const rows = arrayOf(unwrap(await store.listContracts(tenant, null))).filter((row) => scopeAllows(context.scope, row));
    const loaded = await Promise.all(rows.map((row) => buildRecord(store, tenant, row, runtime)));
    const contracts = loaded.map((item) => item.presentation);
    const queueCounts = Object.fromEntries(Object.values(QUEUE_KEYS).map((key) => [
      key,
      contracts.filter((contract) => contract.queueKeys.includes(key)).length,
    ]));
    return Object.freeze({
      readModelVersion: 'engineering-contract-control-read-model.v1',
      generatedAt: clock().toISOString(),
      runtime: {
        schemaVersion: text(status.schemaVersion, 160),
        archiveSchemaReady: status.archiveSchemaReady === true,
      },
      queueCounts,
      contracts,
    });
  }

  async function detail(context = {}, contractId) {
    const tenant = context.tenant;
    if (!tenant?.key) throw controlError('CONTRACT_TENANT_REQUIRED', '缺少工程租戶內容。', 403);
    const { runtime } = await readyStore(store, tenant);
    if (typeof store.getContract !== 'function') throw controlError('CONTRACT_CONTROL_STORE_UNAVAILABLE', '工程合約資料庫查詢介面不完整。');
    const raw = unwrap(await store.getContract(tenant, { contractId: text(contractId, 160) }));
    if (!raw || !scopeAllows(context.scope, raw)) throw controlError('CONTRACT_NOT_FOUND', '找不到此範圍內的工程合約。', 404);
    const loaded = await buildRecord(store, tenant, raw, runtime);
    return Object.freeze({
      readModelVersion: 'engineering-contract-control-read-model.v1',
      generatedAt: clock().toISOString(),
      contract: loaded.presentation,
      timeline: safeTimeline(loaded.bundle),
    });
  }

  return Object.freeze({ list, detail });
}

export const __test = Object.freeze({
  QUEUE_KEYS,
  scopeAllows,
  stageLabel,
  ownerLabel,
  partyLabel,
  paymentSummary,
  acceptanceSummary,
  safeTimeline,
  contractPresentation,
  runtimeFromStatus,
});

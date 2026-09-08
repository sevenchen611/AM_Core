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

function eventType(event) {
  return text(first(event?.type, event?.eventType, event?.event_type), 100);
}

function eventTime(event) {
  return safeIso(first(event?.at, event?.occurredAt, event?.occurred_at, event?.recordedAt, event?.recorded_at));
}

function eventIp(event) {
  return text(first(event?.ip, event?.ipAddress, event?.ip_address), 80);
}

function firstEvent(bundle, types) {
  const wanted = new Set(types);
  return arrayOf(bundle?.events)
    .filter((event) => wanted.has(eventType(event)))
    .sort((left, right) => Date.parse(eventTime(left) || 0) - Date.parse(eventTime(right) || 0))[0] || null;
}

function partyPresentation(party, role, state, bundle, includeSensitiveEvidence = false) {
  const timestamps = state.timestamps || {};
  const isPartyA = role === 'partyA';
  const openEvent = firstEvent(bundle, isPartyA
    ? ['party_a_first_opened', 'party_a_opened'] : ['first_opened', 'opened']);
  const signedEvent = firstEvent(bundle, isPartyA
    ? ['party_a_signed', 'party_a_submission_received'] : ['signed', 'submission_received']);
  const dispatchEvent = firstEvent(bundle, ['sent', 'issued']);
  const signedAt = isPartyA ? timestamps.partyASignedAt : timestamps.partyBSignedAt;
  const holder = state.waitingOn === (role === 'partyA' ? 'party_a' : 'party_b')
    ? ownerLabel(state.waitingOn) : '';
  const companySeal = text(party?.source, 180) === 'party_a_profile_snapshot.large_seal';
  const detail = companySeal
    ? '公司甲方不需線上簽署；用印證據已隨凍結版本保存。'
    : '';
  return {
    label: partyLabel(party, role),
    status: text(party?.status, 100),
    sentAt: timestamps.sentAt || '',
    receivedAt: eventTime(openEvent) || (isPartyA ? '' : timestamps.receivedAt || ''),
    signedAt: signedAt || '',
    holder,
    detail,
    ...(includeSensitiveEvidence ? {
      dispatchIp: eventIp(dispatchEvent),
      openedIp: companySeal ? '' : eventIp(openEvent),
      signedIp: companySeal ? '' : eventIp(signedEvent),
      ipEvidenceNote: companySeal
      ? '公司甲方採凍結版本用印，不適用線上開啟與簽署 IP。'
      : 'IP 取自 PostgreSQL 不可變簽署事件；「首次開啟」代表收件／閱覽證據，「簽署提交」代表送出簽名資料的來源。',
    } : {}),
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

function timelineLabel(type, bundle) {
  const versionNo = Number(first(bundle?.version?.versionNo, bundle?.version?.version_no));
  const version = Number.isSafeInteger(versionNo) && versionNo > 0 ? ` V${versionNo}` : '';
  return ({
    issued: `正式簽發合約${version}`,
    sent: '簽署邀請已送至合約 LINE 群組',
    delivery_ack: 'LINE 服務商已回覆發送受理結果',
    first_opened: '乙方已完成身分驗證並首次開啟合約',
    opened: '乙方已開啟合約簽署頁',
    party_a_first_opened: '甲方已完成身分驗證並首次開啟合約',
    party_a_opened: '甲方已開啟合約簽署頁',
    party_a_signer_assigned: '已指定本次合約的甲方簽署人',
    party_a_signed: '甲方已完成本次合約線上簽署',
    party_a_submission_received: '系統已接收甲方簽署資料',
    signed: '乙方已完成本次合約線上簽署',
    submission_received: '系統已接收乙方簽署資料',
    confirmed: '工程 AM 已確認甲乙雙方簽署資料',
    completed: '最終簽署合約與證據已完成歸檔',
    revoked: '本次合約簽署連結已撤銷',
    expired: '本次合約簽署連結已逾期',
    declined: '簽署人已拒絕本次合約',
    version_created: '已建立新的合約版本',
    version_reviewed: '合約版本已完成內部審查',
    version_issued: `合約${version}已核定送簽`,
    line_send_requested: '系統已提出 LINE 送簽要求',
    line_send_accepted: 'LINE 服務已接受送簽要求',
    line_send_failed: 'LINE 送簽要求未成功',
    link_opened: '簽署連結已被開啟',
    liff_verified: 'LINE LIFF 身分驗證已通過',
    group_membership_verified: '工程 LINE 群組成員資格已通過',
    identity_verified: '簽署人身分資料已驗證',
    identity_rejected: '簽署人身分資料未通過驗證',
    signature_submitted: '簽署人已送出簽名資料',
    signature_rejected: '簽名資料未通過驗證',
    signed_pdf_stored: '最終簽署合約 PDF 已寫入私有檔案庫',
    evidence_receipt_stored: '簽署證據收據已寫入私有檔案庫',
    contract_signed: '合約已確認完成雙方簽署',
    signer_declined: '簽署人已拒絕簽署',
    session_expired: '簽署流程已逾期關閉',
    session_revoked: '簽署流程已撤銷關閉',
    contract_voided: '本合約版本已作廢',
    notion_projection_succeeded: '合約摘要已同步至 Notion',
    notion_projection_failed: '合約摘要同步至 Notion 失敗',
    administrative_correction: '管理者已登錄行政更正',
  })[type] || '其他簽署流程紀錄';
}

function timelineSummary(type, source, bundle) {
  const versionNo = Number(first(bundle?.version?.versionNo, bundle?.version?.version_no));
  const version = Number.isSafeInteger(versionNo) && versionNo > 0 ? `第 V${versionNo} 版` : '本次凍結版本';
  const descriptions = {
    issued: `工程 AM 已將${version}正式簽發為線上簽署文件；文件內容與 SHA-256 雜湊已固定，後續簽名均對應此版本。`,
    sent: '系統已將受保護的合約簽署連結送至此合約綁定的 LINE 群組。此紀錄代表 LINE 服務接受發送，不等同甲方或乙方已讀。',
    delivery_ack: 'LINE 服務商已回覆可驗證的發送受理回執；此回執證明服務商受理，不代表簽署人已開啟內容。',
    first_opened: '乙方指定簽署人已通過 LIFF 身分與工程群組成員驗證，並首次開啟本次凍結合約；此時間與 IP 作為乙方收件／閱覽證據。',
    opened: '乙方已開啟本次合約的線上簽署頁面。',
    party_a_first_opened: '甲方指定簽署人已通過 LIFF 身分與工程群組成員驗證，並首次開啟本次凍結合約；此時間與 IP 作為甲方收件／閱覽證據。',
    party_a_opened: '甲方已開啟本次合約的線上簽署頁面。',
    party_a_signer_assigned: '工程 AM 已把本次線上簽署責任綁定至指定的甲方 LINE 帳號；甲乙雙方不可使用同一簽署帳號。',
    party_a_signed: '甲方已確認閱讀本次凍結合約並送出手寫簽名；簽名雜湊、送出時間、來源 IP 與裝置資訊已寫入不可變事件鏈。',
    party_a_submission_received: '工程 AM 伺服器已完整接收甲方簽名資料並保存提交參照、文件雜湊、簽名雜湊與同次請求的來源 IP。',
    signed: '乙方已確認閱讀本次凍結合約並送出簽名與身分資料；簽名雜湊、送出時間、來源 IP 與裝置資訊已寫入不可變事件鏈。',
    submission_received: '工程 AM 伺服器已完整接收乙方簽名與身分資料，並保存文件雜湊、簽名雜湊、提交參照與同次請求的來源 IP。',
    confirmed: '工程 AM 操作人員已核對甲乙雙方簽署資料、文件版本與必要證據，並核准進入最終文件產製與歸檔。',
    completed: '系統已完成最終簽署合約 PDF 與簽署證據收據的產製、雜湊核對及私有歸檔，本次簽署流程已關閉。',
    revoked: '工程 AM 已終止本次簽署連結；原連結不能再用於開啟或送出簽名。',
    expired: '本次簽署連結已超過有效期限，不能再用於開啟或送出簽名。',
    declined: '指定簽署人已拒絕本次合約，系統保留拒簽時間與相關稽核證據。',
    version_created: '系統已建立新的合約版本；舊版本仍保留，不會被覆寫。',
    version_reviewed: '工程 AM 已完成此版本的內部內容與附件審查，尚未因此代表對外簽發。',
    version_issued: `工程 AM 已核定${version}作為本次送簽文件；後續簽署證據必須對應相同版本與文件雜湊。`,
    line_send_requested: '工程 AM 系統已建立 LINE 送簽工作並排入可靠傳送佇列，等待 LINE 服務受理。',
    line_send_accepted: 'LINE 服務已接受送簽請求；此紀錄只證明平台受理，不代表甲方或乙方已讀。',
    line_send_failed: 'LINE 服務未成功接受送簽請求；系統保留錯誤與重試狀態，不能將此筆視為已送達。',
    link_opened: '受保護的簽署連結已被開啟；仍須完成 LIFF 身分及工程群組成員驗證，才能形成有效收件證據。',
    liff_verified: '簽署頁已透過 LINE LIFF 驗證目前使用者身分，並保存驗證結果供後續簽署核對。',
    group_membership_verified: '系統已向 LINE 核對目前使用者仍屬於本合約綁定的工程群組。',
    identity_verified: '系統已核對本次提交的簽署人身分資料與指定簽署人條件。',
    identity_rejected: '本次簽署人身分或指定簽署條件未通過，系統未接受其作為有效簽署證據。',
    signature_submitted: '簽署人已送出手寫簽名及確認資訊；系統將以文件與簽名雜湊驗證資料完整性。',
    signature_rejected: '送出的簽名資料未通過格式、版本、身分或完整性驗證，因此未被認定為有效簽署。',
    signed_pdf_stored: '已把套用有效簽名的最終合約 PDF 寫入工程合約私有檔案庫，並登錄檔案雜湊與大小。',
    evidence_receipt_stored: '已把包含完整事件時間、雙方身分驗證、來源 IP 與各項雜湊的 JSON 證據收據寫入私有檔案庫。',
    contract_signed: '系統已確認甲乙雙方必要簽署均完成，且所有簽名均對應同一份凍結合約。',
    signer_declined: '指定簽署人明確拒絕簽署本次合約；拒簽結果及時間已進入稽核紀錄。',
    session_expired: '簽署流程因超過有效期限而關閉，原連結不再接受任何簽名提交。',
    session_revoked: '工程 AM 已撤銷本次簽署流程，原連結與尚未完成的提交均不得繼續使用。',
    contract_voided: '工程 AM 已將此合約版本標記作廢；作廢不刪除原有事件與證據。',
    notion_projection_succeeded: 'PostgreSQL 權威狀態已成功同步至 Notion 合約摘要頁，供一般瀏覽使用。',
    notion_projection_failed: 'PostgreSQL 權威狀態尚未成功同步至 Notion；控制中心仍以 PostgreSQL 為準並保留待重試紀錄。',
    administrative_correction: '具權限的管理者已新增行政更正說明；不可變的原始簽署事件仍完整保留。',
  };
  return descriptions[type] || `系統保留了一筆「${type || '未分類'}」簽署流程紀錄，供管理者核對完整事件鏈。`;
}

function actorLabel(type, source) {
  const actor = text(first(source.actorKind, source.actor_kind), 80);
  if (actor === 'provider') return 'LINE 服務商';
  if (actor === 'admin') return '工程 AM 操作人員';
  if (actor === 'system') return '工程 AM 系統';
  if (actor === 'signer') return type.startsWith('party_a_') ? '甲方簽署人' : '乙方簽署人';
  return actor || '系統紀錄';
}

function safeTimeline(bundle) {
  const events = arrayOf(bundle?.events).map((event) => {
    const source = object(event);
    const type = text(first(source.type, source.eventType, source.event_type), 100);
    return {
      type,
      label: timelineLabel(type, bundle),
      occurredAt: safeIso(first(source.at, source.occurredAt, source.occurred_at, source.recordedAt, source.recorded_at)),
      actor: actorLabel(type, source),
      summary: timelineSummary(type, source, bundle),
      ipAddress: eventIp(source),
    };
  }).filter((event) => event.occurredAt);
  const artifacts = arrayOf(bundle?.artifacts).map((artifact) => {
    const kind = text(artifact?.artifact_kind || artifact?.artifactKind, 100);
    const labels = {
      issued_pdf: '正式送簽合約 PDF 已保存',
      signed_pdf: '甲乙雙方完成簽署的最終合約 PDF 已保存',
      evidence_receipt: '完整簽署證據收據 JSON 已保存',
      party_a_signature_image: '甲方手寫簽名圖檔已保存',
    };
    const summaries = {
      issued_pdf: '保存的是工程 AM 正式簽發、供甲乙雙方線上閱讀與簽署的凍結合約 PDF；文件 SHA-256 已登錄，所有簽名必須對應此份內容。',
      signed_pdf: '保存的是已套用甲乙雙方簽名的最終合約 PDF；系統同時登錄檔案 SHA-256 與檔案大小，供日後驗證內容未被修改。',
      evidence_receipt: '保存的是本次簽署的 JSON 證據收據，包含合約版本、事件時間、甲乙雙方驗證與簽署證據、來源 IP，以及文件與簽名雜湊。',
      party_a_signature_image: '保存的是甲方本次線上簽署送出的手寫簽名圖檔；檔案雜湊已登錄並會在產製最終 PDF 前重新核對。',
    };
    return {
      type: 'artifact_registered',
      label: labels[kind] || '證據檔已保存',
      occurredAt: safeIso(artifact?.created_at || artifact?.createdAt),
      actor: '工程 AM 系統',
      summary: summaries[kind] || `系統已保存 ${kind || '未分類'} 證據檔，並登錄檔案完整性資料。`,
      ipAddress: '',
    };
  }).filter((event) => event.occurredAt);
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

function contractPresentation(raw, version, bundle, state, additionalIssues = [], includeSensitiveEvidence = false) {
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
    partyA: partyPresentation(state.partyA, 'partyA', state, bundle, includeSensitiveEvidence),
    partyB: partyPresentation(state.partyB, 'partyB', state, bundle, includeSensitiveEvidence),
    currentHolder: ownerLabel(state.waitingOn),
    nextAction: health.status === 'blocked'
      ? '先修復權威資料或 schema，再處理合約流程'
      : text(state.primaryNextAction?.label, 300),
    nextActionOwner: ownerLabel(health.status === 'blocked' ? 'data_reconciliation' : state.primaryNextAction?.owner),
    dueAt: state.archive?.status === 'archived'
      ? '' : safeIso(bundle?.session?.expiresAt || bundle?.session?.expires_at),
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

async function buildRecord(store, tenant, raw, runtime, options = {}) {
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
  const sessionStatus = text(first(bundle?.session?.status, bundle?.signingStatus), 80).toLowerCase();
  if (sessionStatus === 'completed') {
    const artifactKinds = new Set(arrayOf(bundle?.artifacts)
      .map((item) => text(first(item?.artifact_kind, item?.artifactKind), 80)));
    if (!artifactKinds.has('signed_pdf') || !artifactKinds.has('evidence_receipt')) {
      issues.push({
        code: 'final_artifacts_missing', severity: 'attention',
        message: '簽署 session 已完成，但最終合約 PDF 或簽署證據收據不完整；請由資料管理者核對。',
      });
    }
  }
  const state = deriveEngineeringContractControlState({
    contract: raw,
    version: version || {},
    signingBundle: bundle || {},
    runtime,
  });
  return {
    presentation: contractPresentation(
      raw, version || {}, bundle || {}, state, issues, options.includeSensitiveEvidence === true,
    ),
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
    // Detail must use the same enriched PostgreSQL projection as the summary.
    // A bare contracts-table row does not include the latest signing session
    // and previously made an archived contract look unsigned when opened.
    const rows = arrayOf(unwrap(await store.listContracts(tenant, null)));
    const raw = rows.find((row) => text(row?.id, 160) === text(contractId, 160));
    if (!raw || !scopeAllows(context.scope, raw)) throw controlError('CONTRACT_NOT_FOUND', '找不到此範圍內的工程合約。', 404);
    const loaded = await buildRecord(store, tenant, raw, runtime, { includeSensitiveEvidence: true });
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

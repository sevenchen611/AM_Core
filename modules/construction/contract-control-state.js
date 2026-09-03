// Engineering contract control state — a pure, read-only reducer.
//
// This module is deliberately independent from storage, HTTP, Notion and UI.
// Its input is the authoritative signing bundle returned by contract-store plus
// the contract/version summary already loaded by the caller.  In particular,
// callers must not infer a Party A signature from the aggregate `signed` state:
// a Party B submission can set that aggregate before an individual Party A has
// signed.

export const ENGINEERING_CONTRACT_CONTROL_STATE_VERSION = '2026-09-03.control-state.v1';

const SESSION_TERMINAL = new Set(['completed', 'revoked', 'expired', 'declined']);
const SESSION_ACTIVE = new Set(['issued', 'sent', 'opened', 'signed', 'confirmed', 'completed', 'revoked', 'expired', 'declined']);

function text(value, max = 300) {
  return String(value || '').normalize('NFKC').trim().slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function iso(value) {
  const normalized = text(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : '';
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function latestEvent(events, types) {
  const wanted = new Set(types);
  const matches = list(events)
    .filter((event) => wanted.has(text(first(event?.type, event?.eventType, event?.event_type), 80)))
    .map((event) => ({ event, at: iso(first(event?.at, event?.occurredAt, event?.occurred_at)) }))
    .filter((item) => item.at)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  return matches[0] || null;
}

function partyAContext(version) {
  const source = object(version);
  const snapshot = object(first(
    source.contractSnapshot,
    source.contract_snapshot,
    source.snapshot,
    source.documentPackage,
  ));
  const documentPackage = object(first(snapshot.documentPackage, source.documentPackage));
  const fields = object(first(documentPackage.contractFields, snapshot.contractFields, source.contractFields));
  const profile = object(first(documentPackage.partyAProfileSnapshot, fields.partyAProfileSnapshot, source.partyAProfileSnapshot));
  const profileType = text(first(profile.profileType, fields.partyAProfileType, source.partyAProfileType), 30).toLowerCase();
  return {
    profileType: ['company', 'individual'].includes(profileType) ? profileType : '',
    profileId: text(first(profile.profileId, fields.partyAProfileId, source.partyAProfileId), 100),
    displayName: text(first(profile.displayName, fields.partyAOrganization, source.partyAOrganization), 240),
    assets: object(profile.assets),
  };
}

function normalSession(input) {
  const bundle = object(first(input.signingBundle, input.bundle));
  const source = object(first(input.session, bundle.session));
  const sourceEvents = list(first(source.events, bundle.events)).map((event) => ({
    ...object(event),
    type: text(first(event?.type, event?.eventType, event?.event_type), 80),
    at: first(event?.at, event?.occurredAt, event?.occurred_at),
  }));
  return {
    ...source,
    status: text(first(source.status, bundle.signingStatus), 80).toLowerCase(),
    events: sourceEvents,
    partyASubmission: object(source.partyASubmission),
    submission: object(source.submission),
    externalSessionId: text(first(source.externalSessionId, source.id, bundle.externalSessionId), 160),
    issuedAt: iso(first(source.issuedAt, bundle.issuedAt)),
    sentAt: iso(first(source.sentAt, bundle.sentAt)),
    receivedAt: iso(first(source.receivedAt, bundle.receivedAt)),
    signedAt: iso(first(source.signedAt, bundle.signedAt)),
    confirmedAt: iso(first(source.confirmedAt, bundle.confirmedAt)),
    completedAt: iso(first(source.completedAt, bundle.completedAt)),
    expiresAt: iso(first(source.expiresAt, bundle.expiresAt)),
  };
}

function partyBState(session) {
  const signedEvent = latestEvent(session.events, ['signed', 'submission_received']);
  const signedAt = iso(first(session.submission?.receivedAt, session.signedAt, signedEvent?.at));
  const signed = Boolean(session.submission && Object.keys(session.submission).length)
    || Boolean(signedEvent)
    || ['signed', 'confirmed', 'completed'].includes(session.status);
  if (!session.status) return { requirement: 'online_signature_required', status: 'not_issued', signedAt: '', source: 'missing_session' };
  if (signed) return { requirement: 'online_signature_required', status: 'signed', signedAt, source: 'party_b_submission' };
  if (SESSION_TERMINAL.has(session.status)) return { requirement: 'online_signature_required', status: session.status, signedAt: '', source: 'session_status' };
  return {
    requirement: 'online_signature_required',
    status: session.status === 'opened' ? 'opened' : 'pending_signature',
    signedAt: '',
    source: 'session_status',
  };
}

function partyAState(context, session) {
  const signedEvent = latestEvent(session.events, ['party_a_signed', 'party_a_submission_received']);
  const signedAt = iso(first(session.partyASubmission?.receivedAt, signedEvent?.at));
  if (context.profileType === 'company') {
    const hasSeal = Boolean(object(context.assets).large_seal);
    return {
      requirement: 'frozen_company_seal',
      status: 'frozen_company_seal',
      signedAt: '',
      source: hasSeal ? 'party_a_profile_snapshot.large_seal' : 'party_a_profile_snapshot',
      hasFrozenSeal: hasSeal,
    };
  }
  const signerLineUserId = text(session.partyASignerLineUserId, 180);
  const explicitIndividual = context.profileType === 'individual' || Boolean(signerLineUserId);
  if (!explicitIndividual) {
    return { requirement: 'unknown', status: 'unknown', signedAt: '', source: 'party_a_profile_missing', signerLineUserId: '' };
  }
  if (session.partyASubmission && Object.keys(session.partyASubmission).length || signedEvent) {
    return { requirement: 'online_signature_required', status: 'signed', signedAt, source: 'party_a_submission', signerLineUserId };
  }
  if (!session.status) {
    return { requirement: 'online_signature_required', status: 'not_issued', signedAt: '', source: 'missing_session', signerLineUserId };
  }
  if (!signerLineUserId) {
    return { requirement: 'online_signature_required', status: 'signer_assignment_required', signedAt: '', source: 'missing_party_a_signer', signerLineUserId: '' };
  }
  if (SESSION_TERMINAL.has(session.status)) {
    return { requirement: 'online_signature_required', status: session.status, signedAt: '', source: 'session_status', signerLineUserId };
  }
  return { requirement: 'online_signature_required', status: 'pending_signature', signedAt: '', source: 'session_status', signerLineUserId };
}

function internalState(session, partyA, partyB) {
  const confirmed = ['confirmed', 'completed'].includes(session.status) || Boolean(session.confirmedAt)
    || Boolean(latestEvent(session.events, ['confirmed']));
  if (confirmed) return { status: 'confirmed', confirmedAt: iso(first(session.confirmedAt, latestEvent(session.events, ['confirmed'])?.at)) };
  if (partyB.status === 'signed' && ['signed', 'frozen_company_seal'].includes(partyA.status)) {
    return { status: 'awaiting_confirmation', confirmedAt: '' };
  }
  return { status: 'not_ready', confirmedAt: '' };
}

function archiveState(session, internal) {
  const archived = session.status === 'completed' || Boolean(session.completedAt) || Boolean(latestEvent(session.events, ['completed']));
  if (archived) return { status: 'archived', completedAt: iso(first(session.completedAt, latestEvent(session.events, ['completed'])?.at)) };
  if (internal.status === 'confirmed') return { status: 'awaiting_archive', completedAt: '' };
  return { status: 'not_ready', completedAt: '' };
}

function issue(code, severity, message, details = {}) {
  return { code, severity, message, details };
}

function healthState(input, contract, version, session, partyA, partyB) {
  const runtime = object(first(input.runtime, input.storeStatus, input.dataHealth));
  const issues = [];
  if (runtime.schemaReady === false) {
    issues.push(issue('schema_not_ready', 'blocking', '合約資料庫 schema 尚未就緒；不可把控制頁的快取／Notion 狀態當成簽署依據。', {
      schemaVersion: text(first(runtime.schemaVersion, runtime.version), 120),
    }));
  }
  if (runtime.databaseConfigured === false || runtime.configured === false) {
    issues.push(issue('contract_database_unavailable', 'blocking', '合約資料庫未設定或不可用，無法讀取權威簽署證據。'));
  }
  const workflowState = text(first(contract.workflowState, contract.workflow_state, contract.signingStatus, contract.signing_status), 80).toLowerCase();
  if (!session.status && ['issued', 'sent', 'opened', 'signed', 'completed'].includes(workflowState)) {
    issues.push(issue('signing_session_missing', 'attention', '合約摘要顯示已進入簽署流程，但找不到可供核對的簽署 session。', { workflowState }));
  }
  if (session.status === 'signed' && partyA.requirement === 'online_signature_required' && partyA.status !== 'signed'
      && workflowState === 'signed') {
    issues.push(issue('aggregate_state_masks_party_a_requirement', 'attention', '合約 aggregate 顯示 signed，但個人甲方尚未完成線上簽署；控制頁必須以甲、乙各方狀態呈現。'));
  }
  if (partyA.requirement === 'unknown' && (session.status || text(first(version.status, version.workflowState), 80))) {
    issues.push(issue('party_a_requirement_unknown', 'attention', '凍結版本缺少可判斷的甲方簽署型態；請核對版本快照，不能假設甲方已簽或無須簽署。'));
  }
  if (partyA.status === 'frozen_company_seal' && !partyA.hasFrozenSeal) {
    issues.push(issue('company_seal_snapshot_missing', 'attention', '公司甲方標示為凍結印鑑，但版本快照未見 large_seal 證據；須由內部確認後才能結案。'));
  }
  if (session.status && !SESSION_ACTIVE.has(session.status)) {
    issues.push(issue('unknown_session_status', 'attention', '簽署 session 狀態不在目前控制模型的已知集合，請保留原始證據並校正 reducer。', { status: session.status }));
  }
  const blocking = issues.some((item) => item.severity === 'blocking');
  return { status: blocking ? 'blocked' : issues.length ? 'attention' : 'healthy', issues };
}

function businessStage(session, partyA, partyB, internal, archive) {
  if (session.status === 'revoked') return 'revoked';
  if (session.status === 'expired') return 'expired';
  if (session.status === 'declined') return 'declined';
  if (archive.status === 'archived') return 'archived';
  if (archive.status === 'awaiting_archive') return 'awaiting_archive';
  if (internal.status === 'awaiting_confirmation') return 'awaiting_internal_confirmation';
  if (partyA.requirement === 'unknown') return 'party_a_requirement_unknown';
  if (partyA.status === 'signer_assignment_required') return 'awaiting_party_a_assignment';
  if (partyA.requirement === 'online_signature_required' && partyA.status !== 'signed') return 'awaiting_party_a';
  if (partyB.status !== 'signed') return partyB.status === 'not_issued' ? 'not_issued' : 'awaiting_party_b';
  return session.status ? 'awaiting_internal_confirmation' : 'not_issued';
}

function actionFor(stage) {
  const definitions = {
    not_issued: ['issue_signing_request', '簽發並送出本版合約簽署邀請', 'engineering_am'],
    awaiting_party_a_assignment: ['assign_party_a_signer', '指定個人甲方的 LINE 簽署人', 'engineering_am'],
    awaiting_party_a: ['sign_party_a', '請甲方完成線上簽署', 'party_a'],
    awaiting_party_b: ['sign_party_b', '請乙方完成線上簽署', 'party_b'],
    awaiting_internal_confirmation: ['confirm_signature_evidence', '核對簽署證據並由我方確認', 'engineering_am'],
    awaiting_archive: ['archive_confirmed_contract', '完成已確認合約的歸檔與收據', 'engineering_am'],
    archived: ['none', '流程已歸檔', 'none'],
    revoked: ['review_and_reissue', '檢視撤回原因，必要時重新簽發新版本', 'engineering_am'],
    expired: ['review_and_reissue', '簽署連結已逾期；核對版本後重新簽發', 'engineering_am'],
    declined: ['review_declined_signature', '檢視拒簽原因並決定修訂或重送', 'engineering_am'],
    party_a_requirement_unknown: ['verify_party_a_requirement', '核對凍結版本中的甲方簽署型態', 'engineering_am'],
    data_attention: ['reconcile_authoritative_signing_data', '先修復資料庫／schema 或簽署資料衝突，再處理合約流程', 'engineering_am'],
  };
  const [code, label, owner] = definitions[stage] || definitions.data_attention;
  return { code, label, owner, requiresHumanConfirmation: ['confirm_signature_evidence', 'archive_confirmed_contract'].includes(code) };
}

function waitingOnFor(stage) {
  return ({
    awaiting_party_a_assignment: 'engineering_am', awaiting_party_a: 'party_a', awaiting_party_b: 'party_b',
    awaiting_internal_confirmation: 'engineering_am', awaiting_archive: 'engineering_am',
    not_issued: 'engineering_am', revoked: 'engineering_am', expired: 'engineering_am', declined: 'engineering_am',
    party_a_requirement_unknown: 'engineering_am', data_attention: 'data_reconciliation', archived: 'none',
  })[stage] || 'data_reconciliation';
}

/**
 * Derives display and queue state for exactly one engineering contract.
 *
 * Accepted shape (all fields are optional so a caller can render degradation):
 * `{ contract, version, signingBundle: { contract, version, session, events },
 *    runtime: { schemaReady, databaseConfigured, schemaVersion } }`.
 * The return value contains no secret token, identity document, IP, or signature
 * blob; it is safe for the authenticated internal control UI after its normal
 * authorization check.
 */
export function reduceEngineeringContractControlState(input = {}) {
  const bundle = object(first(input.signingBundle, input.bundle));
  const contract = object(first(input.contract, bundle.contract));
  const version = object(first(input.version, bundle.version));
  const session = normalSession(input);
  const partyA = partyAState(partyAContext(version), session);
  const partyB = partyBState(session);
  const internal = internalState(session, partyA, partyB);
  const archive = archiveState(session, internal);
  const health = healthState(input, contract, version, session, partyA, partyB);
  const underlyingStage = businessStage(session, partyA, partyB, internal, archive);
  const stage = health.status === 'blocked' ? 'data_attention' : underlyingStage;
  const primaryNextAction = actionFor(stage);
  const waitingOn = waitingOnFor(stage);
  const payment = object(input.payment);
  const acceptance = object(input.acceptance);
  const queueMembership = {
    pendingSigning: ['awaiting_party_a_assignment', 'awaiting_party_a', 'awaiting_party_b'].includes(underlyingStage),
    pendingMyConfirmation: underlyingStage === 'awaiting_internal_confirmation',
    archiveManagement: underlyingStage === 'awaiting_archive',
    paymentManagement: payment.requiresAttention === true,
    acceptanceManagement: acceptance.requiresAttention === true,
    dataAttention: health.status !== 'healthy',
    archived: underlyingStage === 'archived',
  };
  const allEvents = [...list(bundle.events), ...list(session.events)];
  const lastEvent = allEvents
    .map((event) => iso(first(event?.at, event?.occurredAt, event?.occurred_at)))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || '';
  return deepFreeze({
    schemaVersion: ENGINEERING_CONTRACT_CONTROL_STATE_VERSION,
    contractId: text(first(contract.id, session.contractId), 160),
    versionId: text(first(version.id, session.versionId), 160),
    signingSessionId: session.externalSessionId,
    stage,
    underlyingStage,
    waitingOn,
    primaryNextAction,
    partyA,
    partyB,
    internal,
    archive,
    health,
    queueMembership,
    timestamps: {
      issuedAt: session.issuedAt,
      sentAt: session.sentAt,
      receivedAt: session.receivedAt,
      partyASignedAt: partyA.signedAt,
      partyBSignedAt: partyB.signedAt,
      confirmedAt: internal.confirmedAt,
      completedAt: archive.completedAt,
      lastEventAt: lastEvent,
    },
  });
}

// Short alias intended for the v2 control-summary route in the next integration
// wave.  Keeping it an alias makes the reducer's single source of truth clear.
export const deriveEngineeringContractControlState = reduceEngineeringContractControlState;

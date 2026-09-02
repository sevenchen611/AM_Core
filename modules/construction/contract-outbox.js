import crypto from 'node:crypto';
import { assertProjectScope } from './contract-domain.js';
import { resolveAuthoritativeSigningGroup } from './contract-authority.js';
import { createRuntimeSigningService } from './contract-runtime.js';
import { sameId, textFrag } from './common.js';

const REQUIRED_STORE_METHODS = [
  'claimOutbox', 'linkOutboxSession', 'completeOutbox', 'failOutbox', 'getOutboxByKey',
  'getContract', 'getVersion', 'listContracts',
];

function outboxError(code, message, statusCode = 500, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value) { return String(value ?? '').trim(); }
function first(source, fields, fallback = undefined) {
  for (const field of fields) if (source?.[field] !== undefined && source[field] !== null) return source[field];
  return fallback;
}
function unwrap(value) { return value && typeof value === 'object' && 'value' in value ? value.value : value; }
function date(value) { const output = text(value); return output ? { start: output } : null; }
function maskLineId(value) { const id = text(value); return id ? `LINE …${id.slice(-4)}` : ''; }
function maskIp(value) {
  const ip = text(value);
  if (!ip) return '';
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.xxx` : '已記錄（受限）';
}

function requireContext(context) {
  if (!context?.tenant || !text(context.tenant.key) || !text(context.actor)
      || !Object.prototype.hasOwnProperty.call(context, 'scope')) {
    throw outboxError('OUTBOX_SERVER_AUTHORITY_REQUIRED', 'Outbox worker requires server tenant, actor, and scope.', 403);
  }
  return context;
}

function statusLabel(versionStatus, signingStatus) {
  return ({
    sent: '已發送', opened: '已收件', signed: '已簽署', confirmed: '已簽署', completed: '已簽署',
    declined: '已拒簽', expired: '已逾期', revoked: '已撤回',
  })[signingStatus] || ({
    draft: '草稿', internal_review: '內部審核', approved: '待簽發', frozen: '待簽發',
    issued: '已簽發', voided: '已作廢',
  })[versionStatus] || '舊資料／無電子簽署證據';
}

function delayFor(attempt) { return Math.min(3600, 15 * (2 ** Math.max(0, Number(attempt || 1) - 1))); }

export function createContractOutboxWorker(deps, options = {}) {
  const store = deps?.contractStore;
  const missing = REQUIRED_STORE_METHODS.filter((method) => typeof store?.[method] !== 'function');
  if (missing.length) throw outboxError('OUTBOX_STORE_INVALID', 'Contract outbox store is incomplete.', 500, { missing });
  const workerId = text(options.workerId) || `engineering-contract-outbox-${process.pid}-${crypto.randomUUID()}`;
  const signingFactory = options.signingFactory || createRuntimeSigningService;
  const authorityResolver = options.authorityResolver || resolveAuthoritativeSigningGroup;

  async function authoritativeContract(context, contractId) {
    const contract = unwrap(await store.getContract(context.tenant, { contractId }));
    if (!contract) throw outboxError('CONTRACT_NOT_FOUND', 'Outbox contract no longer exists.', 404);
    const project = {
      id: text(first(contract, ['projectId', 'project_notion_page_id'])),
      code: text(first(contract, ['projectCode', 'project_code'])),
    };
    assertProjectScope(context.scope, project);
    return { contract, project };
  }

  async function sendLineInvitation(context, job) {
    const payload = job.payload || {};
    const { contract, project } = await authoritativeContract(context, job.contract_id || payload.contractId);
    const version = unwrap(await store.getVersion(context.tenant, text(payload.versionId)));
    if (!version || text(first(version, ['contractId', 'contract_id'])) !== text(contract.id)
        || text(version.status) !== 'issued') {
      throw outboxError('OUTBOX_VERSION_INVALID', 'Outbox signing version is not the authoritative issued version.', 409);
    }
    const fileId = text(first(version, ['issuedPdfDriveFileId', 'issued_pdf_drive_file_id']));
    const documentHash = text(first(version, ['issuedPdfSha256', 'issued_pdf_sha256'])).toLowerCase();
    const expectedRef = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
    if (expectedRef !== text(payload.documentRef) || documentHash !== text(payload.documentHash).toLowerCase()) {
      throw outboxError('OUTBOX_DOCUMENT_CHANGED', 'Outbox PDF reference or hash differs from PostgreSQL.', 409);
    }
    const group = await authorityResolver(deps, {
      groupBindingId: text(first(contract, ['groupBindingId', 'group_binding_notion_page_id'])),
      projectId: project.id,
      signerLineUserId: text(payload.signerLineUserId),
    });
    const partyASignerLineUserId = text(payload.partyASignerLineUserId);
    const partyAGroup = partyASignerLineUserId ? await authorityResolver(deps, {
      groupBindingId: text(first(contract, ['groupBindingId', 'group_binding_notion_page_id'])),
      projectId: project.id,
      signerLineUserId: partyASignerLineUserId,
    }) : null;
    if (partyAGroup && (text(partyAGroup.lineGroupId) !== text(group.lineGroupId)
        || text(partyAGroup.groupBindingId) !== text(group.groupBindingId))) {
      throw outboxError('PARTY_A_SIGNING_GROUP_MISMATCH', 'Party A signer is outside the authoritative contract LINE group.', 409);
    }
    if (partyASignerLineUserId && partyASignerLineUserId === text(group.signerLineUserId)) {
      throw outboxError('PARTY_SIGNER_CONFLICT', 'Party A and Party B cannot use the same LINE signer.', 409);
    }
    const signing = signingFactory(deps, {
      versionId: text(version.id), groupBindingId: text(group.groupBindingId), actor: text(payload.requestedBy || context.actor),
      expectedSignerName: text(group.signerName), expectedSignerCompany: text(first(contract, ['counterpartyCompany', 'counterparty_company'])),
      expectedSignerTitle: text(first(contract, ['counterpartyTitle', 'counterparty_title'])),
    });
    const signingInput = {
      projectId: project.id,
      contractId: text(contract.id),
      documentRef: expectedRef,
      documentHash,
      lineGroupId: text(group.lineGroupId),
      signerLineUserId: text(group.signerLineUserId),
      partyASignerLineUserId: text(partyAGroup?.signerLineUserId),
      actorId: text(payload.requestedBy || context.actor),
      idempotencyKey: job.idempotency_key,
    };
    if (job.external_session_id) {
      const existing = await signing.getSession(job.external_session_id);
      if (['sent', 'opened', 'signed', 'confirmed', 'completed'].includes(text(existing?.state?.status || existing?.status))) {
        return { sessionId: job.external_session_id, sent: true, sentAt: text(existing?.state?.sentAt || existing?.sentAt), idempotent: true };
      }
    }
    const issued = await signing.issueSigningRequest(signingInput);
    const linked = unwrap(await store.linkOutboxSession(context.tenant, {
      id: job.id, workerId, externalSessionId: issued.sessionId,
    }));
    if (!linked) throw outboxError('OUTBOX_LEASE_LOST', 'Outbox worker could not durably link the signing session.', 409);
    const sent = await signing.sendInvitation({ sessionId: issued.sessionId, token: issued.token });
    return { ...issued, ...sent, sent: true };
  }

  async function projectBudget(context, contract) {
    const budgetItemId = text(first(contract, ['budgetItemId', 'budget_item_notion_page_id']));
    if (!budgetItemId || !deps.dataSources?.budgets) return { skipped: 'no-budget-binding' };
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, { method: 'GET' });
    if (!sameId(page.parent?.data_source_id, deps.dataSources.budgets)) {
      throw outboxError('BUDGET_SCOPE_MISMATCH', 'Budget projection target is outside Engineering budgets.', 403);
    }
    const contracts = unwrap(await store.listContracts(context.tenant, null)) || [];
    const included = contracts.filter((item) => (
      sameId(first(item, ['budgetItemId', 'budget_item_notion_page_id']), budgetItemId)
      // Budget commitment follows the existing Engineering rule: only a
      // PostgreSQL-backed signed/completed contract counts as 已發包. Invitation,
      // send, and open evidence alone are not a contractual commitment.
      && ['signed', 'completed'].includes(text(first(item, ['workflowState', 'workflow_state'])))
    ));
    const committed = included.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const vendors = [...new Set(included.map((item) => text(first(item, ['counterpartyName', 'counterparty_name']))).filter(Boolean))];
    const budget = Number(page.properties?.['預算金額']?.number || 0);
    const status = committed <= 0 ? '未發包' : (budget && committed >= budget ? '已發包' : '部分發包');
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(budgetItemId)}`, {
      method: 'PATCH',
      body: { properties: {
        '已發包金額': { number: committed },
        '發包對象': { rich_text: textFrag(vendors.join('、')) },
        '狀態': { select: { name: status } },
      } },
    });
    return { committed, status };
  }

  async function projectNotion(context, job) {
    const payload = job.payload || {};
    const { contract } = await authoritativeContract(context, job.contract_id || payload.contractId);
    const versionId = text(payload.versionId || first(contract, ['currentVersionId', 'current_version_id']));
    const version = versionId ? unwrap(await store.getVersion(context.tenant, versionId)) : null;
    if (!version || text(first(version, ['contractId', 'contract_id'])) !== text(contract.id)) {
      throw outboxError('OUTBOX_VERSION_INVALID', 'Projection version is not authoritative.', 409);
    }
    let bundle = null;
    if (text(payload.externalSessionId) && typeof store.getSigningBundle === 'function') {
      bundle = unwrap(await store.getSigningBundle(context.tenant, text(payload.externalSessionId)));
    }
    const session = bundle?.session || {};
    const evidence = bundle?.signatureEvidence || {};
    const notionPageId = text(first(contract, ['notionContractPageId', 'notion_contract_page_id']));
    const page = await deps.notionRequest(`/v1/pages/${encodeURIComponent(notionPageId)}`, { method: 'GET' });
    if (!sameId(page.parent?.data_source_id, deps.dataSources?.contracts)) {
      throw outboxError('CONTRACT_PROJECTION_SCOPE_MISMATCH', 'Notion projection target is outside Engineering contracts.', 403);
    }
    const signingStatus = text(first(session, ['status'], payload.status || first(contract, ['signingStatus', 'signing_status'])));
    const properties = {
      '電子簽署狀態': { select: { name: statusLabel(text(version.status), signingStatus) } },
      '電子簽署版本': { number: Number(first(version, ['versionNo', 'version_no'], 0)) || null },
      '文件Bundle SHA-256': { rich_text: textFrag(first(version, ['bundleSha256', 'bundle_sha256'])) },
      'PostgreSQL Contract ID': { rich_text: textFrag(contract.id) },
      'PostgreSQL Version ID': { rich_text: textFrag(version.id) },
      '投影版本': { number: Number(first(contract, ['rowVersion', 'row_version'], 1)) || 1 },
      '投影時間': { date: date(new Date().toISOString()) },
      '投影警示': { rich_text: [] },
      '簽發時間': { date: date(first(version, ['issuedAt', 'issued_at'])) },
      '發送時間': { date: date(first(session, ['sentAt', 'sent_at'])) },
      '收件時間': { date: date(first(session, ['receivedAt', 'received_at'])) },
      '簽署時間': { date: date(first(evidence, ['signedAt', 'signed_at'])) },
      '簽署人': { rich_text: textFrag(first(evidence, ['verifiedSignerName', 'verified_signer_name'])) },
      '簽署人參照': { rich_text: textFrag(maskLineId(first(evidence, ['verifiedSignerLineUserId', 'verified_signer_line_user_id']))) },
      '簽署IP遮罩': { rich_text: textFrag(maskIp(first(evidence, ['ipAddress', 'ip_address']))) },
    };
    if (['signed', 'confirmed', 'completed'].includes(signingStatus)) properties['狀態'] = { select: { name: '已簽約' } };
    await deps.notionRequest(`/v1/pages/${encodeURIComponent(notionPageId)}`, { method: 'PATCH', body: { properties } });
    const budget = await projectBudget(context, contract);
    return { contractId: contract.id, versionId: version.id, signingStatus, budget };
  }

  async function processClaimed(context, job) {
    let result;
    try {
      if (job.event_kind === 'line_signing_invitation') result = await sendLineInvitation(context, job);
      else if (job.event_kind === 'notion_contract_projection') result = await projectNotion(context, job);
      else throw outboxError('OUTBOX_EVENT_UNSUPPORTED', `Unsupported outbox event: ${job.event_kind}`, 500);
      const completed = unwrap(await store.completeOutbox(context.tenant, {
        id: job.id, workerId, externalSessionId: result?.sessionId,
      }));
      if (!completed) throw outboxError('OUTBOX_LEASE_LOST', 'Outbox worker lost its processing lease.', 409);
      return { job: completed, result };
    } catch (error) {
      await store.failOutbox(context.tenant, {
        id: job.id, workerId, maxAttempts: options.maxAttempts || 8,
        delaySeconds: delayFor(job.attempts), error: error?.message || error,
      }).catch(() => {});
      throw error;
    }
  }

  async function processByKey(context, idempotencyKey) {
    const authority = requireContext(context);
    const existing = unwrap(await store.getOutboxByKey(authority.tenant, text(idempotencyKey)));
    if (!existing) throw outboxError('OUTBOX_NOT_FOUND', 'Outbox work item not found.', 404);
    if (existing.status === 'succeeded') return { job: existing, result: null, idempotent: true };
    const claimed = unwrap(await store.claimOutbox(authority.tenant, {
      workerId, idempotencyKey: text(idempotencyKey), limit: 1,
    })) || [];
    if (!claimed.length) return { job: existing, result: null, deferred: true };
    return processClaimed(authority, claimed[0]);
  }

  async function drain(context, input = {}) {
    const authority = requireContext(context);
    const claimed = unwrap(await store.claimOutbox(authority.tenant, {
      workerId, eventKinds: input.eventKinds, limit: input.limit || 10,
    })) || [];
    const results = [];
    for (const job of claimed) {
      try { results.push({ ok: true, ...(await processClaimed(authority, job)) }); }
      catch (error) { results.push({ ok: false, jobId: job.id, code: error?.code || 'OUTBOX_FAILED' }); }
    }
    return { claimed: claimed.length, results };
  }

  return Object.freeze({ processByKey, drain, workerId });
}

export const __test = Object.freeze({ statusLabel, maskLineId, maskIp, delayFor });

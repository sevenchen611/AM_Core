import { createContractArtifactService } from './contract-artifacts.js';
import { resolveAuthoritativeSigningGroup } from './contract-authority.js';
import { createContractManagementService } from './contract-management.js';
import { createRuntimeSigningService } from './contract-runtime.js';

function issuanceError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value) {
  return String(value ?? '').trim();
}

function first(source, fields) {
  for (const field of fields) {
    if (source && source[field] !== undefined && source[field] !== null) return source[field];
  }
  return undefined;
}

function unwrap(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'value')
    ? result.value
    : result;
}

function rejectClientAuthority(input) {
  for (const field of ['lineGroupId', 'line_group_id', 'groupBindingId', 'group_binding_id']) {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) {
      throw issuanceError(
        'SIGNING_GROUP_OVERRIDE_FORBIDDEN',
        '簽署群組只能由合約綁定資料與工程 AM 權限資料解析。',
        403,
        { field },
      );
    }
  }
}

function requireSigner(input) {
  const signerLineUserId = text(first(input, ['signerLineUserId', 'signer_line_user_id']));
  if (!signerLineUserId) {
    throw issuanceError('SIGNER_REQUIRED', '必須指定 LINE 簽署人。', 400);
  }
  return signerLineUserId;
}

function requireGroupBinding(contract) {
  const groupBindingId = text(first(contract, ['groupBindingId', 'group_binding_id']));
  if (!groupBindingId) {
    throw issuanceError('CONTRACT_GROUP_BINDING_REQUIRED', '合約尚未綁定送簽 LINE 群組。', 409);
  }
  return groupBindingId;
}

function requireIssuedFileId(value) {
  const fileId = text(value);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
    throw issuanceError('ISSUED_PDF_REFERENCE_INVALID', '正式合約 PDF 的 Drive 檔案識別碼不合法。', 500);
  }
  return fileId;
}

function normalizeHash(value) {
  const hash = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw issuanceError('ISSUED_PDF_HASH_INVALID', '正式合約 PDF 缺少有效 SHA-256。', 500);
  }
  return hash;
}

function driveDocumentRef(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(requireIssuedFileId(fileId))}/view`;
}

function serverContext(context) {
  if (!context || typeof context !== 'object' || !context.tenant || !text(context.tenant.key)) {
    throw issuanceError('CONTRACT_TENANT_REQUIRED', '缺少伺服器端租戶資訊。', 403);
  }
  if (!text(context.actor)) {
    throw issuanceError('SERVER_ACTOR_REQUIRED', '缺少伺服器端操作人員。', 403);
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'scope') || context.scope === undefined) {
    throw issuanceError('PROJECT_SCOPE_REQUIRED', '缺少伺服器端工程權限範圍。', 403);
  }
  return context;
}

function issuedFields(version) {
  return {
    fileId: text(first(version, ['issuedPdfDriveFileId', 'issued_pdf_drive_file_id'])),
    sha256: text(first(version, ['issuedPdfSha256', 'issued_pdf_sha256'])).toLowerCase(),
  };
}

function signingResult(result, documentRef, documentHash, retried) {
  return Object.freeze({
    ok: true,
    retried,
    sessionId: text(result?.sessionId),
    sent: result?.sent === true,
    sentAt: text(result?.sentAt),
    expiresAt: text(result?.expiresAt),
    documentRef,
    documentHash,
  });
}

/**
 * Coordinates the privileged frozen-version issuance boundary. Client input may
 * select a signer, contract, and version, but never a LINE group or actor.
 */
export function createContractIssuanceService(deps, options = {}) {
  if (!deps?.contractStore || typeof deps.contractStore.issueVersion !== 'function') {
    throw issuanceError('CONTRACT_STORE_INVALID', '合約資料庫不支援版本簽發。', 500);
  }
  const management = options.managementService
    || createContractManagementService({
      store: deps.contractStore,
      ...(options.clock ? { clock: options.clock } : {}),
    });
  const artifacts = options.artifactService || createContractArtifactService(deps, options.artifactOptions);
  const authorityResolver = options.authorityResolver || resolveAuthoritativeSigningGroup;
  const signingFactory = options.signingFactory || createRuntimeSigningService;
  const clock = options.clock || (() => new Date());

  async function resolveGroup(contract, signerLineUserId) {
    return authorityResolver(deps, {
      groupBindingId: requireGroupBinding(contract),
      projectId: text(contract.projectId),
      signerLineUserId,
    });
  }

  async function sendIssuedVersion(context, contract, version, group, fields, retried, preparedSigning = null) {
    const documentHash = normalizeHash(fields.sha256);
    const documentRef = driveDocumentRef(fields.fileId);
    const signing = preparedSigning || signingFactory(deps, {
      versionId: text(version.id),
      groupBindingId: text(group.groupBindingId),
      actor: text(context.actor),
      expectedSignerName: text(group.signerName),
      expectedSignerCompany: text(contract.counterpartyCompany),
      expectedSignerTitle: text(contract.counterpartyTitle),
    });
    const result = await signing.issueAndSend({
      projectId: text(contract.projectId),
      contractId: text(contract.id),
      documentRef,
      documentHash,
      lineGroupId: text(group.lineGroupId),
      signerLineUserId: text(group.signerLineUserId),
      actorId: text(context.actor),
    });
    return signingResult(result, documentRef, documentHash, retried);
  }

  async function issueFrozenVersion(context, input = {}) {
    const authority = serverContext(context);
    rejectClientAuthority(input);
    const signerLineUserId = requireSigner(input);

    // This is intentionally the first external/domain operation. Rendering and
    // LINE authority lookup must never run for an incomplete frozen bundle.
    const readiness = await management.issueReadiness(authority, {
      contractId: text(first(input, ['contractId', 'contract_id'])),
      versionId: text(first(input, ['versionId', 'version_id'])),
    });
    if (readiness.ready !== true) {
      throw issuanceError(
        'CONTRACT_NOT_READY_FOR_ISSUE',
        '合約尚未符合簽發條件。',
        409,
        { blockers: readiness.blockers || [] },
      );
    }

    const { contract, version } = readiness;
    const group = await resolveGroup(contract, signerLineUserId);
    // Fail closed on LIFF, token pepper, public URL, feature flag, and database
    // configuration before rendering or committing the frozen -> issued CAS.
    const preparedSigning = signingFactory(deps, {
      versionId: text(version.id),
      groupBindingId: text(group.groupBindingId),
      actor: text(authority.actor),
      expectedSignerName: text(group.signerName),
      expectedSignerCompany: text(contract.counterpartyCompany),
      expectedSignerTitle: text(contract.counterpartyTitle),
    });
    const idempotencyKey = `engineering-contract-issued:${authority.tenant.key}:${version.id}:${version.attachmentManifestHash}`;
    const rendered = await artifacts.renderPdf('issued_pdf', {
      contract,
      version,
      packageValidation: readiness.packageValidation,
      frozenBundleSha256: version.attachmentManifestHash,
    }, idempotencyKey);
    const storedPdf = await artifacts.storePdf({
      projectLabel: contract.projectCode || contract.projectId,
      contractLabel: contract.contractNumber || contract.title || contract.id,
      filename: `${contract.contractNumber || contract.id}-v${version.versionNo}-issued.pdf`,
      rendered,
    });
    const issuedAt = new Date(clock()).toISOString();
    const issued = unwrap(await deps.contractStore.issueVersion(authority.tenant, {
      contractId: contract.id,
      versionId: version.id,
      issuedAt,
      actor: authority.actor,
      issuedPdfDriveFileId: requireIssuedFileId(storedPdf.driveFileId),
      issuedPdfSha256: normalizeHash(storedPdf.sha256),
      byteSize: Number(storedPdf.byteSize),
      metadata: {
        rendererKind: 'issued_pdf',
        frozenBundleSha256: version.attachmentManifestHash,
      },
    }));
    if (!issued || text(issued.status) !== 'issued') {
      throw issuanceError('ISSUE_STORE_VIOLATION', '合約資料庫未回傳已簽發版本。', 500);
    }
    const persisted = issuedFields(issued);
    if (persisted.fileId !== storedPdf.driveFileId || persisted.sha256 !== storedPdf.sha256) {
      throw issuanceError('ISSUE_STORE_VIOLATION', '資料庫保存的正式 PDF 與本次產物不一致。', 500);
    }

    // If LINE rejects the push, contract-signing revokes the new session. The
    // issued version and its immutable PDF deliberately remain authoritative.
    return sendIssuedVersion(authority, contract, issued, group, persisted, false, preparedSigning);
  }

  async function retryIssuedVersionSigning(context, input = {}) {
    const authority = serverContext(context);
    rejectClientAuthority(input);
    const signerLineUserId = requireSigner(input);
    const contractId = text(first(input, ['contractId', 'contract_id']));
    const versionId = text(first(input, ['versionId', 'version_id']));
    const detail = await management.getContractDetail(authority, { contractId });
    const version = (detail.versions || []).find((item) => text(item.id) === versionId);
    if (!version) throw issuanceError('CONTRACT_VERSION_NOT_FOUND', '找不到要重送的合約版本。', 404);
    if (text(version.status) !== 'issued') {
      throw issuanceError('VERSION_NOT_ISSUED', '只有已簽發版本可以重新送簽。', 409);
    }
    const fields = issuedFields(version);
    requireIssuedFileId(fields.fileId);
    normalizeHash(fields.sha256);
    const group = await resolveGroup(detail.contract, signerLineUserId);
    return sendIssuedVersion(authority, detail.contract, version, group, fields, true);
  }

  return Object.freeze({ issueFrozenVersion, retryIssuedVersionSigning });
}

export const __test = Object.freeze({ driveDocumentRef, rejectClientAuthority });

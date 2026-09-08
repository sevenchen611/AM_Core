import crypto from 'node:crypto';
import { assertProjectScope } from './contract-domain.js';

const ARTIFACTS = Object.freeze({
  signed_pdf: Object.freeze({
    mimeType: 'application/pdf',
    suffix: 'signed.pdf',
    maxBytes: 40 * 1024 * 1024,
  }),
  evidence_receipt: Object.freeze({
    mimeType: 'application/json; charset=utf-8',
    suffix: 'evidence-receipt.json',
    maxBytes: 2 * 1024 * 1024,
  }),
});

function readerError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value, max = 300) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, max);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function unwrap(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
    ? value.value : value;
}

function artifactKind(value) {
  return text(first(value?.artifactKind, value?.artifact_kind), 80);
}

function artifactFileId(value) {
  return text(first(value?.driveFileId, value?.drive_file_id), 240);
}

function artifactHash(value) {
  return text(value?.sha256, 64).toLowerCase();
}

function safeFileStem(value) {
  return text(value, 180).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || 'contract';
}

function bufferOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (Buffer.isBuffer(value?.buffer)) return value.buffer;
  if (value?.buffer instanceof Uint8Array) return Buffer.from(value.buffer);
  return null;
}

function sameHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function createContractFinalArtifactReader(deps = {}) {
  const store = deps.contractStore;
  if (!store) throw readerError('CONTRACT_STORE_REQUIRED', '工程合約資料庫尚未設定。', 503);

  for (const method of ['getContract', 'listVersions', 'listContracts', 'getSigningBundle']) {
    if (typeof store[method] !== 'function') {
      throw readerError('CONTRACT_ARTIFACT_STORE_UNAVAILABLE', `工程合約資料庫缺少 ${method} 查詢。`, 503);
    }
  }
  if (typeof deps.downloadFromDrive !== 'function' || typeof deps.auditDrivePrivate !== 'function') {
    throw readerError('CONTRACT_ARTIFACT_DRIVE_UNAVAILABLE', '工程合約私有檔案讀取功能尚未設定。', 503);
  }

  async function load(context, input, kind) {
    const spec = ARTIFACTS[kind];
    if (!spec) throw readerError('CONTRACT_ARTIFACT_KIND_INVALID', '不支援的合約歸檔檔案類型。', 400);
    const contractId = text(input?.contractId, 160);
    const versionId = text(input?.versionId, 160);
    if (!contractId || !versionId) throw readerError('CONTRACT_ARTIFACT_REFERENCE_REQUIRED', '缺少合約或版本識別碼。', 400);

    if (!context?.tenant?.key || !text(context?.actor, 160)
        || !Object.prototype.hasOwnProperty.call(context || {}, 'scope')) {
      throw readerError('CONTRACT_ARTIFACT_AUTHORITY_REQUIRED', '缺少合約檔案的伺服器授權內容。', 403);
    }
    const contract = unwrap(await store.getContract(context.tenant, { contractId }));
    if (!contract) throw readerError('CONTRACT_NOT_FOUND', '找不到這份合約。', 404);
    const projectId = text(first(contract.projectId, contract.project_id, contract.project_notion_page_id), 160);
    const projectCode = text(first(contract.projectCode, contract.project_code), 160);
    assertProjectScope(context.scope, { id: projectId, code: projectCode });
    const versions = unwrap(await store.listVersions(context.tenant, contractId));
    const version = Array.isArray(versions)
      ? versions.find((item) => text(first(item?.id, item?.versionId, item?.version_id), 160) === versionId
        && text(first(item?.contractId, item?.contract_id), 160) === contractId)
      : null;
    if (!version) throw readerError('CONTRACT_ARTIFACT_VERSION_NOT_FOUND', '找不到這個合約版本。', 404);

    // Use the same enriched projection as the workspace/control list so the
    // latest authoritative signing session cannot diverge from the detail view.
    const rows = unwrap(await store.listContracts(context.tenant, [projectId]));
    const row = Array.isArray(rows) ? rows.find((item) => text(item?.id, 160) === contractId) : null;
    const sessionId = text(first(row?.signing_external_session_id, row?.signingExternalSessionId), 160);
    if (!sessionId) throw readerError('CONTRACT_SIGNING_SESSION_NOT_FOUND', '找不到這份合約的簽署 session。', 409);

    const bundle = unwrap(await store.getSigningBundle(context.tenant, sessionId));
    const bundleContractId = text(first(bundle?.contract?.id, bundle?.contractId), 160);
    const bundleVersionId = text(first(bundle?.version?.id, bundle?.versionId, bundle?.session?.versionId), 160);
    if (!bundle || bundleContractId !== contractId || bundleVersionId !== versionId) {
      throw readerError('CONTRACT_SIGNING_BUNDLE_MISMATCH', '簽署證據與目前合約版本不一致，禁止開啟。', 409);
    }
    if (text(first(bundle?.session?.status, bundle?.signingStatus), 80).toLowerCase() !== 'completed') {
      throw readerError('CONTRACT_FINAL_ARTIFACT_NOT_READY', '合約尚未完成簽署與最終歸檔。', 409);
    }

    const artifact = (Array.isArray(bundle.artifacts) ? bundle.artifacts : [])
      .find((item) => artifactKind(item) === kind);
    const fileId = artifactFileId(artifact);
    const expectedHash = artifactHash(artifact);
    if (!fileId || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw readerError('CONTRACT_FINAL_ARTIFACT_MISSING', '最終歸檔紀錄不完整，請由資料管理者核對。', 404);
    }

    const privacy = await deps.auditDrivePrivate(fileId);
    if (privacy?.private !== true) {
      throw readerError('CONTRACT_FINAL_ARTIFACT_NOT_PRIVATE', '最終合約檔案不是私有檔案，禁止開啟。', 409);
    }
    const downloaded = await deps.downloadFromDrive(fileId, spec.maxBytes);
    const buffer = bufferOf(downloaded);
    if (!buffer) throw readerError('CONTRACT_FINAL_ARTIFACT_DOWNLOAD_FAILED', '無法讀取最終合約檔案。', 503);
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (!sameHash(actualHash, expectedHash)) {
      throw readerError('CONTRACT_FINAL_ARTIFACT_HASH_MISMATCH', '最終合約檔案雜湊驗證失敗，禁止開啟。', 409);
    }

    return {
      buffer,
      mimeType: spec.mimeType,
      fileName: `${safeFileStem(first(contract.contractNumber, contract.contract_number, contract.id))}-${spec.suffix}`,
      sha256: actualHash,
    };
  }

  return Object.freeze({
    loadSignedPdf: (context, input = {}) => load(context, input, 'signed_pdf'),
    loadEvidenceReceipt: (context, input = {}) => load(context, input, 'evidence_receipt'),
  });
}

export const __test = Object.freeze({ ARTIFACTS, safeFileStem, sameHash });

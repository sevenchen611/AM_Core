import { createHash } from 'node:crypto';
import { assertProjectScope, requireServerActor } from './contract-domain.js';

const HASH_RE = /^[a-f0-9]{64}$/;
const COMPLETABLE = new Set(['signed', 'confirmed', 'completed']);

function completionError(code, message, statusCode = 400, details = {}) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function text(value) {
  return String(value ?? '').trim();
}

function first(source, names, fallback = undefined) {
  for (const name of names) {
    if (source && source[name] !== undefined && source[name] !== null) return source[name];
  }
  return fallback;
}

function unwrap(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')
    ? value.value
    : value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256(value, field) {
  const normalized = text(value).toLowerCase();
  if (!HASH_RE.test(normalized)) {
    throw completionError('COMPLETION_HASH_INVALID', `${field} 缺少有效 SHA-256。`, 500, { field });
  }
  return normalized;
}

function serverContext(context) {
  if (!context || typeof context !== 'object') {
    throw completionError('SERVER_CONTEXT_REQUIRED', '缺少伺服器端合約操作資訊。', 403);
  }
  const actor = requireServerActor(context);
  if (!context.tenant || !text(context.tenant.key)) {
    throw completionError('CONTRACT_TENANT_REQUIRED', '缺少伺服器端租戶資訊。', 403);
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'scope') || context.scope === undefined) {
    throw completionError('PROJECT_SCOPE_REQUIRED', '缺少伺服器端工程權限範圍。', 403);
  }
  return { tenant: context.tenant, actor, scope: context.scope };
}

function rejectClientAuthority(input) {
  for (const field of [
    'actor', 'actorId', 'tenant', 'scope', 'projectId', 'project_id',
    'contractId', 'contract_id', 'versionId', 'version_id', 'lineGroupId',
    'signerLineUserId', 'signatureHash', 'documentHash', 'bundleHash', 'ipAddress',
  ]) {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) {
      throw completionError(
        'COMPLETION_AUTHORITY_OVERRIDE_FORBIDDEN',
        '完成歸檔只能使用伺服器與資料庫中的權威資料。',
        403,
        { field },
      );
    }
  }
}

function normalizeBundle(raw, expectedSessionId) {
  const bundle = unwrap(raw);
  if (!bundle || typeof bundle !== 'object') {
    throw completionError('SIGNING_BUNDLE_NOT_FOUND', '找不到簽署證據資料。', 404);
  }
  const contract = bundle.contract || {};
  const version = bundle.version || bundle.contractVersion || {};
  const session = bundle.session || bundle.signingSession || {};
  const signatureEvidence = bundle.signatureEvidence || bundle.signature || {};
  const events = Array.isArray(bundle.events)
    ? bundle.events
    : (Array.isArray(bundle.signingEvents) ? bundle.signingEvents : []);
  const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];
  const normalized = {
    raw: bundle,
    contract,
    version,
    session,
    signatureEvidence,
    events,
    artifacts,
    contractId: text(first(contract, ['id', 'contractId', 'contract_id'])),
    projectId: text(first(contract, ['projectId', 'project_id', 'projectNotionPageId', 'project_notion_page_id'])),
    projectCode: text(first(contract, ['projectCode', 'project_code'])),
    versionId: text(first(version, ['id', 'versionId', 'version_id'])),
    versionContractId: text(first(version, ['contractId', 'contract_id'])),
    sessionId: text(first(session, ['externalSessionId', 'external_session_id', 'id', 'sessionId'])),
    sessionVersionId: text(first(session, ['versionId', 'version_id'])),
    status: text(first(session, ['status'])),
  };
  if (!normalized.contractId || !normalized.projectId || !normalized.versionId || !normalized.sessionId) {
    throw completionError('SIGNING_BUNDLE_INVALID', '簽署證據資料缺少合約、版本、工程或流程識別碼。', 500);
  }
  if (normalized.sessionId !== expectedSessionId
    || normalized.versionContractId !== normalized.contractId
    || normalized.sessionVersionId !== normalized.versionId) {
    throw completionError('SIGNING_BUNDLE_RELATION_MISMATCH', '簽署流程、合約版本與工程合約的關聯不一致。', 409);
  }
  if (!COMPLETABLE.has(normalized.status)) {
    throw completionError('SIGNATURE_NOT_READY', '簽署流程尚未到達可確認或歸檔狀態。', 409, { status: normalized.status });
  }
  return normalized;
}

function artifactKind(item) {
  return text(first(item, ['artifactKind', 'artifact_kind', 'kind']));
}

function artifactHash(item) {
  return text(first(item, ['sha256', 'hash'])).toLowerCase();
}

function artifactRef(item) {
  return text(first(item, ['driveFileId', 'drive_file_id', 'ref']));
}

function findArtifact(bundle, kind) {
  return bundle.artifacts.find((item) => artifactKind(item) === kind) || null;
}

function eventType(event) {
  return text(first(event, ['type', 'eventType', 'event_type']));
}

function eventAt(bundle, type, fallback = '') {
  const event = bundle.events.find((item) => eventType(item) === type);
  return text(first(event, ['at', 'occurredAt', 'occurred_at'], fallback));
}

function eventMetadata(bundle, type) {
  const event = bundle.events.find((item) => eventType(item) === type);
  return event?.metadata || event?.payload || {};
}

function chainHead(bundle) {
  const ordered = [...bundle.events].sort((a, b) => (
    Number(first(a, ['sequenceNo', 'sequence_no'], 0)) - Number(first(b, ['sequenceNo', 'sequence_no'], 0))
  ));
  const last = ordered.at(-1) || {};
  return sha256(first(last, ['eventHash', 'event_hash']), 'eventChain.headHash');
}

function bufferResult(value) {
  const candidate = value?.buffer ?? value?.bytes ?? value;
  const buffer = Buffer.isBuffer(candidate) ? candidate : Buffer.from(candidate || []);
  if (!buffer.length) throw completionError('SIGNATURE_DOWNLOAD_EMPTY', '無法取得簽名圖檔。', 502);
  const declaredMime = text(value?.mimeType || value?.contentType).toLowerCase();
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!png && !jpeg) throw completionError('SIGNATURE_FILE_INVALID', '簽名圖檔必須是 PNG 或 JPEG。', 422);
  return { buffer, mimeType: png ? 'image/png' : 'image/jpeg', declaredMime };
}

function taipeiTime(iso) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
  return `${parts.replace(' ', 'T')}+08:00`;
}

function publicResult(bundle, signedPdf, receipt, options = {}) {
  return Object.freeze({
    ok: true,
    status: options.status || 'completed',
    sessionId: bundle.sessionId,
    contractId: bundle.contractId,
    versionId: bundle.versionId,
    signedPdf: { driveFileId: artifactRef(signedPdf), sha256: artifactHash(signedPdf) },
    evidenceReceipt: { driveFileId: artifactRef(receipt), sha256: artifactHash(receipt) },
    retried: options.retried === true,
    idempotent: options.idempotent === true,
    // Deliberately excludes the raw token, signature bytes/reference and full IP.
    evidence: { ipRecorded: true, signatureRecorded: true },
  });
}

function validateService(deps, options) {
  for (const method of ['getSigningBundle', 'recordArtifact']) {
    if (typeof deps?.contractStore?.[method] !== 'function') {
      throw completionError('CONTRACT_STORE_INVALID', `合約資料庫缺少 ${method}。`, 500);
    }
  }
  const artifacts = options.artifactService || deps.artifactService;
  for (const method of ['renderPdf', 'storePdf', 'storeEvidenceReceipt']) {
    if (typeof artifacts?.[method] !== 'function') {
      throw completionError('CONTRACT_ARTIFACT_SERVICE_INVALID', `合約產物服務缺少 ${method}。`, 500);
    }
  }
  if (typeof deps.downloadFromDrive !== 'function') {
    throw completionError('SIGNATURE_DOWNLOAD_UNAVAILABLE', '簽名圖檔下載服務尚未設定。', 500);
  }
  const signing = options.signingService || deps.contractSigningService;
  for (const method of ['getSession', 'confirmSubmission', 'completeSigning']) {
    if (typeof signing?.[method] !== 'function') {
      throw completionError('CONTRACT_SIGNING_SERVICE_INVALID', `簽署服務缺少 ${method}。`, 500);
    }
  }
  return { artifacts, signing };
}

/**
 * Coordinates the privileged signed -> confirmed -> completed boundary.
 * The session id is the only client-selectable identifier. All authority,
 * relationships, hashes and evidence are reloaded from tenant-scoped storage.
 */
export function createContractCompletionService(deps, options = {}) {
  const { artifacts, signing } = validateService(deps, options);
  const clock = options.clock || (() => new Date());

  async function load(authority, sessionId) {
    const bundle = normalizeBundle(
      await deps.contractStore.getSigningBundle(authority.tenant, sessionId),
      sessionId,
    );
    assertProjectScope(authority.scope, { id: bundle.projectId, code: bundle.projectCode });
    return bundle;
  }

  function ensureSessionMatches(bundle, state) {
    if (!state || text(state.id) !== bundle.sessionId
      || text(state.contractId) !== bundle.contractId
      || text(state.projectId) !== bundle.projectId) {
      throw completionError('SIGNING_SESSION_RELATION_MISMATCH', '簽署服務狀態與資料庫關聯不一致。', 409);
    }
    const stateVersionId = text(state.versionId || state.context?.versionId);
    if (stateVersionId && stateVersionId !== bundle.versionId) {
      throw completionError('SIGNING_SESSION_RELATION_MISMATCH', '簽署服務狀態指向不同合約版本。', 409);
    }
    const documentHash = sha256(state.documentHash, 'session.documentHash');
    const storedDocumentHash = sha256(
      first(bundle.session, ['documentSha256', 'document_sha256', 'documentHash'], state.documentHash),
      'bundle.documentHash',
    );
    if (documentHash !== storedDocumentHash) {
      throw completionError('SIGNED_DOCUMENT_HASH_MISMATCH', '簽署文件雜湊與資料庫證據不一致。', 409);
    }
    return { state, documentHash };
  }

  async function record(authority, bundle, kind, stored, metadata) {
    const created = unwrap(await deps.contractStore.recordArtifact(authority.tenant, {
      versionId: bundle.versionId,
      sessionId: bundle.sessionId,
      artifactKind: kind,
      driveFileId: text(stored.driveFileId),
      sha256: sha256(stored.sha256, `${kind}.sha256`),
      byteSize: Number(stored.byteSize),
      metadata,
    }));
    if (created) return created;
    const refreshed = await load(authority, bundle.sessionId);
    const existing = findArtifact(refreshed, kind);
    if (!existing || artifactHash(existing) !== text(stored.sha256).toLowerCase()) {
      throw completionError('ARTIFACT_RECORD_CONFLICT', '歸檔產物發生衝突，未變更簽署狀態。', 409, { kind });
    }
    return existing;
  }

  async function completeContract(context, input = {}) {
    const authority = serverContext(context);
    rejectClientAuthority(input);
    const sessionId = text(input.sessionId || input.externalSessionId);
    if (!sessionId) throw completionError('SIGNING_SESSION_REQUIRED', '必須指定簽署流程。', 400);

    let bundle = await load(authority, sessionId);
    let runtime = ensureSessionMatches(bundle, await signing.getSession(sessionId));
    if (!COMPLETABLE.has(text(runtime.state.status))) {
      throw completionError('SIGNATURE_NOT_READY', '簽署流程尚未到達可確認或歸檔狀態。', 409);
    }

    const alreadySignedPdf = findArtifact(bundle, 'signed_pdf');
    const alreadyReceipt = findArtifact(bundle, 'evidence_receipt');
    if (bundle.status === 'completed' || text(runtime.state.status) === 'completed') {
      if (bundle.status !== 'completed' || text(runtime.state.status) !== 'completed') {
        throw completionError('COMPLETION_STATE_MISMATCH', '簽署服務與資料庫的完成狀態不一致。', 409);
      }
      if (!alreadySignedPdf || !alreadyReceipt) {
        throw completionError('COMPLETED_ARTIFACTS_MISSING', '已完成流程缺少不可變歸檔產物。', 500);
      }
      const signedPdfHash = sha256(artifactHash(alreadySignedPdf), 'signed_pdf.sha256');
      sha256(artifactHash(alreadyReceipt), 'evidence_receipt.sha256');
      if (sha256(runtime.state.completion?.finalArtifactHash, 'completion.finalArtifactHash') !== signedPdfHash
        || text(runtime.state.completion?.finalArtifactRef) !== artifactRef(alreadySignedPdf)) {
        throw completionError('COMPLETED_ARTIFACT_MISMATCH', '完成事件與不可變最終 PDF 不一致。', 409);
      }
      return publicResult(bundle, alreadySignedPdf, alreadyReceipt, { idempotent: true, retried: true });
    }

    const bundleHash = sha256(
      first(bundle.version, ['bundleSha256', 'bundle_sha256', 'attachmentManifestHash', 'attachment_manifest_hash']),
      'version.bundleHash',
    );
    const originalDocumentHash = runtime.documentHash;
    const originalSignatureHash = sha256(
      first(bundle.signatureEvidence, ['signatureSha256', 'signature_sha256', 'signatureHash'], runtime.state.submission?.signatureHash),
      'signature.sha256',
    );

    let retried = bundle.status === 'confirmed' || text(runtime.state.status) === 'confirmed';
    if (text(runtime.state.status) === 'signed') {
      await signing.confirmSubmission({
        sessionId,
        actorId: authority.actor,
        idempotencyKey: `engineering-contract-confirm:${authority.tenant.key}:${sessionId}:${bundleHash}`,
        requestMeta: options.requestMeta || {},
      });
    }

    // Reload after confirmation. This is also the recovery point when PDF
    // rendering/storage failed during an earlier request.
    bundle = await load(authority, sessionId);
    runtime = ensureSessionMatches(bundle, await signing.getSession(sessionId));
    if (text(runtime.state.status) !== 'confirmed' || bundle.status !== 'confirmed') {
      throw completionError('CONFIRMATION_NOT_PERSISTED', '我方確認尚未完整寫入，未開始產出歸檔文件。', 409);
    }
    if (runtime.documentHash !== originalDocumentHash) {
      throw completionError('SIGNED_DOCUMENT_HASH_CHANGED', '確認後的簽署文件雜湊已改變。', 409);
    }
    const signatureHash = sha256(
      first(bundle.signatureEvidence, ['signatureSha256', 'signature_sha256', 'signatureHash'], runtime.state.submission?.signatureHash),
      'signature.sha256',
    );
    if (signatureHash !== originalSignatureHash) {
      throw completionError('SIGNATURE_HASH_CHANGED', '確認後的簽名雜湊已改變。', 409);
    }

    const signatureRef = text(first(bundle.signatureEvidence, [
      'signatureDriveFileId', 'signature_drive_file_id', 'submissionRef', 'submission_ref',
    ], runtime.state.submission?.submissionRef));
    if (!signatureRef) throw completionError('SIGNATURE_REFERENCE_MISSING', '簽署證據缺少簽名圖檔位置。', 500);
    const signatureDownload = bufferResult(await deps.downloadFromDrive(signatureRef));
    if (hash(signatureDownload.buffer) !== signatureHash) {
      throw completionError('SIGNATURE_DOWNLOAD_HASH_MISMATCH', '下載的簽名圖檔與不可變簽名雜湊不一致。', 409);
    }

    const signedMetadata = eventMetadata(bundle, 'signed');
    const signedEvent = bundle.events.find((item) => eventType(item) === 'signed') || {};
    const ipAddress = text(first(bundle.signatureEvidence, ['ipAddress', 'ip_address'], first(signedEvent, ['ip', 'ipAddress', 'ip_address'])));
    if (!ipAddress) throw completionError('SIGNING_IP_MISSING', '簽署證據缺少 IP。', 500);
    const times = {
      issuedAt: text(first(bundle.session, ['issuedAt', 'issued_at'], eventAt(bundle, 'issued'))),
      sentAt: eventAt(bundle, 'sent', first(bundle.session, ['sentAt', 'sent_at'], '')),
      receivedAt: text(first(bundle.session, ['receivedAt', 'received_at'], eventAt(bundle, 'first_opened', eventAt(bundle, 'submission_received')))),
      signedAt: text(first(bundle.signatureEvidence, ['signedAt', 'signed_at'], eventAt(bundle, 'signed'))),
      confirmedAt: text(first(runtime.state.confirmation, ['confirmedAt'], eventAt(bundle, 'confirmed'))),
    };
    if (Object.values(times).some((value) => !value || !Number.isFinite(Date.parse(value)))) {
      throw completionError('SIGNING_TIMELINE_INCOMPLETE', '簽署證據缺少簽發、發送、收件、簽署或確認時間。', 500, { missing: Object.entries(times).filter(([, value]) => !value).map(([key]) => key) });
    }

    const verification = {
      liffIdentityVerified: text(first(signedMetadata, ['identitySource'])) === 'verified_liff',
      groupMembershipVerified: signedMetadata.membershipVerified === true,
      designatedUserMatched: signedMetadata.specifiedUserMatched === true,
      lineGroupId: text(first(bundle.session, ['lineGroupId', 'line_group_id'], runtime.state.lineGroupId)),
      signerLineUserId: text(first(bundle.session, ['signerLineUserId', 'signer_line_user_id'], runtime.state.signerLineUserId)),
      consentVersion: text(first(bundle.signatureEvidence, ['consentVersion', 'consent_version'], runtime.state.submission?.consentVersion)),
      reviewAcknowledged: first(bundle.signatureEvidence, ['reviewAcknowledged', 'review_acknowledged'], runtime.state.submission?.reviewAcknowledged) === true,
    };
    if (!verification.liffIdentityVerified || !verification.groupMembershipVerified
      || !verification.designatedUserMatched || !verification.lineGroupId
      || !verification.signerLineUserId || !verification.reviewAcknowledged) {
      throw completionError('SIGNER_VERIFICATION_INCOMPLETE', 'LIFF、群組或指定簽署人驗證證據不完整。', 409);
    }

    let signedPdf = findArtifact(bundle, 'signed_pdf');
    if (!signedPdf) {
      const rendered = await artifacts.renderPdf('signed_pdf', {
        contract: bundle.contract,
        version: bundle.version,
        immutable: true,
        bundleHash,
        documentHash: originalDocumentHash,
        signature: {
          mimeType: signatureDownload.mimeType,
          base64: signatureDownload.buffer.toString('base64'),
          sha256: signatureHash,
        },
        ipAddress,
        times,
        verification,
      }, `engineering-contract-signed-pdf:${authority.tenant.key}:${sessionId}:${bundleHash}:${signatureHash}`);
      const stored = await artifacts.storePdf({
        projectLabel: bundle.projectCode || bundle.projectId,
        contractLabel: text(first(bundle.contract, ['contractNumber', 'contract_number', 'title'], bundle.contractId)),
        filename: `${text(first(bundle.contract, ['contractNumber', 'contract_number'], bundle.contractId))}-signed.pdf`,
        rendered,
      });
      if (sha256(stored.sha256, 'signed_pdf.sha256') !== sha256(rendered.sha256, 'rendered.sha256')) {
        throw completionError('SIGNED_PDF_STORE_HASH_MISMATCH', '儲存的最終 PDF 與產出檔案雜湊不一致。', 502);
      }
      signedPdf = await record(authority, bundle, 'signed_pdf', stored, {
        bundleHash, documentHash: originalDocumentHash, signatureHash, rendererKind: 'signed_pdf',
      });
      bundle = await load(authority, sessionId);
    }

    let receiptArtifact = findArtifact(bundle, 'evidence_receipt');
    if (!receiptArtifact) {
      const generatedUtc = new Date(clock()).toISOString();
      const receipt = {
        schemaVersion: 'engineering-contract-evidence-receipt-v1',
        generatedAt: { utc: generatedUtc, asiaTaipei: taipeiTime(generatedUtc) },
        tenantKey: authority.tenant.key,
        project: { id: bundle.projectId, code: bundle.projectCode },
        contract: {
          id: bundle.contractId,
          number: text(first(bundle.contract, ['contractNumber', 'contract_number'])),
          title: text(first(bundle.contract, ['title'])),
        },
        version: { id: bundle.versionId, bundleHash, documentHash: originalDocumentHash },
        signing: { sessionId, times, ipAddress },
        verification,
        eventChain: { headHash: chainHead(bundle), eventCount: bundle.events.length },
        artifacts: [
          ...bundle.artifacts.filter((item) => artifactKind(item) !== 'evidence_receipt').map((item) => ({
            kind: artifactKind(item), sha256: sha256(artifactHash(item), `artifact.${artifactKind(item)}`),
          })),
          { kind: 'signature_image', sha256: signatureHash },
        ].filter((item, index, all) => all.findIndex((candidate) => candidate.kind === item.kind && candidate.sha256 === item.sha256) === index),
        confirmedBy: authority.actor,
      };
      const storedReceipt = await artifacts.storeEvidenceReceipt({
        projectLabel: bundle.projectCode || bundle.projectId,
        contractLabel: text(first(bundle.contract, ['contractNumber', 'contract_number', 'title'], bundle.contractId)),
        filename: `${text(first(bundle.contract, ['contractNumber', 'contract_number'], bundle.contractId))}-evidence-receipt.json`,
        receipt,
      });
      receiptArtifact = await record(authority, bundle, 'evidence_receipt', storedReceipt, {
        schemaVersion: receipt.schemaVersion,
        eventChainHeadHash: receipt.eventChain.headHash,
        bundleHash,
      });
      bundle = await load(authority, sessionId);
    }

    // Recheck the immutable hashes immediately before the final CAS.
    runtime = ensureSessionMatches(bundle, await signing.getSession(sessionId));
    if (runtime.documentHash !== originalDocumentHash
      || sha256(first(bundle.signatureEvidence, ['signatureSha256', 'signature_sha256', 'signatureHash'], runtime.state.submission?.signatureHash), 'signature.sha256') !== signatureHash) {
      throw completionError('SIGNING_EVIDENCE_CHANGED', '歸檔前的簽署證據已改變。', 409);
    }
    signedPdf = findArtifact(bundle, 'signed_pdf') || signedPdf;
    receiptArtifact = findArtifact(bundle, 'evidence_receipt') || receiptArtifact;
    if (!signedPdf || !receiptArtifact) {
      throw completionError('COMPLETION_ARTIFACTS_NOT_PERSISTED', '最終 PDF 與證據收據尚未全部寫入。', 500);
    }

    const completed = await signing.completeSigning({
      sessionId,
      actorId: authority.actor,
      idempotencyKey: `engineering-contract-complete:${authority.tenant.key}:${sessionId}:${artifactHash(signedPdf)}:${artifactHash(receiptArtifact)}`,
      finalArtifactHash: sha256(artifactHash(signedPdf), 'signed_pdf.sha256'),
      finalArtifactRef: artifactRef(signedPdf),
      requestMeta: options.requestMeta || {},
    });
    if (text(completed?.status) !== 'completed') {
      throw completionError('COMPLETION_NOT_PERSISTED', '簽署流程未完成最終 CAS。', 409);
    }
    return publicResult(bundle, signedPdf, receiptArtifact, { retried, idempotent: completed.idempotent === true });
  }

  return Object.freeze({ completeContract, confirmAndArchive: completeContract });
}

export const __test = Object.freeze({ normalizeBundle, taipeiTime, rejectClientAuthority, bufferResult });

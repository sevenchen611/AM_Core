import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createContractCompletionService } from '../modules/construction/contract-completion.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const signatureBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
const signatureHash = digest(signatureBytes);
const identityFrontBytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('identity-front-photo')]);
const identityBackBytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('identity-back-photo')]);
const identityFrontHash = digest(identityFrontBytes);
const identityBackHash = digest(identityBackBytes);
const contractBodyBytes = Buffer.from('%PDF-1.7 contract body');
const contractBodyHash = digest(contractBodyBytes);
const counterpartyDetails = {
  name: '王大明', identityNumber: 'A123456789', address: '臺中市西屯區工程路 1 號',
};
const documentHash = digest('issued-pdf');
const bundleHash = digest('frozen-bundle');
const issuedHash = digest('issued-artifact');
const eventHash = (name) => digest(`event:${name}`);

function fixture() {
  const bundle = {
    contract: {
      id: 'contract-1', projectId: 'project-1', projectCode: 'P01',
      contractNumber: 'P01-MASON-001', title: '泥作工程合約',
    },
    version: {
      id: 'version-1', contractId: 'contract-1', versionNo: 1,
      bundleSha256: bundleHash,
      snapshot: { documentPackage: { contractBody: {
        fileId: 'drive-body-1', name: 'contract-body.pdf', mimeType: 'application/pdf', sha256: contractBodyHash,
      } } },
    },
    session: {
      externalSessionId: 'session-1', versionId: 'version-1', status: 'signed',
      documentSha256: documentHash, lineGroupId: 'C-group-1', signerLineUserId: 'U-signer-1',
      issuedAt: '2026-08-28T01:00:00.000Z',
    },
    signatureEvidence: {
      signatureDriveFileId: 'drive-signature-1', signatureSha256: signatureHash,
      ipAddress: '203.0.113.45', consentVersion: 'engineering-contract-consent-v3-party-details',
      reviewAcknowledged: true, receivedAt: '2026-08-28T01:06:00.000Z',
      signedAt: '2026-08-28T01:06:00.000Z',
    },
    events: [
      { sequenceNo: 1, type: 'issued', at: '2026-08-28T01:00:00.000Z', eventHash: eventHash('issued') },
      { sequenceNo: 2, type: 'sent', at: '2026-08-28T01:01:00.000Z', eventHash: eventHash('sent') },
      {
        sequenceNo: 3, type: 'signed', at: '2026-08-28T01:06:00.000Z', eventHash: eventHash('signed'),
        ip: '203.0.113.45',
        metadata: {
          identitySource: 'verified_liff', membershipVerified: true,
          specifiedUserMatched: true, reviewAcknowledged: true,
        },
      },
      { sequenceNo: 4, type: 'submission_received', at: '2026-08-28T01:06:00.000Z', eventHash: eventHash('received') },
    ],
    artifacts: [
      { artifactKind: 'issued_pdf', driveFileId: 'drive-issued-1', sha256: issuedHash, byteSize: 123 },
    ],
  };
  const state = {
    id: 'session-1', status: 'signed', contractId: 'contract-1', projectId: 'project-1',
    documentHash, lineGroupId: 'C-group-1', signerLineUserId: 'U-signer-1',
    submission: {
      signatureHash, submissionRef: 'drive-signature-1',
      counterpartyDetails,
      identityDocuments: {
        front: { hash: identityFrontHash, ref: 'drive-id-front', contentType: 'image/png', byteSize: identityFrontBytes.length, receivedAt: '2026-08-28T01:05:00.000Z' },
        back: { hash: identityBackHash, ref: 'drive-id-back', contentType: 'image/png', byteSize: identityBackBytes.length, receivedAt: '2026-08-28T01:05:01.000Z' },
      },
      consentVersion: 'engineering-contract-consent-v3-party-details', reviewAcknowledged: true,
    },
    confirmation: null,
  };
  return { bundle, state };
}

const { bundle, state } = fixture();
const calls = [];
let failFirstPdf = true;
let receiptPayload;
let signedPdfPayload;

const contractStore = {
  async getSigningBundle(tenant, sessionId) {
    calls.push(`bundle:${tenant.key}:${sessionId}`);
    return bundle;
  },
  async recordArtifact(tenant, input) {
    calls.push(`record:${input.artifactKind}`);
    const item = { ...input };
    bundle.artifacts.push(item);
    return item;
  },
};

const signingService = {
  async getSession(id) {
    calls.push(`session:${id}`);
    return state;
  },
  async confirmSubmission(input) {
    calls.push('confirm');
    assert.equal(input.actorId, 'admin@example.com');
    state.status = 'confirmed';
    state.confirmation = { confirmedAt: '2026-08-28T01:10:00.000Z', actorId: input.actorId };
    bundle.session.status = 'confirmed';
    bundle.events.push({
      sequenceNo: 5, type: 'confirmed', at: state.confirmation.confirmedAt,
      eventHash: eventHash('confirmed'), metadata: {},
    });
    return { ok: true, status: 'confirmed' };
  },
  async completeSigning(input) {
    calls.push('complete');
    assert.equal(input.actorId, 'admin@example.com');
    assert.equal(input.finalArtifactHash, bundle.artifacts.find((item) => item.artifactKind === 'signed_pdf').sha256);
    assert.ok(bundle.artifacts.some((item) => item.artifactKind === 'signed_pdf'));
    assert.ok(bundle.artifacts.some((item) => item.artifactKind === 'evidence_receipt'));
    state.status = 'completed';
    state.completion = {
      finalArtifactHash: input.finalArtifactHash,
      finalArtifactRef: input.finalArtifactRef,
    };
    bundle.session.status = 'completed';
    return { ok: true, status: 'completed', idempotent: false };
  },
};

const artifactService = {
  async renderPdf(kind, payload, idempotencyKey) {
    calls.push(`render:${kind}`);
    assert.equal(kind, 'signed_pdf');
    assert.match(idempotencyKey, /session-1/);
    if (failFirstPdf) {
      failFirstPdf = false;
      throw Object.assign(new Error('renderer temporarily unavailable'), { code: 'PDF_RENDER_FAILED' });
    }
    signedPdfPayload = payload;
    const buffer = Buffer.from('%PDF-1.7 signed');
    return { buffer, sha256: digest(buffer), byteSize: buffer.length };
  },
  async storePdf({ rendered }) {
    calls.push('storePdf');
    return { driveFileId: 'drive-signed-1', sha256: rendered.sha256, byteSize: rendered.byteSize };
  },
  async storeEvidenceReceipt({ receipt }) {
    calls.push('storeReceipt');
    receiptPayload = receipt;
    const bytes = Buffer.from(JSON.stringify(receipt));
    return { driveFileId: 'drive-receipt-1', sha256: digest(bytes), byteSize: bytes.length };
  },
};

const deps = {
  contractStore,
  contractSigningService: signingService,
  artifactService,
  async downloadFromDrive(ref) {
    calls.push(`download:${ref}`);
    if (ref === 'drive-body-1') return { buffer: contractBodyBytes, mimeType: 'application/pdf' };
    if (ref === 'drive-id-front') return { buffer: identityFrontBytes, mimeType: 'image/jpeg' };
    if (ref === 'drive-id-back') return { buffer: identityBackBytes, mimeType: 'image/jpeg' };
    return { buffer: signatureBytes, mimeType: 'image/png' };
  },
};

const service = createContractCompletionService(deps, {
  clock: () => new Date('2026-08-28T01:11:12.000Z'),
  bodyExtractor: async () => ({ text: '工程合約本文', html: '<p>工程合約本文</p>' }),
});
const context = {
  tenant: { key: 'engineering' }, actor: 'admin@example.com',
  scope: { projectIds: ['project-1'] },
};

// Confirmation is durable before rendering. A transient PDF failure leaves the
// session confirmed, and a retry does not confirm or sign again.
await assert.rejects(
  service.completeContract(context, { sessionId: 'session-1' }),
  (error) => error.code === 'PDF_RENDER_FAILED',
);
assert.equal(state.status, 'confirmed');
assert.equal(calls.filter((item) => item === 'confirm').length, 1);
assert.equal(calls.filter((item) => item === 'complete').length, 0);

const result = await service.completeContract(context, { sessionId: 'session-1' });
assert.equal(result.status, 'completed');
assert.equal(result.retried, true);
assert.equal(calls.filter((item) => item === 'confirm').length, 1);
assert.ok(calls.indexOf('record:signed_pdf') < calls.indexOf('record:evidence_receipt'));
assert.ok(calls.indexOf('record:evidence_receipt') < calls.indexOf('complete'));

// Renderer receives the signature bytes and every contract evidence time.
assert.equal(signedPdfPayload.signature.base64, signatureBytes.toString('base64'));
assert.equal(signedPdfPayload.signature.sha256, signatureHash);
assert.equal(signedPdfPayload.ipAddress, '203.0.113.45');
assert.equal(signedPdfPayload.bundleHash, bundleHash);
assert.deepEqual(signedPdfPayload.counterpartyDetails, counterpartyDetails);
assert.deepEqual(Object.keys(signedPdfPayload.times).sort(), [
  'confirmedAt', 'issuedAt', 'receivedAt', 'sentAt', 'signedAt',
]);
assert.equal(signedPdfPayload.verification.liffIdentityVerified, true);
assert.equal(signedPdfPayload.verification.groupMembershipVerified, true);
assert.equal(signedPdfPayload.verification.designatedUserMatched, true);
assert.equal(signedPdfPayload.verification.identityDocumentsVerified, true);
assert.equal(signedPdfPayload.verification.identityDocumentHashes.front, identityFrontHash);
assert.equal(signedPdfPayload.verification.identityDocumentHashes.back, identityBackHash);
assert.equal(signedPdfPayload.identityDocuments.front.base64, identityFrontBytes.toString('base64'));
assert.equal(signedPdfPayload.identityDocuments.back.base64, identityBackBytes.toString('base64'));
assert.equal(signedPdfPayload.identityDocuments.front.sha256, identityFrontHash);
assert.equal(signedPdfPayload.identityDocuments.back.sha256, identityBackHash);
assert.equal(signedPdfPayload.confirmedBy, 'admin@example.com');

// Receipt has dual timezone timestamps, the confirmed hash-chain head,
// verification evidence, and the issued/signed/signature artifact hashes.
assert.equal(receiptPayload.generatedAt.utc, '2026-08-28T01:11:12.000Z');
assert.equal(receiptPayload.generatedAt.asiaTaipei, '2026-08-28T09:11:12+08:00');
assert.equal(receiptPayload.eventChain.headHash, eventHash('confirmed'));
assert.equal(receiptPayload.verification.liffIdentityVerified, true);
assert.equal(receiptPayload.verification.groupMembershipVerified, true);
assert.equal(receiptPayload.verification.designatedUserMatched, true);
assert.equal(receiptPayload.verification.counterpartyDetailsHash, digest(JSON.stringify({
  address: counterpartyDetails.address,
  identityNumber: counterpartyDetails.identityNumber,
  name: counterpartyDetails.name,
})));
assert.ok(receiptPayload.artifacts.some((item) => item.kind === 'issued_pdf' && item.sha256 === issuedHash));
assert.ok(receiptPayload.artifacts.some((item) => item.kind === 'signed_pdf'));
assert.ok(receiptPayload.artifacts.some((item) => item.kind === 'signature_image' && item.sha256 === signatureHash));
assert.ok(receiptPayload.artifacts.some((item) => item.kind === 'identity_document_front' && item.sha256 === identityFrontHash));
assert.ok(receiptPayload.artifacts.some((item) => item.kind === 'identity_document_back' && item.sha256 === identityBackHash));

// Public output never exposes sensitive evidence.
const publicJson = JSON.stringify(result);
assert.doesNotMatch(publicJson, /203\.0\.113\.45/);
assert.doesNotMatch(publicJson, new RegExp(signatureBytes.toString('base64')));
assert.doesNotMatch(publicJson, /drive-signature-1/);
assert.doesNotMatch(publicJson, /token/i);

// Completed requests are idempotent and do not recreate artifacts.
const callCount = calls.length;
const repeated = await service.completeContract(context, { sessionId: 'session-1' });
assert.equal(repeated.idempotent, true);
assert.equal(calls.slice(callCount).some((item) => item.startsWith('render:') || item.startsWith('record:')), false);

// Scope is checked before confirmation, rendering, downloading or storage.
const scoped = fixture();
let privilegedCall = false;
const denied = createContractCompletionService({
  contractStore: {
    async getSigningBundle() { return scoped.bundle; },
    async recordArtifact() { privilegedCall = true; },
  },
  contractSigningService: {
    async getSession() { privilegedCall = true; return scoped.state; },
    async confirmSubmission() { privilegedCall = true; },
    async completeSigning() { privilegedCall = true; },
  },
  artifactService,
  async downloadFromDrive() { privilegedCall = true; },
});
await assert.rejects(
  denied.completeContract({ tenant: { key: 'engineering' }, actor: 'admin', scope: { projectIds: ['other'] } }, { sessionId: 'session-1' }),
  (error) => error.code === 'PROJECT_SCOPE_DENIED',
);
assert.equal(privilegedCall, false);

await assert.rejects(
  service.completeContract(context, { sessionId: 'session-1', actorId: 'browser-user' }),
  (error) => error.code === 'COMPLETION_AUTHORITY_OVERRIDE_FORBIDDEN',
);

console.log('engineering contract completion dry-run: PASS');

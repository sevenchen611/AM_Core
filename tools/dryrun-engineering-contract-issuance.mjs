import assert from 'node:assert/strict';
import { createContractIssuanceService } from '../modules/construction/contract-issuance.js';

const HASH = 'a'.repeat(64);
const PDF_HASH = 'b'.repeat(64);
const FILE_ID = 'driveFile_1234567890';
const calls = [];
const context = { tenant: { key: 'engineering' }, actor: 'server-admin-7', scope: ['project-1'] };

function fixture(overrides = {}) {
  const contract = {
    id: 'contract-1', projectId: 'project-1', projectCode: 'P01', title: '泥作合約',
    contractNumber: 'C-001', groupBindingId: 'notion-group-1',
    counterpartyCompany: '工班公司', counterpartyTitle: '負責人',
  };
  const frozen = {
    id: 'version-1', contractId: contract.id, versionNo: 3, status: 'frozen',
    attachmentManifestHash: HASH,
  };
  const issued = {
    ...frozen, status: 'issued', issuedPdfDriveFileId: FILE_ID, issuedPdfSha256: PDF_HASH,
  };
  const managementService = {
    async issueReadiness(receivedContext, selector) {
      calls.push(['readiness', receivedContext, selector]);
      return overrides.readiness || { ready: true, blockers: [], contract, version: frozen, packageValidation: { valid: true } };
    },
    async getContractDetail(receivedContext, selector) {
      calls.push(['detail', receivedContext, selector]);
      return { contract, versions: [issued] };
    },
  };
  const artifactService = {
    async renderPdf(kind, payload, key) {
      calls.push(['render', kind, payload, key]);
      return { buffer: Buffer.from('%PDF-test'), sha256: PDF_HASH, byteSize: 9 };
    },
    async storePdf(input) {
      calls.push(['storePdf', input]);
      return { driveFileId: FILE_ID, driveUrl: 'https://evil.invalid/ignored', sha256: PDF_HASH, byteSize: 9 };
    },
  };
  const authorityResolver = async (_deps, input) => {
    calls.push(['authority', input]);
    assert.equal(input.groupBindingId, contract.groupBindingId);
    assert.equal(input.projectId, contract.projectId);
    return {
      groupBindingId: contract.groupBindingId,
      lineGroupId: 'C-authoritative-group',
      signerLineUserId: input.signerLineUserId,
      signerName: '王師傅',
    };
  };
  const sessions = [];
  const signingFactory = (_deps, storageContext) => {
    calls.push(['signingFactory', storageContext]);
    return {
      async issueAndSend(input) {
        calls.push(['issueAndSend', input]);
        sessions.push(input);
        if (overrides.failLine && sessions.length === 1) {
          const error = Object.assign(new Error('LINE rejected'), { code: 'LINE_SEND_NOT_ACCEPTED' });
          throw error;
        }
        return { sessionId: `session-${sessions.length}`, token: 'must-not-leak', protectedLink: 'must-not-leak', sent: true, sentAt: '2026-08-28T10:00:00.000Z', expiresAt: '2026-09-04T10:00:00.000Z' };
      },
    };
  };
  const deps = {
    contractStore: {
      async issueVersion(tenant, input) {
        calls.push(['issueVersion', tenant, input]);
        return { value: { ...issued, issuedAt: input.issuedAt, issuedBy: input.actor } };
      },
    },
  };
  return {
    service: createContractIssuanceService(deps, {
      managementService, artifactService, authorityResolver, signingFactory,
      clock: () => new Date('2026-08-28T09:00:00.000Z'),
    }),
    sessions,
  };
}

// Browser authority fields are rejected before readiness, rendering, or LINE.
{
  calls.length = 0;
  const { service } = fixture();
  await assert.rejects(
    service.issueFrozenVersion(context, {
      contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer',
      groupBindingId: 'forged-group', lineGroupId: 'C-attacker', actor: 'attacker',
    }),
    (error) => error.code === 'SIGNING_GROUP_OVERRIDE_FORBIDDEN' && error.statusCode === 403,
  );
  assert.equal(calls.length, 0);
}

// Readiness is the first operation and blocks all downstream side effects.
{
  calls.length = 0;
  const { service } = fixture({ readiness: { ready: false, blockers: [{ code: 'MISSING_QUOTATION' }] } });
  await assert.rejects(
    service.issueFrozenVersion(context, { contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer', actor: 'attacker' }),
    (error) => error.code === 'CONTRACT_NOT_READY_FOR_ISSUE'
      && error.details.blockers[0].code === 'MISSING_QUOTATION',
  );
  assert.deepEqual(calls.map((item) => item[0]), ['readiness']);
  assert.equal(calls[0][1].actor, 'server-admin-7');
}

// Successful issuance uses only authoritative actor/group and exact stored PDF.
{
  calls.length = 0;
  const { service, sessions } = fixture();
  const result = await service.issueFrozenVersion(context, {
    contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer', actor: 'attacker',
  });
  assert.deepEqual(calls.map((item) => item[0]), [
    'readiness', 'authority', 'signingFactory', 'render', 'storePdf', 'issueVersion', 'issueAndSend',
  ]);
  const issueCall = calls.find((item) => item[0] === 'issueVersion')[2];
  assert.equal(issueCall.actor, 'server-admin-7');
  assert.equal(issueCall.issuedPdfDriveFileId, FILE_ID);
  assert.equal(issueCall.issuedPdfSha256, PDF_HASH);
  assert.equal(sessions[0].lineGroupId, 'C-authoritative-group');
  assert.equal(sessions[0].signerLineUserId, 'U-signer');
  assert.equal(sessions[0].documentHash, PDF_HASH);
  assert.equal(sessions[0].documentRef, `https://drive.google.com/file/d/${FILE_ID}/view`);
  assert.equal(result.documentHash, PDF_HASH);
  assert.equal(result.documentRef, sessions[0].documentRef);
  assert.equal('token' in result, false);
  assert.equal('protectedLink' in result, false);
}

// A LINE failure leaves the already-issued version reusable. Retry does not
// render, upload, or call issueVersion again and sends a fresh session against
// the exact same immutable file reference and hash.
{
  calls.length = 0;
  const { service, sessions } = fixture({ failLine: true });
  await assert.rejects(
    service.issueFrozenVersion(context, { contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer' }),
    (error) => error.code === 'LINE_SEND_NOT_ACCEPTED',
  );
  const beforeRetry = calls.length;
  const retried = await service.retryIssuedVersionSigning(context, {
    contractId: 'contract-1', versionId: 'version-1', signerLineUserId: 'U-signer', actor: 'attacker',
  });
  const retryCalls = calls.slice(beforeRetry).map((item) => item[0]);
  assert.deepEqual(retryCalls, ['detail', 'authority', 'signingFactory', 'issueAndSend']);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].documentHash, sessions[1].documentHash);
  assert.equal(sessions[0].documentRef, sessions[1].documentRef);
  assert.equal(retried.retried, true);
  assert.equal(retried.documentHash, PDF_HASH);
}

console.log('engineering contract issuance dry-run passed');

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CONTRACT_SIGNING_TOKEN_TTL_MS,
  ContractSigningError,
  buildProtectedSigningLink,
  contractSigningSecurityHeaders,
  createContractSigningService,
  createMemoryContractSigningStorage,
  getTrustedClientIp,
  hashSigningToken,
} from '../modules/construction/contract-signing.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const tokenPepper = 'test-only-engineering-contract-token-pepper-2026';
const identityDocuments = {
  front: { hash: digest('id-front'), ref: 'object://identity/front', contentType: 'image/jpeg', byteSize: 1234, receivedAt: '2026-08-28T01:05:00.000Z' },
  back: { hash: digest('id-back'), ref: 'object://identity/back', contentType: 'image/jpeg', byteSize: 1250, receivedAt: '2026-08-28T01:05:01.000Z' },
};
const counterpartyDetails = {
  name: '王大明', identityNumber: 'A123456789', address: '臺中市西屯區工程路 1 號',
};
assert.notEqual(hashSigningToken('same-token', tokenPepper), hashSigningToken('same-token', `${tokenPepper}-other`));
assert.throws(() => hashSigningToken('same-token'), (error) => error.code === 'TOKEN_PEPPER_REQUIRED');

async function expectSigningError(action, code, status) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof ContractSigningError, true);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

function createFakeClock(start = '2026-08-28T01:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (milliseconds) => { current += milliseconds; },
    iso: () => new Date(current).toISOString(),
  };
}

function createDeterministicRandom() {
  let counter = 0;
  return (size) => {
    counter += 1;
    const output = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) output[index] = (counter + index * 17) % 256;
    return output;
  };
}

function createFakeLine() {
  const pushes = [];
  const identities = new Map([
    ['credential-signer', { verified: true, userId: 'U-signer' }],
    ['credential-other', { verified: true, userId: 'U-other' }],
    ['credential-invalid', { verified: false, userId: '' }],
  ]);
  const memberships = new Set();
  const queuedResults = [];
  return {
    pushes,
    memberships,
    queuedResults,
    async verifyLiffIdentity({ credential }) {
      return identities.get(credential) || { verified: false, userId: '' };
    },
    async isGroupMember({ groupId, userId }) {
      return memberships.has(`${groupId}:${userId}`);
    },
    async pushGroup(payload) {
      pushes.push(structuredClone(payload));
      return queuedResults.length
        ? queuedResults.shift()
        : { accepted: true, messageId: `line-message-${pushes.length}` };
    },
  };
}

const clock = createFakeClock();
const storage = createMemoryContractSigningStorage();
const line = createFakeLine();
line.memberships.add('C-engineering:U-signer');
line.memberships.add('C-engineering:U-other');

const service = createContractSigningService({
  storage,
  line,
  clock,
  randomBytes: createDeterministicRandom(),
  baseUrl: 'https://engineering-am.example.test',
  signingPath: '/contracts/sign',
  tokenPepper,
  isTrustedProxy: (ip) => ip === '10.0.0.1' || ip === '10.0.0.2',
});

const documentHash = digest('immutable engineering contract v1');
const signatureHash = digest('signature-object-v1');
const finalArtifactHash = digest('final-evidence-bundle-v1');

// Durable outbox retries reconstruct the same opaque token/session from a
// server-owned idempotency key without persisting raw token material.
{
  const retryStorage = createMemoryContractSigningStorage();
  const retryLine = createFakeLine();
  const retryService = createContractSigningService({
    storage: retryStorage, line: retryLine, clock: createFakeClock(),
    randomBytes: createDeterministicRandom(), baseUrl: 'https://engineering-am.example.test',
    signingPath: '/contracts/sign', tokenPepper,
  });
  const input = {
    projectId: 'project-001', contractId: 'contract-idempotent', documentRef: 'object://durable',
    documentHash, lineGroupId: 'C-engineering', signerLineUserId: 'U-signer', actorId: 'admin-seven',
    idempotencyKey: 'durable-outbox-invitation-contract-idempotent-v1',
  };
  const first = await retryService.issueAndSend(input);
  const second = await retryService.issueAndSend(input);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.token, first.token);
  assert.equal(retryLine.pushes.length, 1);
}

// Issue and send through the project LINE group. The raw token is returned once
// to the caller, while storage receives only its SHA-256 digest.
const issued = await service.issueAndSend({
  projectId: 'project-001',
  contractId: 'contract-001',
  documentRef: 'object://contracts/contract-001/version-1',
  documentHash,
  lineGroupId: 'C-engineering',
  signerLineUserId: 'U-signer',
  actorId: 'admin-seven',
});
assert.equal(issued.sent, true);
assert.equal(issued.expiresAt, new Date(Date.parse('2026-08-28T01:00:00.000Z') + CONTRACT_SIGNING_TOKEN_TTL_MS).toISOString());
assert.match(issued.token, /^[A-Za-z0-9_-]{40,}$/);
assert.match(issued.protectedLink, /^https:\/\/engineering-am\.example\.test\/contracts\/sign#token=/);
assert.equal(new URL(issued.protectedLink).search, '');

let session = await service.getSession(issued.sessionId);
assert.equal(session.tokenHash, hashSigningToken(issued.token, tokenPepper));
assert.equal(Object.hasOwn(session, 'token'), false);
assert.deepEqual(session.events.map((event) => event.type), ['issued', 'sent']);
assert.equal(session.status, 'sent');
const serializedStorage = JSON.stringify(await storage.dump());
assert.equal(serializedStorage.includes(issued.token), false);
assert.equal(serializedStorage.includes(issued.protectedLink), false);

const invitePush = line.pushes[0];
assert.equal(invitePush.groupId, 'C-engineering');
assert.equal(invitePush.contentClass, 'status_and_protected_link_only');
assert.equal(invitePush.message.includes(issued.protectedLink), true);
assert.equal(invitePush.message.includes('不代表對方已讀'), true);
assert.equal(invitePush.message.includes('不代表對方已讀或平台已送達'), true);
assert.equal(invitePush.message.includes('群組的成員'), true);
assert.equal(invitePush.message.includes('只有指定簽署人可以簽署'), true);
assert.equal(invitePush.message.includes('object://contracts'), false);
assert.equal(invitePush.message.includes(documentHash), false);
assert.equal(session.events.some((event) => event.type === 'read'), false);
assert.equal(session.events.some((event) => event.type === 'delivery_ack'), false);
assert.equal(Object.hasOwn(session.events.find((event) => event.type === 'sent').metadata, 'delivered'), false);

// Sending is idempotent and the adapter receives a stable provider idempotency key.
const sendsBeforeRetry = line.pushes.length;
const resent = await service.sendInvitation({ sessionId: issued.sessionId, token: issued.token });
assert.equal(resent.idempotent, true);
assert.equal(line.pushes.length, sendsBeforeRetry);

// A rejected provider request must not create a `sent` event.
const rejected = await service.issueSigningRequest({
  projectId: 'project-001', contractId: 'contract-rejected',
  documentRef: 'object://contracts/rejected/v1', documentHash,
  lineGroupId: 'C-engineering', signerLineUserId: 'U-signer', actorId: 'admin-seven',
});
line.queuedResults.push({ accepted: false });
await expectSigningError(
  () => service.sendInvitation({ sessionId: rejected.sessionId, token: rejected.token }),
  'LINE_SEND_NOT_ACCEPTED',
  502,
);
assert.deepEqual((await service.getSession(rejected.sessionId)).events.map((event) => event.type), ['issued']);

// Only an explicit provider receipt may become delivery_ack. A provider
// acceptance by itself is deliberately not treated as delivery or read.
await expectSigningError(
  () => service.recordProviderDeliveryAck({ sessionId: issued.sessionId, receipt: { acknowledged: false, receiptId: 'r-0' } }),
  'PROVIDER_RECEIPT_REQUIRED',
  400,
);
const ack = await service.recordProviderDeliveryAck({
  sessionId: issued.sessionId,
  receipt: { acknowledged: true, receiptId: 'provider-receipt-1', at: clock.iso() },
});
assert.equal(ack.idempotent, false);
assert.equal((await service.recordProviderDeliveryAck({
  sessionId: issued.sessionId,
  receipt: { acknowledged: true, receiptId: 'provider-receipt-1', at: clock.iso() },
})).idempotent, true);
session = await service.getSession(issued.sessionId);
assert.equal(session.events.filter((event) => event.type === 'delivery_ack').length, 1);

// LIFF identity and current LINE group membership are both mandatory.
const trustedRequest = {
  remoteAddress: '10.0.0.2',
  headers: {
    'x-forwarded-for': '203.0.113.45, 10.0.0.1',
    'user-agent': 'LINE/15.0 LIFF test',
  },
};
await expectSigningError(
  () => service.openSigningRequest({ token: issued.token, liffCredential: 'credential-invalid', requestMeta: trustedRequest }),
  'LIFF_IDENTITY_INVALID',
  401,
);
const groupMemberView = await service.openSigningRequest({
  token: issued.token,
  liffCredential: 'credential-other',
  requestMeta: trustedRequest,
});
assert.equal(groupMemberView.canSign, false);
assert.equal(groupMemberView.canInspectSigning, true);
assert.equal(groupMemberView.accessMode, 'signer_inspection_read_only');
assert.equal(groupMemberView.status, 'sent');
assert.equal(groupMemberView.idempotent, true);
session = await service.getSession(issued.sessionId);
assert.equal(session.status, 'sent');
assert.equal(session.events.some((event) => event.type === 'first_opened'), false);
line.memberships.delete('C-engineering:U-other');
await expectSigningError(
  () => service.openSigningRequest({ token: issued.token, liffCredential: 'credential-other', requestMeta: trustedRequest }),
  'GROUP_MEMBERSHIP_REQUIRED',
  403,
);
line.memberships.add('C-engineering:U-other');
line.memberships.delete('C-engineering:U-signer');
await expectSigningError(
  () => service.openSigningRequest({ token: issued.token, liffCredential: 'credential-signer', requestMeta: trustedRequest }),
  'GROUP_MEMBERSHIP_REQUIRED',
  403,
);
line.memberships.add('C-engineering:U-signer');

const opened = await service.openSigningRequest({
  token: issued.token,
  liffCredential: 'credential-signer',
  requestMeta: trustedRequest,
});
assert.equal(opened.status, 'opened');
assert.equal(opened.idempotent, false);
assert.equal(opened.documentHash, documentHash);
assert.equal(opened.canSign, true);
assert.equal(opened.accessMode, 'signer');
assert.equal((await service.openSigningRequest({
  token: issued.token,
  liffCredential: 'credential-signer',
  requestMeta: trustedRequest,
})).idempotent, true);
session = await service.getSession(issued.sessionId);
assert.equal(session.events.filter((event) => event.type === 'first_opened').length, 1);
const firstOpened = session.events.find((event) => event.type === 'first_opened');
assert.equal(firstOpened.ip, '203.0.113.45');
assert.equal(firstOpened.actorId, 'U-signer');
assert.equal(firstOpened.metadata.membershipVerified, true);

// A verified group member may inspect the PDF but still cannot submit any
// signature or identity evidence for the designated signer.
await expectSigningError(
  () => service.submitSignature({ token: issued.token, liffCredential: 'credential-other' }),
  'SIGNER_MISMATCH',
  403,
);

// Membership is checked again on submission, not trusted from an earlier open.
line.memberships.delete('C-engineering:U-signer');
await expectSigningError(
  () => service.submitSignature({
    token: issued.token, liffCredential: 'credential-signer', idempotencyKey: 'submission-1',
    documentHash, signatureHash, submissionRef: 'object://submissions/submission-1', requestMeta: trustedRequest,
  }),
  'GROUP_MEMBERSHIP_REQUIRED',
  403,
);
line.memberships.add('C-engineering:U-signer');
await expectSigningError(
  () => service.submitSignature({
    token: issued.token, liffCredential: 'credential-signer', idempotencyKey: 'submission-1',
    documentHash: digest('tampered document'), signatureHash,
    submissionRef: 'object://submissions/submission-1', requestMeta: trustedRequest,
  }),
  'DOCUMENT_VERSION_MISMATCH',
  409,
);

const pushesBeforeSubmission = line.pushes.length;
const submitted = await service.submitSignature({
  token: issued.token,
  liffCredential: 'credential-signer',
  idempotencyKey: 'submission-1',
  documentHash,
  signatureHash,
  submissionRef: 'object://submissions/submission-1',
  counterpartyDetails,
  identityDocuments,
  reviewAcknowledged: true,
  requestMeta: trustedRequest,
});
assert.equal(submitted.status, 'signed');
assert.equal(submitted.idempotent, false);
assert.equal(line.pushes.length, pushesBeforeSubmission + 1);
const submittedStatusMessage = line.pushes.at(-1).message;
for (const sensitive of [documentHash, signatureHash, '203.0.113.45', 'object://submissions', '.pdf']) {
  assert.equal(submittedStatusMessage.includes(sensitive), false);
}

session = await service.getSession(issued.sessionId);
assert.equal(session.status, 'signed');
assert.equal(session.submission.documentHash, documentHash);
assert.deepEqual(session.submission.counterpartyDetails, counterpartyDetails);
assert.deepEqual(session.submission.identityDocuments, identityDocuments);
assert.deepEqual(
  session.events.filter((event) => ['signed', 'submission_received'].includes(event.type)).map((event) => event.type),
  ['signed', 'submission_received'],
);
assert.equal(session.events.find((event) => event.type === 'signed').ip, '203.0.113.45');

const eventCountAfterSubmission = session.events.length;
const pushCountAfterSubmission = line.pushes.length;
assert.equal((await service.submitSignature({
  token: issued.token,
  liffCredential: 'credential-signer',
  idempotencyKey: 'submission-1',
  documentHash,
  signatureHash,
  submissionRef: 'object://submissions/submission-1',
  requestMeta: trustedRequest,
})).idempotent, true);
assert.equal((await service.getSession(issued.sessionId)).events.length, eventCountAfterSubmission);
assert.equal(line.pushes.length, pushCountAfterSubmission);
await expectSigningError(
  () => service.submitSignature({
    token: issued.token, liffCredential: 'credential-signer', idempotencyKey: 'submission-replay',
    documentHash, signatureHash, submissionRef: 'object://submissions/submission-replay', requestMeta: trustedRequest,
  }),
  'TOKEN_REPLAYED',
  409,
);
await expectSigningError(
  () => service.openSigningRequest({ token: issued.token, liffCredential: 'credential-signer', requestMeta: trustedRequest }),
  'TOKEN_ALREADY_USED',
  409,
);

// Confirmation and completion are separate, durable, idempotent events. The
// final artifact stays in protected storage and is never pushed to the group.
const untrustedAdminRequest = {
  remoteAddress: '198.51.100.8',
  headers: { 'x-forwarded-for': '192.0.2.99', 'user-agent': 'Engineering AM Admin' },
};
const confirmed = await service.confirmSubmission({
  sessionId: issued.sessionId,
  actorId: 'reviewer-seven',
  idempotencyKey: 'confirm-1',
  requestMeta: untrustedAdminRequest,
});
assert.equal(confirmed.status, 'confirmed');
assert.equal(confirmed.idempotent, false);
assert.equal((await service.confirmSubmission({
  sessionId: issued.sessionId,
  actorId: 'reviewer-seven',
  idempotencyKey: 'confirm-1',
  requestMeta: untrustedAdminRequest,
})).idempotent, true);
session = await service.getSession(issued.sessionId);
assert.equal(session.events.filter((event) => event.type === 'confirmed').length, 1);
assert.equal(session.events.find((event) => event.type === 'confirmed').ip, '198.51.100.8');

const completed = await service.completeSigning({
  sessionId: issued.sessionId,
  actorId: 'reviewer-seven',
  idempotencyKey: 'complete-1',
  finalArtifactHash,
  finalArtifactRef: 'object://evidence/contract-001-final.pdf',
  requestMeta: untrustedAdminRequest,
});
assert.equal(completed.status, 'completed');
assert.equal(completed.idempotent, false);
assert.equal((await service.completeSigning({
  sessionId: issued.sessionId,
  actorId: 'reviewer-seven',
  idempotencyKey: 'complete-1',
  finalArtifactHash,
  finalArtifactRef: 'object://evidence/contract-001-final.pdf',
  requestMeta: untrustedAdminRequest,
})).idempotent, true);
session = await service.getSession(issued.sessionId);
assert.equal(session.status, 'completed');
assert.deepEqual(
  session.events
    .filter((event) => ['issued', 'sent', 'first_opened', 'signed', 'submission_received', 'confirmed', 'completed'].includes(event.type))
    .map((event) => event.type),
  ['issued', 'sent', 'first_opened', 'signed', 'submission_received', 'confirmed', 'completed'],
);
for (const push of line.pushes) {
  if (push.contentClass === 'status_and_protected_link_only') continue;
  for (const sensitive of [documentHash, signatureHash, finalArtifactHash, '203.0.113.45', '198.51.100.8', '.pdf']) {
    assert.equal(push.message.includes(sensitive), false);
  }
}

// Revocation is idempotent and blocks both open and submit.
const revocable = await service.issueAndSend({
  projectId: 'project-001', contractId: 'contract-revoked',
  documentRef: 'object://contracts/revoked/v1', documentHash,
  lineGroupId: 'C-engineering', signerLineUserId: 'U-signer', actorId: 'admin-seven',
});
assert.equal((await service.revokeSigningToken({
  sessionId: revocable.sessionId,
  actorId: 'admin-seven',
  idempotencyKey: 'revoke-1',
  reason: 'contract_replaced',
})).idempotent, false);
assert.equal((await service.revokeSigningToken({
  sessionId: revocable.sessionId,
  actorId: 'admin-seven',
  idempotencyKey: 'revoke-1',
  reason: 'contract_replaced',
})).idempotent, true);
await expectSigningError(
  () => service.openSigningRequest({ token: revocable.token, liffCredential: 'credential-signer', requestMeta: trustedRequest }),
  'TOKEN_REVOKED',
  410,
);

// Expiration is exactly seven days by default and creates one durable event.
const expiring = await service.issueAndSend({
  projectId: 'project-001', contractId: 'contract-expiring',
  documentRef: 'object://contracts/expiring/v1', documentHash,
  lineGroupId: 'C-engineering', signerLineUserId: 'U-signer', actorId: 'admin-seven',
});
clock.advance(CONTRACT_SIGNING_TOKEN_TTL_MS + 1);
await expectSigningError(
  () => service.openSigningRequest({ token: expiring.token, liffCredential: 'credential-signer', requestMeta: trustedRequest }),
  'TOKEN_EXPIRED',
  410,
);
await expectSigningError(
  () => service.openSigningRequest({ token: expiring.token, liffCredential: 'credential-signer', requestMeta: trustedRequest }),
  'TOKEN_EXPIRED',
  410,
);
const expiredSession = await service.getSession(expiring.sessionId);
assert.equal(expiredSession.status, 'expired');
assert.equal(expiredSession.events.filter((event) => event.type === 'expired').length, 1);

// Trusted proxy helper ignores attacker-controlled headers unless the socket
// peer itself is trusted, then walks X-Forwarded-For from the trusted edge.
assert.equal(getTrustedClientIp({
  remoteAddress: '198.51.100.8',
  headers: { 'x-forwarded-for': '192.0.2.123', 'cf-connecting-ip': '192.0.2.124' },
}, { isTrustedProxy: () => false, trustedClientIpHeaders: ['cf-connecting-ip'] }), '198.51.100.8');
assert.equal(getTrustedClientIp({
  remoteAddress: '10.0.0.2',
  headers: { 'x-forwarded-for': '203.0.113.45, 10.0.0.1' },
}, { isTrustedProxy: (ip) => ip.startsWith('10.') }), '203.0.113.45');
assert.equal(getTrustedClientIp({
  remoteAddress: '10.0.0.2',
  headers: { 'cf-connecting-ip': '203.0.113.99', 'x-forwarded-for': '192.0.2.1' },
}, { isTrustedProxy: (ip) => ip.startsWith('10.'), trustedClientIpHeaders: ['cf-connecting-ip'] }), '203.0.113.99');
assert.equal(getTrustedClientIp({
  remoteAddress: '10.0.0.2',
  headers: { 'x-forwarded-for': '192.0.2.66' },
}, {
  isTrustedProxy: (ip) => ip.startsWith('10.'),
  trustedClientIpHeaders: ['cf-connecting-ip'],
  allowForwardedForFallback: false,
}), '10.0.0.2');
assert.equal(getTrustedClientIp({ remoteAddress: '::ffff:203.0.113.7', headers: {} }), '203.0.113.7');

// Security headers prevent caching, framing, referrer token leakage and broad
// device access. Protected links keep the token out of the HTTP request line.
const headers = contractSigningSecurityHeaders({ connectSources: ['https://api.line.me', 'javascript:alert(1)'] });
assert.match(headers['Cache-Control'], /no-store/);
assert.equal(headers['Referrer-Policy'], 'no-referrer');
assert.equal(headers['X-Frame-Options'], 'DENY');
assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
assert.match(headers['Content-Security-Policy'], /connect-src 'self' https:\/\/api\.line\.me/);
assert.equal(headers['Content-Security-Policy'].includes('javascript:'), false);
assert.match(headers['Permissions-Policy'], /microphone=\(\)/);
assert.equal(
  buildProtectedSigningLink('https://engineering-am.example.test', '/contracts/sign', 'secret-token'),
  'https://engineering-am.example.test/contracts/sign#token=secret-token',
);
assert.throws(
  () => buildProtectedSigningLink('http://engineering-am.example.test', '/contracts/sign', 'secret-token'),
  (error) => error.code === 'HTTPS_REQUIRED',
);

console.log('Engineering contract signing dry-run passed: hashed 7-day tokens, LIFF signer/group checks, safe LINE statuses, lifecycle idempotency, revoke/expiry/replay guards, trusted IP and security headers.');

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ContractSigningError } from '../modules/construction/contract-signing.js';
import {
  CONTRACT_SIGNING_OPEN_PATH,
  CONTRACT_SIGNING_DOCUMENT_PATH,
  CONTRACT_SIGNING_SUBMIT_PATH,
  CONTRACT_SIGNING_WEB_PATH,
  createContractSigningWebHandler,
  renderContractSigningPage,
} from '../modules/construction/contract-signing-web.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const documentHash = digest('engineering-contract-document-v1');
const signatureBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZVf8AAAAASUVORK5CYII=',
  'base64',
);
const signatureDataUrl = `data:image/png;base64,${signatureBytes.toString('base64')}`;
const identityFrontDataUrl = signatureDataUrl;
const identityBackDataUrl = signatureDataUrl;
const counterpartyDetails = {
  name: '王大明', identityNumber: 'A123456789', address: '臺中市西屯區工程路 1 號',
};

function getHeader(headers, name) {
  const wanted = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted);
  return entry ? String(entry[1]) : '';
}

function createRequest({ method = 'GET', url = CONTRACT_SIGNING_WEB_PATH, body, headers = {}, remoteAddress = '203.0.113.10' } = {}) {
  const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const request = Readable.from(raw ? [Buffer.from(raw)] : []);
  request.method = method;
  request.url = url;
  request.headers = { ...headers };
  request.socket = { remoteAddress };
  return request;
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    end(chunk = '') {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    },
  };
}

async function invoke(handler, requestOptions = {}) {
  const request = createRequest(requestOptions);
  const response = createResponse();
  const url = new URL(request.url, 'https://engineering-am.example.test');
  const handled = await handler(request, response, url.pathname, url);
  const isJson = /^application\/json/i.test(getHeader(response.headers, 'content-type'));
  return { handled, request, response, json: isJson && response.body ? JSON.parse(response.body) : null };
}

function createFixture(options = {}) {
  const calls = { open: [], submit: [], save: [], saveIdentity: [], resolve: [], document: [], logs: [] };
  const defaultOpenResult = {
    sessionId: 'signing-session-001',
    contractId: 'contract-001',
    projectId: 'project-001',
    documentRef: 'protected://contracts/contract-001.pdf',
    documentHash,
    status: 'opened',
    expiresAt: '2026-09-04T01:00:00.000Z',
    idempotent: false,
    canSign: true,
    accessMode: 'signer',
    signerLineUserId: 'U-sensitive-signer',
    events: [{ type: 'first_opened', ip: '203.0.113.10' }],
    ip: '203.0.113.10',
  };
  const openResult = typeof options.openResult === 'function'
    ? options.openResult
    : { ...defaultOpenResult, ...(options.openResult || {}) };
  const submitResult = options.submitResult || {
    sessionId: 'signing-session-001',
    status: 'signed',
    idempotent: false,
    groupNotificationAccepted: true,
    groupNotificationError: 'sensitive-provider-detail',
    signatureHash: digest(signatureBytes),
    submissionRef: 'protected://signatures/signing-session-001.png',
    ip: '203.0.113.10',
  };
  const service = {
    async openSigningRequest(input) {
      calls.open.push(input);
      if (options.openError) throw options.openError;
      return typeof openResult === 'function' ? openResult(input) : structuredClone(openResult);
    },
    async submitSignature(input) {
      calls.submit.push(input);
      if (options.submitError) throw options.submitError;
      return typeof submitResult === 'function' ? submitResult(input) : structuredClone(submitResult);
    },
  };
  const saveSignature = async (input) => {
    calls.save.push(input);
    if (options.saveError) throw options.saveError;
    if (options.saveResult) return typeof options.saveResult === 'function' ? options.saveResult(input) : options.saveResult;
    return { hash: digest(input.bytes), ref: `protected://signatures/${input.idempotencyKey}.png` };
  };
  const saveIdentityDocuments = async (input) => {
    calls.saveIdentity.push(input);
    if (options.saveIdentityError) throw options.saveIdentityError;
    const receivedAt = '2026-09-01T01:02:03.000Z';
    return {
      front: { hash: digest(input.front.bytes), ref: 'drive-id-front', contentType: input.front.contentType, byteSize: input.front.bytes.length, receivedAt },
      back: { hash: digest(input.back.bytes), ref: 'drive-id-back', contentType: input.back.contentType, byteSize: input.back.bytes.length, receivedAt },
    };
  };
  const defaultResolver = async (input) => {
    calls.resolve.push(input);
    return `/contract-sign/document/${encodeURIComponent(input.sessionId)}`;
  };
  const resolveDocumentUrl = Object.hasOwn(options, 'resolveDocumentUrl')
    ? options.resolveDocumentUrl
    : defaultResolver;
  const handler = createContractSigningWebHandler({
    service,
    saveSignature,
    saveIdentityDocuments,
    liffId: '2000000000-engineering',
    bodyLimit: options.bodyLimit,
    signatureLimit: options.signatureLimit,
    resolveDocumentUrl,
    loadDocument: async (opened) => {
      calls.document.push(opened);
      return { buffer: Buffer.from('%PDF-1.7\ntest\n%%EOF'), contentType: 'application/pdf' };
    },
    logger: { error: (...args) => calls.logs.push(args) },
    getRequestMeta: options.getRequestMeta,
  });
  return { handler, service, saveSignature, calls };
}

const validOpenBody = {
  token: 'raw-fragment-token',
  liffCredential: 'verified-liff-id-token',
};
const validSubmitBody = {
  ...validOpenBody,
  idempotencyKey: 'browser-submit-001',
  documentHash,
  signatureDataUrl,
  counterpartyDetails,
  identityDocuments: { frontDataUrl: identityFrontDataUrl, backDataUrl: identityBackDataUrl },
  reviewAcknowledged: true,
  consent: true,
};
const jsonHeaders = { 'content-type': 'application/json' };

// The public renderer is mobile-first and bootstraps LIFF, fragment-only token
// intake, Canvas signing, and explicit consent without embedding evidence.
{
  const html = renderContractSigningPage({ liffId: '2000000000-engineering', nonce: 'fixed-nonce' });
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /<canvas id="signature"/);
  assert.match(html, /id="counterparty-name"/);
  assert.match(html, /id="counterparty-identity-number"/);
  assert.match(html, /id="counterparty-address"/);
  assert.match(html, /姓名、身分證字號或住址缺少任一項/);
  assert.match(html, /id="identity-front"[^>]*type="file"/);
  assert.match(html, /id="identity-back"[^>]*type="file"/);
  assert.match(html, /身分證正面與反面/);
  assert.match(html, /id="consent" type="checkbox"/);
  assert.match(html, /id="consent" type="checkbox" disabled/);
  assert.match(html, /id="submit-signature" type="button" disabled/);
  assert.match(html, /id="document-link"[^>]*target="_blank"[^>]*hidden/);
  assert.match(html, /state\.signing\.canSign/);
  assert.match(html, /群組成員，可以檢視完整合約/);
  assert.match(html, /群組成員唯讀檢視，無法簽署/);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.match(html, /location\.hash/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname\)/);
  assert.match(html, new RegExp(CONTRACT_SIGNING_OPEN_PATH.replaceAll('/', '\\/')));
  assert.match(html, new RegExp(CONTRACT_SIGNING_SUBMIT_PATH.replaceAll('/', '\\/')));
  assert.doesNotMatch(html, /location\.search|[?&]token=/);
  assert.match(html, /liff\.getAccessToken\(\)/);
  assert.doesNotMatch(html, /liff\.getIDToken\(\)/);
  assert.doesNotMatch(html, /203\.0\.113\.10|protected:\/\/|\bIP(?: 位址| address)?\b/i);
}

// GET serves a no-store, nonce-protected page. HEAD exposes the same headers
// without a response body, and no secret value is reflected.
{
  const fixture = createFixture();
  const page = await invoke(fixture.handler, { method: 'GET', url: CONTRACT_SIGNING_WEB_PATH });
  assert.equal(page.handled, true);
  assert.equal(page.response.statusCode, 200);
  assert.match(getHeader(page.response.headers, 'content-type'), /^text\/html/);
  assert.match(getHeader(page.response.headers, 'cache-control'), /no-store/);
  assert.equal(getHeader(page.response.headers, 'referrer-policy'), 'no-referrer');
  assert.equal(getHeader(page.response.headers, 'x-content-type-options'), 'nosniff');
  assert.equal(getHeader(page.response.headers, 'x-frame-options'), 'DENY');
  assert.equal(getHeader(page.response.headers, 'x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet');
  const csp = getHeader(page.response.headers, 'content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /https:\/\/static\.line-scdn\.net/);
  assert.match(page.response.body, new RegExp(`nonce="${nonce}"`));
  assert.doesNotMatch(page.response.body, /raw-fragment-token/);

  const head = await invoke(fixture.handler, { method: 'HEAD', url: CONTRACT_SIGNING_WEB_PATH });
  assert.equal(head.response.statusCode, 200);
  assert.equal(head.response.body, '');
  assert.match(getHeader(head.response.headers, 'content-security-policy'), /'nonce-/);
}

// Raw signing tokens are not accepted in query strings and are not echoed in
// the safe JSON error. Unknown paths remain available to the parent router.
{
  const fixture = createFixture();
  const query = await invoke(fixture.handler, {
    method: 'GET',
    url: `${CONTRACT_SIGNING_WEB_PATH}?token=do-not-reflect-this-token`,
  });
  assert.equal(query.response.statusCode, 400);
  assert.equal(query.json.code, 'TOKEN_QUERY_FORBIDDEN');
  assert.doesNotMatch(query.response.body, /do-not-reflect-this-token/);
  assert.match(getHeader(query.response.headers, 'cache-control'), /no-store/);

  const mixedCaseQuery = await invoke(fixture.handler, {
    method: 'GET', url: `${CONTRACT_SIGNING_WEB_PATH}?Token=another-secret`,
  });
  assert.equal(mixedCaseQuery.response.statusCode, 400);
  assert.equal(mixedCaseQuery.json.code, 'TOKEN_QUERY_FORBIDDEN');
  assert.doesNotMatch(mixedCaseQuery.response.body, /another-secret/);

  const unknownRequest = createRequest({ method: 'GET', url: '/unrelated' });
  const unknownResponse = createResponse();
  assert.equal(await fixture.handler(unknownRequest, unknownResponse, '/unrelated'), false);
  assert.equal(unknownResponse.statusCode, 0);
}

// Open verifies through the injected signing service and returns only the
// minimum public contract fields, never protected references or audit evidence.
{
  const fixture = createFixture();
  const opened = await invoke(fixture.handler, {
    method: 'POST',
    url: CONTRACT_SIGNING_OPEN_PATH,
    headers: { ...jsonHeaders, 'user-agent': 'dryrun-browser' },
    body: validOpenBody,
    remoteAddress: '198.51.100.15',
  });
  assert.equal(opened.response.statusCode, 200);
  assert.equal(opened.json.ok, true);
  assert.deepEqual(opened.json.signing, {
    sessionId: 'signing-session-001',
    contractId: 'contract-001',
    projectId: 'project-001',
    documentHash,
    documentUrl: '/contract-sign/document/signing-session-001',
    status: 'opened',
    expiresAt: '2026-09-04T01:00:00.000Z',
    idempotent: false,
    canSign: true,
    accessMode: 'signer',
  });
  assert.equal(fixture.calls.open.length, 1);
  assert.equal(fixture.calls.open[0].token, validOpenBody.token);
  assert.equal(fixture.calls.open[0].liffCredential, validOpenBody.liffCredential);
  assert.equal(fixture.calls.open[0].requestMeta.remoteAddress, '198.51.100.15');
  assert.equal(fixture.calls.resolve.length, 1);
  assert.equal(fixture.calls.resolve[0].documentRef, 'protected://contracts/contract-001.pdf');
  assert.equal(fixture.calls.resolve[0].sessionId, 'signing-session-001');
  assert.equal(Object.hasOwn(fixture.calls.resolve[0], 'token'), false);
  assert.equal(Object.hasOwn(fixture.calls.resolve[0], 'liffCredential'), false);
  assert.equal(Object.hasOwn(opened.json.signing, 'documentRef'), false);
  assert.equal(Object.hasOwn(opened.json.signing, 'events'), false);
  assert.doesNotMatch(opened.response.body, /203\.0\.113\.10|U-sensitive-signer|protected:\/\//);

  const document = await invoke(fixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_DOCUMENT_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(document.response.statusCode, 200);
  assert.equal(getHeader(document.response.headers, 'content-type'), 'application/pdf');
  assert.match(document.response.body, /^%PDF-/);
  assert.equal(fixture.calls.document.length, 1);
  assert.equal(fixture.calls.open.length, 2);
}

// A verified member of the bound LINE group receives the same protected PDF
// in read-only mode, but a submit attempt is rejected before any signature or
// identity object is stored.
{
  const fixture = createFixture({ openResult: { canSign: false, accessMode: 'group_member_read_only', status: 'sent', idempotent: true } });
  const opened = await invoke(fixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(opened.response.statusCode, 200);
  assert.equal(opened.json.signing.canSign, false);
  assert.equal(opened.json.signing.accessMode, 'group_member_read_only');

  const document = await invoke(fixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_DOCUMENT_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(document.response.statusCode, 200);
  assert.match(document.response.body, /^%PDF-/);

  const rejected = await invoke(fixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders, body: validSubmitBody,
  });
  assert.equal(rejected.response.statusCode, 403);
  assert.equal(rejected.json.code, 'SIGNER_MISMATCH');
  assert.equal(fixture.calls.save.length, 0);
  assert.equal(fixture.calls.saveIdentity.length, 0);
  assert.equal(fixture.calls.submit.length, 0);
}

// A direct HTTPS document reference is allowed. Unsafe or executable schemes
// are rejected even if an injected resolver returns them, without reflection.
{
  const httpsFixture = createFixture({
    resolveDocumentUrl: null,
    openResult: {
      sessionId: 'https-session',
      documentRef: 'https://documents.example.test/contracts/one.pdf',
      documentHash,
    },
  });
  const httpsDocument = await invoke(httpsFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(httpsDocument.response.statusCode, 200);
  assert.equal(httpsDocument.json.signing.documentUrl, 'https://documents.example.test/contracts/one.pdf');

  const unsafeFixture = createFixture({
    resolveDocumentUrl: null,
    openResult: { sessionId: 'unsafe-session', documentRef: 'javascript:alert(1)', documentHash },
  });
  const unsafe = await invoke(unsafeFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(unsafe.response.statusCode, 500);
  assert.equal(unsafe.json.code, 'UNSAFE_DOCUMENT_URL');
  assert.doesNotMatch(unsafe.response.body, /javascript|alert/);

  const unprotectedInternalFixture = createFixture({
    resolveDocumentUrl: null,
    openResult: { sessionId: 'internal-session', documentRef: '/files/contract.pdf', documentHash },
  });
  const unprotectedInternal = await invoke(unprotectedInternalFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(unprotectedInternal.response.statusCode, 500);
  assert.equal(unprotectedInternal.json.code, 'DOCUMENT_RESOLVER_REQUIRED');

  const maliciousResolverFixture = createFixture({ resolveDocumentUrl: async () => 'data:text/html,<script>alert(1)</script>' });
  const maliciousResolver = await invoke(maliciousResolverFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(maliciousResolver.response.statusCode, 500);
  assert.equal(maliciousResolver.json.code, 'UNSAFE_DOCUMENT_URL');
  assert.doesNotMatch(maliciousResolver.response.body, /<script>|data:text/);
}

// ContractSigningError.status is the public status mapping; methods, media
// types, malformed JSON, and declared oversize bodies fail before service use.
{
  const groupMembershipRequired = createFixture({
    openError: new ContractSigningError('GROUP_MEMBERSHIP_REQUIRED', '目前 LINE 帳號不在此工程 LINE 群組。', 403),
  });
  const rejected = await invoke(groupMembershipRequired.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: validOpenBody,
  });
  assert.equal(rejected.response.statusCode, 403);
  assert.equal(rejected.json.code, 'GROUP_MEMBERSHIP_REQUIRED');

  const method = await invoke(createFixture().handler, { method: 'GET', url: CONTRACT_SIGNING_OPEN_PATH });
  assert.equal(method.response.statusCode, 405);
  assert.equal(method.json.code, 'METHOD_NOT_ALLOWED');

  const mediaFixture = createFixture();
  const media = await invoke(mediaFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: { 'content-type': 'text/plain' }, body: '{}',
  });
  assert.equal(media.response.statusCode, 415);
  assert.equal(media.json.code, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(mediaFixture.calls.open.length, 0);

  const invalidJson = await invoke(createFixture().handler, {
    method: 'POST', url: CONTRACT_SIGNING_OPEN_PATH, headers: jsonHeaders, body: '{',
  });
  assert.equal(invalidJson.response.statusCode, 400);
  assert.equal(invalidJson.json.code, 'INVALID_JSON');

  const largeFixture = createFixture({ bodyLimit: 100 });
  const tooLarge = await invoke(largeFixture.handler, {
    method: 'POST',
    url: CONTRACT_SIGNING_OPEN_PATH,
    headers: { ...jsonHeaders, 'content-length': '999999' },
    body: '{}',
  });
  assert.equal(tooLarge.response.statusCode, 413);
  assert.equal(tooLarge.json.code, 'BODY_TOO_LARGE');
  assert.equal(largeFixture.calls.open.length, 0);
}

// Submit authenticates and binds the exact document first, saves only decoded
// image bytes through the injected store, then gives hash/ref to the core.
{
  const fixture = createFixture();
  const submitted = await invoke(fixture.handler, {
    method: 'POST',
    url: CONTRACT_SIGNING_SUBMIT_PATH,
    headers: { ...jsonHeaders, 'user-agent': 'dryrun-browser' },
    body: validSubmitBody,
    remoteAddress: '198.51.100.16',
  });
  assert.equal(submitted.response.statusCode, 200);
  assert.deepEqual(submitted.json, {
    ok: true,
    signing: {
      sessionId: 'signing-session-001',
      status: 'signed',
      idempotent: false,
      groupNotificationAccepted: true,
    },
  });
  assert.equal(fixture.calls.open.length, 1);
  assert.equal(fixture.calls.save.length, 1);
  assert.equal(fixture.calls.saveIdentity.length, 1);
  assert.equal(fixture.calls.submit.length, 1);
  const saved = fixture.calls.save[0];
  assert.equal(saved.sessionId, 'signing-session-001');
  assert.equal(saved.idempotencyKey, validSubmitBody.idempotencyKey);
  assert.equal(saved.documentHash, documentHash);
  assert.equal(saved.contentType, 'image/png');
  assert.equal(Buffer.isBuffer(saved.bytes), true);
  assert.deepEqual(saved.bytes, signatureBytes);
  assert.equal(Object.hasOwn(saved, 'dataUrl'), false);
  assert.equal(Object.hasOwn(saved, 'token'), false);
  assert.equal(Object.hasOwn(saved, 'liffCredential'), false);
  assert.equal(saved.reviewAcknowledged, true);
  const coreSubmission = fixture.calls.submit[0];
  assert.equal(coreSubmission.signatureHash, digest(signatureBytes));
  assert.equal(coreSubmission.submissionRef, 'protected://signatures/browser-submit-001.png');
  assert.equal(coreSubmission.identityDocuments.front.ref, 'drive-id-front');
  assert.equal(coreSubmission.identityDocuments.back.ref, 'drive-id-back');
  assert.deepEqual(coreSubmission.counterpartyDetails, counterpartyDetails);
  assert.equal(coreSubmission.requestMeta.remoteAddress, '198.51.100.16');
  assert.equal(coreSubmission.reviewAcknowledged, true);
  assert.equal(Object.hasOwn(coreSubmission, 'signatureDataUrl'), false);
  assert.doesNotMatch(submitted.response.body, /signatureHash|submissionRef|203\.0\.113\.10|protected:\/\//);
}

// Consent, data URL bytes, document binding, storage result, and service replay
// errors each stop at the appropriate boundary.
{
  const noReviewFixture = createFixture();
  const noReview = await invoke(noReviewFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders,
    body: { ...validSubmitBody, reviewAcknowledged: false },
  });
  assert.equal(noReview.response.statusCode, 400);
  assert.equal(noReview.json.code, 'REVIEW_ACKNOWLEDGEMENT_REQUIRED');
  assert.equal(noReviewFixture.calls.open.length, 0);
  assert.equal(noReviewFixture.calls.save.length, 0);

  const noConsentFixture = createFixture();
  const noConsent = await invoke(noConsentFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders,
    body: { ...validSubmitBody, consent: false },
  });
  assert.equal(noConsent.response.statusCode, 400);
  assert.equal(noConsent.json.code, 'CONSENT_REQUIRED');
  assert.equal(noConsentFixture.calls.open.length, 0);
  assert.equal(noConsentFixture.calls.save.length, 0);

  const missingIdentityFixture = createFixture();
  const missingIdentity = await invoke(missingIdentityFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders,
    body: { ...validSubmitBody, identityDocuments: undefined },
  });
  assert.equal(missingIdentity.response.statusCode, 400);
  assert.equal(missingIdentity.json.code, 'FIELD_REQUIRED');
  assert.equal(missingIdentityFixture.calls.open.length, 0);
  assert.equal(missingIdentityFixture.calls.save.length, 0);
  assert.equal(missingIdentityFixture.calls.saveIdentity.length, 0);

  const missingPartyFixture = createFixture();
  const missingParty = await invoke(missingPartyFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders,
    body: { ...validSubmitBody, counterpartyDetails: { ...counterpartyDetails, address: '' } },
  });
  assert.equal(missingParty.response.statusCode, 400);
  assert.equal(missingParty.json.code, 'FIELD_REQUIRED');
  assert.equal(missingPartyFixture.calls.open.length, 0);
  assert.equal(missingPartyFixture.calls.save.length, 0);

  const fakePngFixture = createFixture();
  const fakePng = await invoke(fakePngFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders,
    body: { ...validSubmitBody, signatureDataUrl: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}` },
  });
  assert.equal(fakePng.response.statusCode, 400);
  assert.equal(fakePng.json.code, 'INVALID_SIGNATURE_BYTES');
  assert.equal(fakePngFixture.calls.open.length, 0);
  assert.equal(fakePngFixture.calls.save.length, 0);

  const mismatchFixture = createFixture({ openResult: { documentHash: digest('new-contract-version') } });
  const mismatch = await invoke(mismatchFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders, body: validSubmitBody,
  });
  assert.equal(mismatch.response.statusCode, 409);
  assert.equal(mismatch.json.code, 'DOCUMENT_VERSION_MISMATCH');
  assert.equal(mismatchFixture.calls.save.length, 0);
  assert.equal(mismatchFixture.calls.submit.length, 0);

  const badStoreFixture = createFixture({ saveResult: { hash: 'not-a-hash', ref: '' } });
  const badStore = await invoke(badStoreFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders, body: validSubmitBody,
  });
  assert.equal(badStore.response.statusCode, 500);
  assert.equal(badStore.json.code, 'SIGNATURE_STORAGE_FAILED');
  assert.equal(badStoreFixture.calls.submit.length, 0);

  const replayFixture = createFixture({
    submitError: new ContractSigningError('TOKEN_REPLAYED', '簽署權杖已完成提交，不可重複使用。', 409),
  });
  const replay = await invoke(replayFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders, body: validSubmitBody,
  });
  assert.equal(replay.response.statusCode, 409);
  assert.equal(replay.json.code, 'TOKEN_REPLAYED');
}

// A consumed token is rejected before another signature object can be written;
// concurrent exact submits still rely on storage/core idempotency after open.
{
  const retryFixture = createFixture({
    openError: new ContractSigningError('TOKEN_ALREADY_USED', '簽署權杖已使用。', 409),
  });
  const retried = await invoke(retryFixture.handler, {
    method: 'POST', url: CONTRACT_SIGNING_SUBMIT_PATH, headers: jsonHeaders, body: validSubmitBody,
  });
  assert.equal(retried.response.statusCode, 409);
  assert.equal(retried.json.code, 'TOKEN_ALREADY_USED');
  assert.equal(retryFixture.calls.save.length, 0);
  assert.equal(retryFixture.calls.submit.length, 0);
}

console.log('engineering contract signing web dry-run: PASS');

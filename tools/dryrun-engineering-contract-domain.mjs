// Engineering contract domain dry-run.
// Pure tests only: no credentials, network, Notion, Drive, or production data.
//
// Run:
//   node tools/dryrun-engineering-contract-domain.mjs

import assert from 'node:assert/strict';
import {
  ATTACHMENT_CATEGORIES,
  CONTRACT_EVENT_TIME_DEFINITIONS,
  CONTRACT_VERSION_STATUSES,
  CONTRACT_VERSION_TRANSITIONS,
  REQUIRED_CONTRACT_PACKAGE_FIELDS,
  SIGNING_STATUSES,
  SIGNING_TRANSITIONS,
  ContractDomainError,
  assertContractPackageComplete,
  assertProjectScope,
  assertSigningStatusTransition,
  assertVersionMutable,
  assertVersionStatusTransition,
  canTransitionSigningStatus,
  canTransitionVersionStatus,
  canonicalAttachmentManifestJson,
  canonicalizeAttachmentManifest,
  contractEventTime,
  freezeContractVersion,
  hashAttachmentManifest,
  isProjectInScope,
  isVersionFrozen,
  patchContractVersion,
  requireServerActor,
  sha256Hex,
  validateContractPackage,
  validatePaymentMilestones,
} from '../modules/construction/contract-domain.js';

const results = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => results.push([true, name]),
    (error) => results.push([false, name + ' — ' + error.message]),
  );
}

function expectDomainError(fn, code, statusCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ContractDomainError);
    assert.equal(error.code, code);
    if (statusCode !== undefined) assert.equal(error.statusCode, statusCode);
    return true;
  });
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function completePackage(overrides = {}) {
  return {
    contractBody: { content: '工程承攬合約本文，第 1 條至第 12 條。' },
    constructionDrawings: [{
      name: 'A-01 平面施工圖.pdf',
      revision: 'R2',
      fileId: 'drive-drawing-1',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      sha256: HASH_A,
    }],
    quotation: {
      name: '木作工程報價單.pdf',
      revision: '核定版',
      fileId: 'drive-quote-1',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256: HASH_B,
    },
    paymentMilestones: [
      {
        id: 'deposit',
        label: '簽約款',
        percentage: 30,
        amount: 300000,
        dueDate: '2026-09-01',
        dueTime: '17:00',
      },
      {
        id: 'acceptance',
        label: '驗收尾款',
        percentage: 70,
        amount: 700000,
        trigger: '全部驗收項目確認通過後 7 日內',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'wall-flatness',
        criterion: '牆面 2 公尺靠尺高低差不得超過 3 mm',
        reference: 'A-01 R2',
        evidenceRequired: '靠尺量測照片',
      },
      '木作表面不得有肉眼可見破損或脫膠',
    ],
    ...overrides,
  };
}

await check('status constants and transition maps are complete and frozen', () => {
  assert.deepEqual(Object.keys(CONTRACT_VERSION_TRANSITIONS), CONTRACT_VERSION_STATUSES);
  assert.deepEqual(Object.keys(SIGNING_TRANSITIONS), SIGNING_STATUSES);
  assert.equal(Object.isFrozen(CONTRACT_VERSION_STATUSES), true);
  assert.equal(Object.isFrozen(CONTRACT_VERSION_TRANSITIONS), true);
  assert.equal(Object.isFrozen(CONTRACT_VERSION_TRANSITIONS.draft), true);
  assert.equal(Object.isFrozen(SIGNING_STATUSES), true);
  assert.deepEqual(REQUIRED_CONTRACT_PACKAGE_FIELDS, [
    'contractBody',
    'constructionDrawings',
    'quotation',
    'paymentMilestones',
    'acceptanceCriteria',
  ]);
  assert.deepEqual(ATTACHMENT_CATEGORIES, [
    'contract_body',
    'construction_drawing',
    'quotation',
    'other',
  ]);
});

await check('document version transition permits review/freeze lifecycle and blocks shortcuts', () => {
  assert.equal(canTransitionVersionStatus('draft', 'internal_review'), true);
  assert.equal(canTransitionVersionStatus('internal_review', 'approved'), true);
  assert.equal(canTransitionVersionStatus('approved', 'frozen'), true);
  assert.equal(canTransitionVersionStatus('frozen', 'superseded'), true);
  assert.equal(canTransitionVersionStatus('draft', 'frozen'), false);
  assert.equal(canTransitionVersionStatus('frozen', 'draft'), false);
  assert.equal(canTransitionVersionStatus('unknown', 'draft'), false);
  assert.equal(assertVersionStatusTransition('approved', 'frozen'), 'frozen');
  expectDomainError(
    () => assertVersionStatusTransition('draft', 'frozen'),
    'INVALID_VERSION_TRANSITION',
    409,
  );
  expectDomainError(
    () => assertVersionStatusTransition('draft', 'missing'),
    'UNKNOWN_VERSION_STATUS',
  );
});

await check('signing transition permits observed shortcuts but terminal states stay terminal', () => {
  assert.equal(canTransitionSigningStatus('not_issued', 'issued'), true);
  assert.equal(canTransitionSigningStatus('issued', 'sent'), true);
  assert.equal(canTransitionSigningStatus('issued', 'opened'), true);
  assert.equal(canTransitionSigningStatus('opened', 'signed_pending_review'), true);
  assert.equal(canTransitionSigningStatus('signed_pending_review', 'revision_required'), true);
  assert.equal(canTransitionSigningStatus('revision_required', 'signed_pending_review'), true);
  assert.equal(canTransitionSigningStatus('signed_pending_review', 'confirmed'), true);
  assert.equal(canTransitionSigningStatus('confirmed', 'revoked'), false);
  assert.equal(assertSigningStatusTransition('sent', 'opened'), 'opened');
  expectDomainError(
    () => assertSigningStatusTransition('confirmed', 'opened'),
    'INVALID_SIGNING_TRANSITION',
    409,
  );
});

await check('complete document package passes all five gates', () => {
  const result = validateContractPackage(completePackage(), { contractAmount: 1000000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.payment.totals.percentage, 100);
  assert.equal(result.payment.totals.amount, 1000000);
  assert.equal(result.acceptanceCriteria.length, 2);
  assert.deepEqual(result.manifest.map((item) => item.category), [
    'construction_drawing',
    'quotation',
  ]);
  assert.match(result.manifestHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(assertContractPackageComplete(completePackage(), { contractAmount: 1000000 }).ok, true);
});

await check('empty package reports every mandatory component and assert rejects it', () => {
  const result = validateContractPackage({});
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, REQUIRED_CONTRACT_PACKAGE_FIELDS);
  expectDomainError(
    () => assertContractPackageComplete({}),
    'CONTRACT_PACKAGE_INCOMPLETE',
    422,
  );
});

await check('contract body, drawings, and quote may be supplied by one attachment manifest', () => {
  const input = completePackage({
    contractBody: undefined,
    constructionDrawings: undefined,
    quotation: undefined,
    attachments: [
      { category: '報價單', name: '報價.pdf', fileId: 'q', sha256: HASH_B },
      { category: '施工圖', name: '施工圖.pdf', fileId: 'd', sha256: HASH_A },
      { category: '合約本文', name: '合約本文.pdf', fileId: 'c', sha256: 'c'.repeat(64) },
    ],
  });
  const result = validateContractPackage(input, { contractAmount: 1000000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.map((item) => item.category), [
    'contract_body',
    'construction_drawing',
    'quotation',
  ]);
});

await check('payment percentages, ratios, amounts, schedule, and totals normalize correctly', () => {
  const result = validatePaymentMilestones([
    {
      id: 'p1',
      label: '第一期',
      ratio: 0.2,
      amount: '200,000',
      dueAt: '2026-09-01T17:00:00+08:00',
    },
    {
      id: 'p2',
      label: '第二期',
      percentage: 80,
      amount: 800000,
      trigger: '驗收通過',
    },
  ], { contractAmount: '1,000,000' });
  assert.equal(result.ok, true);
  assert.equal(result.milestones[0].percentage, 20);
  assert.equal(result.milestones[0].dueAt, '2026-09-01T09:00:00.000Z');
  assert.deepEqual(result.totals, {
    percentage: 100,
    amount: 1000000,
    contractAmount: 1000000,
  });
});

await check('payment validation rejects bad totals, mixed allocation, and row mismatch', () => {
  const badTotal = validatePaymentMilestones([
    { label: '一期', percentage: 60, amount: 600, trigger: '簽約' },
    { label: '二期', percentage: 30, amount: 300, trigger: '驗收' },
  ], { contractAmount: 1000 });
  assert.equal(badTotal.ok, false);
  assert.ok(badTotal.errors.some((item) => item.code === 'PAYMENT_PERCENTAGE_TOTAL'));
  assert.ok(badTotal.errors.some((item) => item.code === 'PAYMENT_AMOUNT_TOTAL'));

  const mixed = validatePaymentMilestones([
    { label: '一期', percentage: 50, trigger: '簽約' },
    { label: '二期', amount: 500, trigger: '驗收' },
  ], { contractAmount: 1000 });
  assert.ok(mixed.errors.some((item) => item.code === 'PAYMENT_PERCENTAGE_INCOMPLETE'));
  assert.ok(mixed.errors.some((item) => item.code === 'PAYMENT_AMOUNT_INCOMPLETE'));

  const mismatch = validatePaymentMilestones([
    { label: '一期', percentage: 50, amount: 400, trigger: '簽約' },
    { label: '二期', percentage: 50, amount: 600, trigger: '驗收' },
  ], { contractAmount: 1000 });
  assert.ok(mismatch.errors.filter((item) => item.code === 'PAYMENT_ALLOCATION_MISMATCH').length >= 1);
});

await check('payment validation rejects invalid fields and duplicate milestone ids', () => {
  const result = validatePaymentMilestones([
    { id: 'same', label: '一期', percentage: 50, dueTime: '25:90' },
    { id: 'same', label: '二期', percentage: 50, trigger: '驗收' },
    { id: 'no-allocation', label: '三期', trigger: '交付' },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === 'INVALID_PAYMENT_TIME'));
  assert.ok(result.errors.some((item) => item.code === 'PAYMENT_ALLOCATION_REQUIRED'));

  const invalidDate = validatePaymentMilestones([
    { id: 'bad-date', label: '錯誤日期', amount: 100, dueDate: '2026-02-30' },
  ]);
  assert.ok(invalidDate.errors.some((item) => item.code === 'INVALID_PAYMENT_DATE'));

  const duplicate = validatePaymentMilestones([
    { id: 'same', label: '一期', percentage: 50, trigger: '簽約' },
    { id: 'same', label: '二期', percentage: 50, trigger: '驗收' },
  ]);
  assert.ok(duplicate.errors.some((item) => item.code === 'DUPLICATE_PAYMENT_ID'));
});

await check('mutable versions patch by copy; frozen versions reject in-place edits', () => {
  const original = {
    id: 'version-1',
    status: 'draft',
    content: { title: '泥作合約' },
  };
  const reviewing = patchContractVersion(original, {
    status: 'internal_review',
    content: { title: '泥作工程合約' },
  });
  assert.equal(original.status, 'draft');
  assert.equal(original.content.title, '泥作合約');
  assert.equal(reviewing.status, 'internal_review');
  assert.equal(reviewing.content.title, '泥作工程合約');

  const manifestHash = assertContractPackageComplete(
    completePackage(),
    { contractAmount: 1000000 },
  ).manifestHash;
  const approved = { id: 'version-1', status: 'approved', content: { title: '核准版' } };
  const frozen = freezeContractVersion(approved, {
    at: '2026-08-28T15:30:00+08:00',
    serverContext: { actor: '工程專案經理' },
    attachmentManifestHash: manifestHash,
  });
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.frozenAt, '2026-08-28T07:30:00.000Z');
  assert.equal(frozen.frozenBy, '工程專案經理');
  assert.equal(frozen.attachmentManifestHash, manifestHash);
  assert.equal(isVersionFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.content), true);
  assert.throws(() => { frozen.content.title = '竄改'; }, TypeError);
  expectDomainError(
    () => patchContractVersion(frozen, { content: { title: '新內容' } }),
    'CONTRACT_VERSION_FROZEN',
    409,
  );
  expectDomainError(
    () => assertVersionMutable({ status: 'voided' }),
    'CONTRACT_VERSION_FROZEN',
    409,
  );
});

await check('freeze requires approved state, authoritative actor, time offset, and manifest hash', () => {
  const validHash = sha256Hex('manifest');
  expectDomainError(
    () => freezeContractVersion(
      { status: 'draft' },
      { at: '2026-08-28T08:00:00Z', serverContext: { actor: 'PM' }, attachmentManifestHash: validHash },
    ),
    'INVALID_VERSION_TRANSITION',
    409,
  );
  expectDomainError(
    () => freezeContractVersion(
      { status: 'approved' },
      { at: '2026-08-28T08:00:00Z', serverContext: 'client actor', attachmentManifestHash: validHash },
    ),
    'SERVER_ACTOR_REQUIRED',
    403,
  );
  expectDomainError(
    () => freezeContractVersion(
      { status: 'approved' },
      { at: '2026-08-28 08:00:00', serverContext: { actor: 'PM' }, attachmentManifestHash: validHash },
    ),
    'EVENT_TIME_OFFSET_REQUIRED',
  );
  expectDomainError(
    () => freezeContractVersion(
      { status: 'approved' },
      { at: '2026-08-28T08:00:00Z', serverContext: { actor: 'PM' }, attachmentManifestHash: 'bad' },
    ),
    'ATTACHMENT_MANIFEST_HASH_REQUIRED',
  );
});

await check('event time definitions distinguish issued, sent, opened, signed, and received', () => {
  assert.equal(CONTRACT_EVENT_TIME_DEFINITIONS.issued.field, 'issuedAt');
  assert.equal(CONTRACT_EVENT_TIME_DEFINITIONS.send_succeeded.field, 'sentAt');
  assert.equal(CONTRACT_EVENT_TIME_DEFINITIONS.first_opened.field, 'firstOpenedAt');
  assert.equal(CONTRACT_EVENT_TIME_DEFINITIONS.signature_submitted.field, 'signedAt');
  assert.equal(CONTRACT_EVENT_TIME_DEFINITIONS.submission_received.field, 'submissionReceivedAt');
  const event = contractEventTime('send_succeeded', '2026-08-28T10:00:00+08:00');
  assert.deepEqual(event, {
    eventType: 'send_succeeded',
    timeField: 'sentAt',
    at: '2026-08-28T02:00:00.000Z',
  });
  expectDomainError(
    () => contractEventTime('send_succeeded', '2026-08-28T10:00:00'),
    'EVENT_TIME_OFFSET_REQUIRED',
  );
  expectDomainError(
    () => contractEventTime('delivered', '2026-08-28T10:00:00Z'),
    'UNKNOWN_CONTRACT_EVENT',
  );
});

await check('project scope helper supports current code sets and explicit id/code scopes', () => {
  const project = { id: '123e4567-e89b-12d3-a456-426614174000', code: 'HZ' };
  assert.equal(isProjectInScope(null, project), true);
  assert.equal(isProjectInScope('all', project), true);
  assert.equal(isProjectInScope('none', project), false);
  assert.equal(isProjectInScope(new Set(['HZ']), project), true);
  assert.equal(isProjectInScope(new Set(['ZS']), project), false);
  assert.equal(isProjectInScope(new Set(['123e4567e89b12d3a456426614174000']), project), true);
  assert.equal(isProjectInScope({ projectCodes: ['hz'] }, project), true);
  assert.equal(isProjectInScope({ projectIds: ['other'] }, project), false);
  assert.equal(assertProjectScope({ projectCodes: ['HZ'] }, project), project);
  expectDomainError(
    () => assertProjectScope({ projectCodes: ['ZS'] }, project),
    'PROJECT_SCOPE_DENIED',
    404,
  );
});

await check('server actor is accepted only from authoritative context fields', () => {
  assert.equal(requireServerActor({ actor: 'Seven' }), 'Seven');
  assert.equal(requireServerActor({ access: { actor: '工程經理' } }), '工程經理');
  expectDomainError(() => requireServerActor('Seven'), 'SERVER_ACTOR_REQUIRED', 403);
  expectDomainError(() => requireServerActor({ operator: 'client-localStorage' }), 'SERVER_ACTOR_REQUIRED', 403);
  expectDomainError(() => requireServerActor({ actor: '  ' }), 'SERVER_ACTOR_REQUIRED', 403);
});

await check('attachment manifest canonicalization is stable, sorted, deduplicated, and non-mutating', () => {
  const source = [
    {
      category: '報價單',
      name: '報價.pdf',
      revision: 'V1',
      driveFileId: 'Q1',
      contentType: 'APPLICATION/PDF',
      size: 200,
      contentHash: HASH_B.toUpperCase(),
      ignored: 'not part of signed manifest',
    },
    {
      category: '施工圖',
      name: 'A-01.pdf',
      revision: 'R2',
      fileId: 'D1',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      sha256: HASH_A,
    },
  ];
  const before = JSON.stringify(source);
  const canonical = canonicalizeAttachmentManifest(source);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(canonical.map((item) => item.category), ['construction_drawing', 'quotation']);
  assert.equal(canonical[1].mimeType, 'application/pdf');
  assert.equal(canonical[1].sha256, HASH_B);
  assert.equal(Object.prototype.hasOwnProperty.call(canonical[1], 'ignored'), false);
  assert.equal(Object.isFrozen(canonical), true);
  assert.equal(Object.isFrozen(canonical[0]), true);

  const reversed = [...source].reverse();
  assert.equal(canonicalAttachmentManifestJson(source), canonicalAttachmentManifestJson(reversed));
  assert.equal(hashAttachmentManifest(source), hashAttachmentManifest(reversed));
  assert.notEqual(
    hashAttachmentManifest(source),
    hashAttachmentManifest([{ ...source[0], revision: 'V2' }, source[1]]),
  );
  assert.equal(
    canonicalizeAttachmentManifest([source[0], source[0]]).length,
    1,
  );
});

await check('attachment manifest rejects unknown, unnamed, untraceable, or malformed entries', () => {
  expectDomainError(
    () => canonicalizeAttachmentManifest([{ category: 'secret', name: 'x', fileId: '1' }]),
    'INVALID_ATTACHMENT_CATEGORY',
  );
  expectDomainError(
    () => canonicalizeAttachmentManifest([{ category: '施工圖', fileId: '1' }]),
    'ATTACHMENT_NAME_REQUIRED',
  );
  expectDomainError(
    () => canonicalizeAttachmentManifest([{ category: '施工圖', name: 'x' }]),
    'ATTACHMENT_SOURCE_REQUIRED',
  );
  expectDomainError(
    () => canonicalizeAttachmentManifest([{ category: '施工圖', name: 'x', fileId: '1', sha256: 'bad' }]),
    'INVALID_ATTACHMENT_SHA256',
  );
  expectDomainError(
    () => canonicalizeAttachmentManifest([{ category: '施工圖', name: 'x', fileId: '1', sizeBytes: -1 }]),
    'INVALID_INTEGER',
  );
});

await check('SHA-256 helper is deterministic and only accepts strings or bytes', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(sha256Hex(Buffer.from('abc')), sha256Hex('abc'));
  expectDomainError(() => sha256Hex({ value: 'abc' }), 'INVALID_HASH_INPUT');
});

let passed = 0;
for (const [ok, name] of results) {
  console.log((ok ? '✅ ' : '❌ ') + name);
  if (ok) passed += 1;
}
console.log('\n' + passed + '/' + results.length + ' checks passed.');
process.exit(passed === results.length ? 0 : 1);

import assert from 'node:assert/strict';

import {
  CONTRACT_MANAGEMENT_STORE_INTERFACE,
  CONTRACT_MANAGEMENT_STORE_METHODS,
  createContractManagementService,
} from '../modules/construction/contract-management.js';
import { validateContractPackage } from '../modules/construction/contract-domain.js';

const FIXED_NOW = '2026-08-28T09:30:00+08:00';
const EXPECTED_NOW = '2026-08-28T01:30:00.000Z';

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function completePackage(amount = 100_000) {
  return {
    contractBody: {
      name: '工程合約本文.pdf',
      fileId: 'body-file-1',
      sha256: 'a'.repeat(64),
      mimeType: 'application/pdf',
    },
    constructionDrawings: [{
      name: '施工圖 A1.pdf',
      fileId: 'drawing-file-1',
      sha256: 'b'.repeat(64),
      revision: 'A1',
    }],
    quotation: {
      name: '核定報價單.pdf',
      fileId: 'quote-file-1',
      sha256: 'c'.repeat(64),
    },
    paymentMilestones: [
      {
        id: 'deposit',
        label: '簽約款',
        percentage: 50,
        amount: amount / 2,
        dueDate: '2026-09-01',
        dueTime: '17:00',
      },
      {
        id: 'completion',
        label: '驗收尾款',
        percentage: 50,
        amount: amount / 2,
        trigger: '完工驗收合格後七日內',
      },
    ],
    acceptanceCriteria: [
      {
        id: 'finish-level',
        criterion: '完成面高程誤差不得超過 3 mm',
        evidenceRequired: '現場量測照片',
      },
    ],
  };
}

function urlOnlyPackage(amount = 100_000) {
  const value = completePackage(amount);
  value.contractBody = { name: '工程合約本文.pdf', url: 'https://files.example/body.pdf' };
  value.constructionDrawings = [{ name: '施工圖 A1.pdf', url: 'https://files.example/drawing.pdf' }];
  value.quotation = { name: '核定報價單.pdf', url: 'https://files.example/quote.pdf' };
  return value;
}

function fileIdOnlyPackage(amount = 100_000) {
  const value = completePackage(amount);
  delete value.contractBody.sha256;
  delete value.constructionDrawings[0].sha256;
  delete value.quotation.sha256;
  return value;
}

function createMemoryStore() {
  const contracts = new Map();
  const versions = new Map();
  const calls = [];
  let contractSequence = 0;
  let versionSequence = 0;

  const wrap = (value) => ({ value: copy(value), config: { tenantKey: 'engineering' } });

  const store = {
    calls,
    contracts,
    versions,

    seedContract(input = {}) {
      const row = {
        id: input.id || `contract-${++contractSequence}`,
        project_notion_page_id: input.projectId || 'project-alpha',
        project_code: input.projectCode || 'ALPHA',
        notion_contract_page_id: input.notionContractPageId || `notion-contract-${contractSequence}`,
        contract_number: input.contractNumber || `ENG-${String(contractSequence).padStart(3, '0')}`,
        title: input.title || '泥作工程合約',
        amount: input.amount ?? 100_000,
        currency: input.currency || 'TWD',
        workflow_state: input.workflowState || 'draft',
        execution_status: input.executionStatus || 'not_started',
        created_at: input.createdAt || '2026-08-01T00:00:00.000Z',
        ...copy(input.raw || {}),
      };
      contracts.set(row.id, row);
      return row;
    },

    seedVersion(input = {}) {
      const row = {
        id: input.id || `version-${++versionSequence}`,
        contract_id: input.contractId || 'contract-1',
        version_no: input.versionNo || 1,
        status: input.status || 'draft',
        contract_snapshot: copy(input.snapshot || {
          documentPackage: copy(input.documentPackage || {}),
        }),
        bundle_manifest: copy(input.manifest || []),
        bundle_sha256: input.attachmentManifestHash || '',
        frozen_at: input.frozenAt || null,
        frozen_by: input.frozenBy || null,
        review_submitted_at: input.reviewSubmittedAt || null,
        review_submitted_by: input.reviewSubmittedBy || null,
        approved_at: input.approvedAt || null,
        approved_by: input.approvedBy || null,
        issued_at: input.issuedAt || null,
        created_at: input.createdAt || '2026-08-02T00:00:00.000Z',
        created_by: input.createdBy || 'server:seed',
      };
      versions.set(row.id, row);
      return row;
    },

    async upsertContract(tenant, input) {
      calls.push({ method: 'upsertContract', tenant: copy(tenant), input: copy(input) });
      let row = [...contracts.values()].find(
        (item) => item.notion_contract_page_id === input.notionContractPageId,
      );
      if (!row) {
        row = {
          id: `contract-${++contractSequence}`,
          created_at: input.observedAt,
        };
      }
      Object.assign(row, {
        project_notion_page_id: input.projectId,
        project_code: input.projectCode,
        notion_contract_page_id: input.notionContractPageId,
        contract_number: input.contractNumber,
        title: input.title,
        trade: input.trade,
        counterparty_name: input.counterpartyName,
        counterparty_company: input.counterpartyCompany,
        counterparty_title: input.counterpartyTitle,
        amount: input.amount,
        currency: input.currency,
        workflow_state: input.workflowState,
        execution_status: input.executionStatus,
        updated_at: input.observedAt,
        updated_by: input.actor,
      });
      contracts.set(row.id, row);
      return wrap(row);
    },

    async getContract(tenant, selector) {
      calls.push({ method: 'getContract', tenant: copy(tenant), selector: copy(selector) });
      const row = [...contracts.values()].find((item) => (
        (selector.contractId && item.id === selector.contractId)
        || (selector.notionContractPageId && item.notion_contract_page_id === selector.notionContractPageId)
      ));
      return wrap(row || null);
    },

    async listContracts(tenant, projectIds) {
      calls.push({ method: 'listContracts', tenant: copy(tenant), projectIds: copy(projectIds) });
      const rows = [...contracts.values()].filter((item) => (
        !Array.isArray(projectIds) || projectIds.includes(item.project_notion_page_id)
      ));
      return copy(rows);
    },

    async listVersions(tenant, contractId) {
      calls.push({ method: 'listVersions', tenant: copy(tenant), contractId });
      return wrap([...versions.values()].filter((item) => item.contract_id === contractId));
    },

    async getVersion(tenant, versionId) {
      calls.push({ method: 'getVersion', tenant: copy(tenant), versionId });
      return wrap(versions.get(versionId) || null);
    },

    async createVersion(tenant, input) {
      calls.push({ method: 'createVersion', tenant: copy(tenant), input: copy(input) });
      const row = {
        id: `version-${++versionSequence}`,
        contract_id: input.contractId,
        version_no: input.versionNo,
        status: input.status,
        contract_snapshot: copy(input.snapshot),
        bundle_manifest: copy(input.manifest),
        bundle_sha256: input.bundleSha256,
        created_at: input.createdAt,
        created_by: input.actor,
      };
      versions.set(row.id, row);
      return wrap(row);
    },

    async transitionVersion(tenant, input) {
      calls.push({ method: 'transitionVersion', tenant: copy(tenant), input: copy(input) });
      const row = versions.get(input.versionId);
      if (!row || row.contract_id !== input.contractId) return wrap(null);
      if (row.status !== input.expectedStatus || row.frozen_at) return wrap(null);
      const timeFields = {
        reviewSubmittedAt: 'review_submitted_at',
        approvedAt: 'approved_at',
      };
      const actorFields = {
        reviewSubmittedBy: 'review_submitted_by',
        approvedBy: 'approved_by',
      };
      row.status = input.status;
      if (timeFields[input.transitionTimeField]) row[timeFields[input.transitionTimeField]] = input.transitionedAt;
      if (actorFields[input.transitionActorField]) row[actorFields[input.transitionActorField]] = input.transitionedBy;
      return wrap(row);
    },

    async freezeVersion(tenant, input) {
      calls.push({ method: 'freezeVersion', tenant: copy(tenant), input: copy(input) });
      const row = versions.get(input.versionId);
      if (!row || row.contract_id !== input.contractId) return wrap(null);
      if (row.status !== input.expectedStatus || row.frozen_at) return wrap(null);
      Object.assign(row, {
        status: input.status,
        frozen_at: input.frozenAt,
        frozen_by: input.frozenBy,
        bundle_manifest: copy(input.manifest),
        bundle_sha256: input.attachmentManifestHash,
      });
      return wrap(row);
    },
  };
  return store;
}

function createFixture({ scope = { projectIds: ['project-alpha'] }, store = createMemoryStore() } = {}) {
  const service = createContractManagementService({ store, clock: () => FIXED_NOW });
  const context = {
    tenant: { key: 'engineering' },
    actor: 'server:owner@example.com',
    scope,
  };
  return { store, service, context };
}

function seedDefaultContract(store, input = {}) {
  return store.seedContract({
    id: 'contract-1',
    projectId: 'project-alpha',
    projectCode: 'ALPHA',
    notionContractPageId: 'notion-contract-1',
    amount: 100_000,
    ...input,
  });
}

async function rejectsCode(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, code, `expected ${code}, received ${error?.code}`);
    return true;
  });
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test('publishes and fail-fast validates the complete store adapter interface', async () => {
  assert.deepEqual(Object.keys(CONTRACT_MANAGEMENT_STORE_INTERFACE), CONTRACT_MANAGEMENT_STORE_METHODS);
  assert.throws(
    () => createContractManagementService({ store: { upsertContract() {} } }),
    (error) => error.code === 'CONTRACT_STORE_ADAPTER_INVALID'
      && error.details.missingMethods.includes('freezeVersion'),
  );
  assert.throws(
    () => createContractManagementService({ store: createMemoryStore(), clock: 'now' }),
    (error) => error.code === 'CONTRACT_CLOCK_INVALID',
  );
});

test('creates or synchronizes a scoped contract using only the server actor', async () => {
  const { service, store, context } = createFixture();
  const result = await service.createOrSyncContract(context, {
    projectId: 'project-alpha',
    projectCode: 'ALPHA',
    notionContractPageId: 'notion-contract-1',
    contractNumber: 'ENG-001',
    title: '泥作工程合約',
    amount: '100000',
    actor: 'client:forged',
  });
  assert.equal(result.contract.id, 'contract-1');
  assert.equal(result.contract.projectId, 'project-alpha');
  assert.equal(result.contract.contractNumber, 'ENG-001');
  assert.equal(result.synchronizedAt, EXPECTED_NOW);
  assert.equal(result.synchronizedBy, context.actor);
  const call = store.calls.find((item) => item.method === 'upsertContract');
  assert.equal(call.input.actor, context.actor);
  assert.equal(call.input.observedAt, EXPECTED_NOW);
  assert.equal(Object.hasOwn(call.input, 'clientActor'), false);
});

test('rejects missing server authority, tenant, and explicit project scope', async () => {
  const { service, context } = createFixture();
  const input = {
    projectId: 'project-alpha',
    notionContractPageId: 'notion-contract-1',
    title: '泥作工程合約',
  };
  await rejectsCode(
    () => service.createOrSyncContract({ ...context, actor: '' }, input),
    'SERVER_ACTOR_REQUIRED',
  );
  const noScope = { tenant: context.tenant, actor: context.actor };
  await rejectsCode(() => service.createOrSyncContract(noScope, input), 'PROJECT_SCOPE_REQUIRED');
  await rejectsCode(
    () => service.createOrSyncContract({ ...context, tenant: {} }, input),
    'CONTRACT_TENANT_REQUIRED',
  );
});

test('denies out-of-scope contract synchronization before persistence', async () => {
  const { service, store, context } = createFixture();
  await rejectsCode(() => service.createOrSyncContract(context, {
    projectId: 'project-beta',
    projectCode: 'BETA',
    notionContractPageId: 'notion-contract-beta',
    title: '水電合約',
  }), 'PROJECT_SCOPE_DENIED');
  assert.equal(store.calls.some((item) => item.method === 'upsertContract'), false);
});

test('validates contract metadata before storage', async () => {
  const { service, context } = createFixture();
  await rejectsCode(() => service.createOrSyncContract(context, {
    projectId: 'project-alpha',
    title: '缺少 Notion id',
  }), 'NOTION_CONTRACT_PAGE_REQUIRED');
  await rejectsCode(() => service.createOrSyncContract(context, {
    projectId: 'project-alpha',
    notionContractPageId: 'notion-contract-x',
    title: '金額錯誤',
    amount: 0,
  }), 'CONTRACT_AMOUNT_RANGE');
});

test('creates an insert-only incomplete draft and reports all five required sections', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const result = await service.createDraftVersion(context, {
    contractId: 'contract-1',
    snapshot: { note: '尚待補件' },
    documentPackage: {},
    actor: 'client:forged',
  });
  assert.equal(result.version.status, 'draft');
  assert.equal(result.version.versionNo, 1);
  assert.equal(result.packageValidation.ok, false);
  assert.deepEqual(result.packageValidation.missing, [
    'contractBody',
    'constructionDrawings',
    'quotation',
    'paymentMilestones',
    'acceptanceCriteria',
  ]);
  const call = store.calls.find((item) => item.method === 'createVersion');
  assert.equal(call.input.actor, context.actor);
  assert.equal(call.input.status, 'draft');
  assert.equal(call.input.snapshot.note, '尚待補件');
  assert.deepEqual(call.input.snapshot.documentPackage, {});
});

test('creates the next numbered draft with a canonical manifest hash', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({ id: 'version-3', contractId: 'contract-1', versionNo: 3 });
  const documentPackage = completePackage();
  const expected = validateContractPackage(documentPackage, { contractAmount: 100_000 });
  const result = await service.createDraftVersion(context, {
    contractId: 'contract-1',
    documentPackage,
  });
  assert.equal(result.version.versionNo, 4);
  assert.equal(result.packageValidation.ok, true);
  assert.equal(result.version.attachmentManifestHash, expected.manifestHash);
  assert.deepEqual(result.version.manifest, expected.manifest);
});

test('moves a draft through review and approval CAS before freezing the same immutable content', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const created = await service.createDraftVersion(context, {
    contractId: 'contract-1',
    documentPackage: completePackage(),
    snapshot: { commercialRevision: 'R1' },
  });
  const originalSnapshot = copy(created.version.snapshot);

  const submitted = await service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: created.version.id,
  });
  assert.equal(submitted.version.status, 'internal_review');
  assert.deepEqual(submitted.transition, {
    from: 'draft',
    to: 'internal_review',
    at: EXPECTED_NOW,
    by: context.actor,
  });
  assert.equal(submitted.version.reviewSubmittedAt, EXPECTED_NOW);
  assert.equal(submitted.version.reviewSubmittedBy, context.actor);
  assert.deepEqual(submitted.version.snapshot, originalSnapshot);

  const returned = await service.returnVersionToDraft(context, {
    contractId: 'contract-1',
    versionId: created.version.id,
  });
  assert.equal(returned.version.status, 'draft');
  assert.deepEqual(returned.transition, {
    from: 'internal_review',
    to: 'draft',
    at: EXPECTED_NOW,
    by: context.actor,
  });
  assert.deepEqual(returned.version.snapshot, originalSnapshot);

  const resubmitted = await service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: created.version.id,
  });
  assert.equal(resubmitted.version.status, 'internal_review');

  const approved = await service.approveVersion(context, {
    contractId: 'contract-1',
    versionId: created.version.id,
  });
  assert.equal(approved.version.status, 'approved');
  assert.equal(approved.version.approvedAt, EXPECTED_NOW);
  assert.equal(approved.version.approvedBy, context.actor);
  assert.deepEqual(approved.version.snapshot, originalSnapshot);

  const frozen = await service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: created.version.id,
  });
  assert.equal(frozen.version.status, 'frozen');
  assert.deepEqual(frozen.version.snapshot, originalSnapshot);
  const transitions = store.calls.filter((item) => item.method === 'transitionVersion');
  assert.deepEqual(transitions.map((item) => [
    item.input.expectedStatus,
    item.input.status,
    item.input.actor,
  ]), [
    ['draft', 'internal_review', context.actor],
    ['internal_review', 'draft', context.actor],
    ['draft', 'internal_review', context.actor],
    ['internal_review', 'approved', context.actor],
  ]);
});

test('prevents draft creation from updating an id or reusing a version number', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({ id: 'version-1', contractId: 'contract-1', versionNo: 1 });
  await rejectsCode(() => service.createDraftVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-1',
    documentPackage: completePackage(),
  }), 'VERSION_INSERT_ONLY');
  await rejectsCode(() => service.createDraftVersion(context, {
    contractId: 'contract-1',
    versionNo: 1,
    documentPackage: completePackage(),
  }), 'CONTRACT_VERSION_NUMBER_EXISTS');
});

test('review and approval endpoints reject shortcuts, frozen versions, and content overrides', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-draft',
    contractId: 'contract-1',
    status: 'draft',
    documentPackage: completePackage(),
  });
  store.seedVersion({
    id: 'version-frozen',
    contractId: 'contract-1',
    versionNo: 2,
    status: 'frozen',
    documentPackage: completePackage(),
    frozenAt: EXPECTED_NOW,
    frozenBy: context.actor,
  });
  await rejectsCode(() => service.approveVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
  }), 'INVALID_VERSION_TRANSITION');
  await rejectsCode(() => service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: 'version-frozen',
  }), 'CONTRACT_VERSION_FROZEN');
  await rejectsCode(() => service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
    snapshot: { forged: true },
  }), 'VERSION_CONTENT_OVERRIDE_FORBIDDEN');
  await rejectsCode(() => service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
    status: 'approved',
  }), 'VERSION_STATUS_OVERRIDE_FORBIDDEN');
  assert.equal(store.calls.some((item) => item.method === 'transitionVersion'), false);
});

test('review transition enforces server actor, scope, and contract-version ownership', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedContract({
    id: 'contract-beta',
    projectId: 'project-beta',
    projectCode: 'BETA',
    notionContractPageId: 'notion-contract-beta',
  });
  store.seedVersion({ id: 'version-alpha', contractId: 'contract-1', status: 'draft' });
  store.seedVersion({ id: 'version-beta', contractId: 'contract-beta', status: 'draft' });
  await rejectsCode(() => service.submitVersionForReview(
    { ...context, actor: '' },
    { contractId: 'contract-1', versionId: 'version-alpha' },
  ), 'SERVER_ACTOR_REQUIRED');
  await rejectsCode(() => service.submitVersionForReview(context, {
    contractId: 'contract-beta',
    versionId: 'version-beta',
  }), 'PROJECT_SCOPE_DENIED');
  await rejectsCode(() => service.submitVersionForReview(context, {
    contractId: 'contract-1',
    versionId: 'version-beta',
  }), 'CONTRACT_VERSION_NOT_FOUND');
  assert.equal(store.calls.some((item) => item.method === 'transitionVersion'), false);
});

test('freezes an approved complete version with an atomic exact-manifest write', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const documentPackage = completePackage();
  store.seedVersion({
    id: 'version-approved',
    contractId: 'contract-1',
    versionNo: 1,
    status: 'approved',
    documentPackage,
  });
  const result = await service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-approved',
    actor: 'client:forged',
  });
  assert.equal(result.version.status, 'frozen');
  assert.equal(result.frozenAt, EXPECTED_NOW);
  assert.equal(result.frozenBy, context.actor);
  assert.equal(result.version.attachmentManifestHash, result.packageValidation.manifestHash);
  const call = store.calls.find((item) => item.method === 'freezeVersion');
  assert.equal(call.input.expectedStatus, 'approved');
  assert.equal(call.input.actor, context.actor);
  assert.equal(call.input.frozenAt, EXPECTED_NOW);
  assert.equal(call.input.bundleSha256, result.packageValidation.manifestHash);
});

test('refuses to freeze incomplete or payment-invalid packages', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-incomplete',
    contractId: 'contract-1',
    status: 'approved',
    documentPackage: {},
  });
  const badPayments = completePackage();
  badPayments.paymentMilestones[0].percentage = 60;
  store.seedVersion({
    id: 'version-bad-payment',
    contractId: 'contract-1',
    versionNo: 2,
    status: 'approved',
    documentPackage: badPayments,
  });
  await rejectsCode(() => service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-incomplete',
  }), 'CONTRACT_PACKAGE_INCOMPLETE');
  await rejectsCode(() => service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-bad-payment',
  }), 'CONTRACT_PACKAGE_INCOMPLETE');
  assert.equal(store.calls.some((item) => item.method === 'freezeVersion'), false);
});

test('allows URL-only or unhashed attachments in drafts but refuses to freeze them', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const urlDraft = await service.createDraftVersion(context, {
    contractId: 'contract-1',
    documentPackage: urlOnlyPackage(),
  });
  assert.equal(urlDraft.version.status, 'draft');
  assert.equal(urlDraft.packageValidation.ok, true);
  store.versions.get(urlDraft.version.id).status = 'approved';
  await assert.rejects(
    () => service.freezeVersion(context, {
      contractId: 'contract-1',
      versionId: urlDraft.version.id,
    }),
    (error) => {
      assert.equal(error.code, 'CONTRACT_PACKAGE_INCOMPLETE');
      const codes = error.details.errors.map((item) => item.code);
      assert.ok(codes.includes('REQUIRED_ATTACHMENT_FILE_ID'));
      assert.ok(codes.includes('REQUIRED_ATTACHMENT_SHA256'));
      return true;
    },
  );

  store.seedVersion({
    id: 'version-file-id-only',
    contractId: 'contract-1',
    versionNo: 2,
    status: 'approved',
    documentPackage: fileIdOnlyPackage(),
  });
  await assert.rejects(
    () => service.freezeVersion(context, {
      contractId: 'contract-1',
      versionId: 'version-file-id-only',
    }),
    (error) => error.code === 'CONTRACT_PACKAGE_INCOMPLETE'
      && error.details.errors.some((item) => item.code === 'REQUIRED_ATTACHMENT_SHA256'),
  );
  assert.equal(store.calls.some((item) => item.method === 'freezeVersion'), false);
});

test('issue readiness blocks URL-only, unhashed, and non-manifested required bundle sections', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const urlOnly = urlOnlyPackage();
  const urlValidation = validateContractPackage(urlOnly, { contractAmount: 100_000 });
  store.seedVersion({
    id: 'version-url-only',
    contractId: 'contract-1',
    status: 'frozen',
    documentPackage: urlOnly,
    attachmentManifestHash: urlValidation.manifestHash,
    frozenAt: EXPECTED_NOW,
    frozenBy: context.actor,
  });
  const urlResult = await service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-url-only',
  });
  assert.equal(urlResult.ready, false);
  const urlCodes = urlResult.blockers.map((item) => item.code);
  assert.ok(urlCodes.includes('REQUIRED_ATTACHMENT_FILE_ID'));
  assert.ok(urlCodes.includes('REQUIRED_ATTACHMENT_SHA256'));

  const inlineBody = completePackage();
  inlineBody.contractBody = '雙方約定之工程合約本文';
  const inlineValidation = validateContractPackage(inlineBody, { contractAmount: 100_000 });
  assert.equal(inlineValidation.ok, true);
  store.seedVersion({
    id: 'version-inline-body',
    contractId: 'contract-1',
    versionNo: 2,
    status: 'frozen',
    documentPackage: inlineBody,
    attachmentManifestHash: inlineValidation.manifestHash,
    frozenAt: EXPECTED_NOW,
    frozenBy: context.actor,
  });
  const inlineResult = await service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-inline-body',
  });
  assert.equal(inlineResult.ready, false);
  assert.ok(inlineResult.blockers.some((item) => (
    item.code === 'REQUIRED_ATTACHMENT_CATEGORY_MISSING' && item.category === 'contract_body'
  )));
});

test('requires the legal approved-to-frozen transition and blocks a second freeze', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const documentPackage = completePackage();
  store.seedVersion({
    id: 'version-draft',
    contractId: 'contract-1',
    status: 'draft',
    documentPackage,
  });
  const validation = validateContractPackage(documentPackage, { contractAmount: 100_000 });
  store.seedVersion({
    id: 'version-frozen',
    contractId: 'contract-1',
    versionNo: 2,
    status: 'frozen',
    documentPackage,
    attachmentManifestHash: validation.manifestHash,
    frozenAt: EXPECTED_NOW,
    frozenBy: context.actor,
  });
  await rejectsCode(() => service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
  }), 'INVALID_VERSION_TRANSITION');
  await rejectsCode(() => service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-frozen',
  }), 'CONTRACT_VERSION_FROZEN');
});

test('forbids content replacement during freeze', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-approved',
    contractId: 'contract-1',
    status: 'approved',
    documentPackage: completePackage(),
  });
  await rejectsCode(() => service.freezeVersion(context, {
    contractId: 'contract-1',
    versionId: 'version-approved',
    documentPackage: completePackage(),
  }), 'VERSION_CONTENT_OVERRIDE_FORBIDDEN');
});

test('reports a frozen complete exact-hash version as ready for issue without issuing it', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const documentPackage = completePackage();
  const validation = validateContractPackage(documentPackage, { contractAmount: 100_000 });
  store.seedVersion({
    id: 'version-ready',
    contractId: 'contract-1',
    status: 'frozen',
    documentPackage,
    attachmentManifestHash: validation.manifestHash,
    frozenAt: EXPECTED_NOW,
    frozenBy: context.actor,
  });
  const result = await service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-ready',
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checkedAt, EXPECTED_NOW);
  assert.equal(result.checkedBy, context.actor);
  assert.equal(store.calls.some((item) => item.method === 'issueVersion'), false);
});

test('issue readiness rejects frozen status without authoritative freeze evidence', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  const documentPackage = completePackage();
  const validation = validateContractPackage(documentPackage, { contractAmount: 100_000 });
  store.seedVersion({
    id: 'version-missing-freeze-evidence',
    contractId: 'contract-1',
    status: 'frozen',
    documentPackage,
    attachmentManifestHash: validation.manifestHash,
  });
  const result = await service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-missing-freeze-evidence',
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => item.code === 'VERSION_FREEZE_EVIDENCE_MISSING'));
});

test('issue readiness explains missing sections, non-frozen state, hash mismatch, and prior issue', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-not-ready',
    contractId: 'contract-1',
    status: 'approved',
    documentPackage: {},
    attachmentManifestHash: 'f'.repeat(64),
    issuedAt: '2026-08-27T00:00:00.000Z',
  });
  const result = await service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-not-ready',
  });
  assert.equal(result.ready, false);
  const codes = result.blockers.map((item) => item.code);
  assert.ok(codes.includes('VERSION_NOT_ACTIVE_FROZEN'));
  assert.ok(codes.includes('VERSION_ALREADY_ISSUED'));
  assert.equal(codes.filter((code) => code === 'REQUIRED_CONTRACT_SECTION_MISSING').length, 5);
  assert.ok(codes.includes('ATTACHMENT_MANIFEST_HASH_MISMATCH'));
});

test('never allows a version from another contract to cross the contract boundary', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedContract({
    id: 'contract-2',
    projectId: 'project-alpha',
    notionContractPageId: 'notion-contract-2',
  });
  store.seedVersion({
    id: 'version-contract-2',
    contractId: 'contract-2',
    status: 'approved',
    documentPackage: completePackage(),
  });
  await rejectsCode(() => service.issueReadiness(context, {
    contractId: 'contract-1',
    versionId: 'version-contract-2',
  }), 'CONTRACT_VERSION_NOT_FOUND');
});

test('list filters storage leakage and rejects unauthorized requested projects', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedContract({
    id: 'contract-beta',
    projectId: 'project-beta',
    projectCode: 'BETA',
    notionContractPageId: 'notion-contract-beta',
  });
  const result = await service.listContracts(context);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, 'contract-1');
  await rejectsCode(() => service.listContracts(context, {
    projectIds: ['project-beta'],
  }), 'PROJECT_SCOPE_DENIED');
});

test('list supports code scope only when records carry the authoritative project code', async () => {
  const { service, store, context } = createFixture({ scope: new Set(['ALPHA']) });
  seedDefaultContract(store);
  store.seedContract({
    id: 'contract-beta',
    projectId: 'project-beta',
    projectCode: 'BETA',
    notionContractPageId: 'notion-contract-beta',
  });
  const result = await service.listContracts(context);
  assert.deepEqual(result.items.map((item) => item.id), ['contract-1']);
});

test('detail normalizes and sorts versions newest first', async () => {
  const { service, store, context } = createFixture();
  seedDefaultContract(store);
  store.seedVersion({ id: 'version-1', contractId: 'contract-1', versionNo: 1 });
  store.seedVersion({ id: 'version-3', contractId: 'contract-1', versionNo: 3 });
  store.seedVersion({ id: 'version-2', contractId: 'contract-1', versionNo: 2 });
  const result = await service.getContractDetail(context, { contractId: 'contract-1' });
  assert.deepEqual(result.versions.map((item) => item.versionNo), [3, 2, 1]);
  assert.equal(result.latestVersion.id, 'version-3');
  assert.equal(result.retrievedBy, context.actor);
});

test('detail hides contracts outside scope and does not enumerate their versions', async () => {
  const { service, store, context } = createFixture();
  store.seedContract({
    id: 'contract-beta',
    projectId: 'project-beta',
    projectCode: 'BETA',
    notionContractPageId: 'notion-contract-beta',
  });
  await rejectsCode(
    () => service.getContractDetail(context, { contractId: 'contract-beta' }),
    'PROJECT_SCOPE_DENIED',
  );
  assert.equal(store.calls.some((item) => item.method === 'listVersions'), false);
});

test('turns an adapter skip into an explicit service-unavailable error', async () => {
  const store = createMemoryStore();
  store.listContracts = async () => ({ skipped: 'database-not-configured' });
  const { service, context } = createFixture({ store });
  await rejectsCode(() => service.listContracts(context), 'CONTRACT_STORE_UNAVAILABLE');
});

test('rejects a stale status CAS and detects transition adapters that alter content', async () => {
  const store = createMemoryStore();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-draft',
    contractId: 'contract-1',
    status: 'draft',
    documentPackage: completePackage(),
  });
  store.transitionVersion = async () => ({ value: null });
  let fixture = createFixture({ store });
  await rejectsCode(() => fixture.service.submitVersionForReview(fixture.context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
  }), 'CONTRACT_VERSION_TRANSITION_CONFLICT');

  store.transitionVersion = async (tenant, input) => {
    const row = copy(store.versions.get(input.versionId));
    row.status = input.status;
    row.review_submitted_at = input.transitionedAt;
    row.review_submitted_by = input.actor;
    row.contract_snapshot.documentPackage.contractBody.name = 'tampered.pdf';
    return { value: row };
  };
  fixture = createFixture({ store });
  await rejectsCode(() => fixture.service.submitVersionForReview(fixture.context, {
    contractId: 'contract-1',
    versionId: 'version-draft',
  }), 'CONTRACT_STORE_ADAPTER_VIOLATION');
});

test('rejects a stale atomic freeze conflict and a dishonest adapter result', async () => {
  const store = createMemoryStore();
  seedDefaultContract(store);
  store.seedVersion({
    id: 'version-approved',
    contractId: 'contract-1',
    status: 'approved',
    documentPackage: completePackage(),
  });
  store.freezeVersion = async () => ({ value: null });
  let fixture = createFixture({ store });
  await rejectsCode(() => fixture.service.freezeVersion(fixture.context, {
    contractId: 'contract-1',
    versionId: 'version-approved',
  }), 'CONTRACT_VERSION_FREEZE_CONFLICT');

  store.freezeVersion = async (tenant, input) => ({
    value: {
      ...copy(store.versions.get(input.versionId)),
      status: 'frozen',
      frozen_at: input.frozenAt,
      frozen_by: input.actor,
      bundle_sha256: '0'.repeat(64),
    },
  });
  fixture = createFixture({ store });
  await rejectsCode(() => fixture.service.freezeVersion(fixture.context, {
    contractId: 'contract-1',
    versionId: 'version-approved',
  }), 'CONTRACT_STORE_ADAPTER_VIOLATION');
});

let passed = 0;
for (const { name, run } of tests) {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} engineering contract management checks passed.`);
if (passed !== tests.length) process.exitCode = 1;

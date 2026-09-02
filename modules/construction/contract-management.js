// Internal engineering contract management service.
//
// This layer coordinates authorization, contract-domain invariants, and an
// injected persistence adapter. It deliberately does not create public signing
// links, send LINE messages, or accept signer evidence.

import {
  ContractDomainError,
  assertContractPackageComplete,
  assertProjectScope,
  assertVersionMutable,
  contractEventTime,
  freezeContractVersion,
  isProjectInScope,
  isVersionFrozen,
  patchContractVersion,
  requireServerActor,
  sha256Hex,
  validateContractPackage,
} from './contract-domain.js';

const STORE_METHODS = Object.freeze([
  'upsertContract',
  'getContract',
  'listContracts',
  'listVersions',
  'getVersion',
  'createVersion',
  'transitionVersion',
  'freezeVersion',
]);

const REQUIRED_BUNDLE_ATTACHMENT_CATEGORIES = Object.freeze([
  'contract_body',
  'construction_drawing',
  'quotation',
]);

const VERSION_CONTENT_INPUT_FIELDS = Object.freeze([
  'snapshot',
  'documentPackage',
  'contractPackage',
  'package',
  'attachments',
  'manifest',
  'attachmentManifestHash',
  'bundleSha256',
  'bundle_sha256',
]);

// Store adapter contract. Implementations may return either the described value
// directly or `{ value, config }`, matching AMCore's tenant transaction wrapper.
// `freezeVersion` must be an atomic compare-and-set: it may update an approved,
// not-yet-frozen row exactly once and must reject stale/concurrent callers.
export const CONTRACT_MANAGEMENT_STORE_INTERFACE = freezeTree({
  upsertContract: {
    signature: 'async (tenant, input) => Contract',
    guarantees: ['tenant isolation', 'upsert by tenant plus notionContractPageId'],
  },
  getContract: {
    signature: 'async (tenant, { contractId?, notionContractPageId? }) => Contract|null',
    guarantees: ['tenant isolation'],
  },
  listContracts: {
    signature: 'async (tenant, projectIds|null) => Contract[]',
    guarantees: ['tenant isolation', 'projectIds are an optional storage-side filter'],
  },
  listVersions: {
    signature: 'async (tenant, contractId) => ContractVersion[]',
    guarantees: ['tenant isolation', 'versions belong to contractId'],
  },
  getVersion: {
    signature: 'async (tenant, versionId) => ContractVersion|null',
    guarantees: ['tenant isolation'],
  },
  createVersion: {
    signature: 'async (tenant, input) => ContractVersion',
    guarantees: ['insert only', 'unique contractId plus versionNo', 'never updates an existing version'],
  },
  transitionVersion: {
    signature: 'async (tenant, input) => ContractVersion',
    guarantees: [
      'atomic expectedStatus compare-and-set',
      'updates status and transition actor/time only',
      'never updates snapshot, package, manifest, hash, version number, or contract ownership',
    ],
  },
  freezeVersion: {
    signature: 'async (tenant, input) => ContractVersion',
    guarantees: [
      'atomic expectedStatus=approved compare-and-set',
      'reject already frozen or stale versions',
      'persist frozenAt, frozenBy, manifest, and attachmentManifestHash together',
    ],
  },
});

export const CONTRACT_MANAGEMENT_STORE_METHODS = STORE_METHODS;

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = cloneValue(child);
    return output;
  }
  return value;
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const fields = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${fields.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function versionContentFingerprint(version) {
  return sha256Hex(canonicalJson({
    versionNo: version.versionNo,
    snapshot: version.snapshot,
    documentPackage: version.documentPackage,
    manifest: version.manifest,
    attachmentManifestHash: version.attachmentManifestHash,
  }));
}

function clean(value) {
  return String(value ?? '').trim();
}

function timestampText(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : '';
  }
  return clean(value);
}

function own(source, field) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, field));
}

function first(source, fields, fallback = undefined) {
  for (const field of fields) {
    if (own(source, field) && source[field] !== undefined) return source[field];
  }
  return fallback;
}

function managementError(code, message, details = {}, statusCode = 400) {
  return new ContractDomainError(code, message, details, statusCode);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw managementError('INVALID_ARGUMENT', `${name} must be an object.`, { field: name });
  }
  return value;
}

function requireText(value, code, message, field, statusCode = 400) {
  const output = clean(value);
  if (!output) throw managementError(code, message, { field }, statusCode);
  return output;
}

function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw managementError(
      'INVALID_VERSION_NUMBER',
      `${field} must be a positive integer.`,
      { field, value },
    );
  }
  return number;
}

function requireServiceContext(context) {
  requireObject(context, 'context');
  const actor = requireServerActor(context);
  if (!own(context, 'scope') || context.scope === undefined) {
    throw managementError(
      'PROJECT_SCOPE_REQUIRED',
      'An explicit authoritative project scope is required.',
      {},
      403,
    );
  }
  const tenant = context.tenant;
  if (!tenant || typeof tenant !== 'object' || !clean(tenant.key)) {
    throw managementError(
      'CONTRACT_TENANT_REQUIRED',
      'An authoritative tenant with key is required.',
      {},
      403,
    );
  }
  return { tenant, actor, scope: context.scope };
}

function projectReference(value) {
  const hasNestedProject = Boolean(value?.project && typeof value.project === 'object');
  const source = hasNestedProject ? value.project : (value || {});
  const explicitProjectId = first(value, [
    'projectId',
    'project_id',
    'projectNotionPageId',
    'project_notion_page_id',
  ]);
  const explicitProjectCode = first(value, ['projectCode', 'project_code']);
  return {
    id: clean(first(source, hasNestedProject ? [
      'id',
      'projectId',
      'project_id',
      'projectNotionPageId',
      'project_notion_page_id',
    ] : [
      'projectId',
      'project_id',
      'projectNotionPageId',
      'project_notion_page_id',
      'id',
    ], explicitProjectId || '')),
    code: clean(first(source, hasNestedProject ? [
      'code',
      'projectCode',
      'project_code',
    ] : [
      'projectCode',
      'project_code',
      'code',
    ], explicitProjectCode || '')),
  };
}

function requireProjectReference(input) {
  const project = projectReference(input);
  if (!project.id) {
    throw managementError(
      'CONTRACT_PROJECT_REQUIRED',
      'A contract must reference an authoritative project id.',
      { field: 'projectId' },
    );
  }
  return project;
}

function normalizeContract(raw) {
  requireObject(raw, 'contract');
  const project = projectReference(raw);
  return freezeTree({
    ...cloneValue(raw),
    id: clean(first(raw, ['id', 'contractId', 'contract_id'])),
    projectId: project.id,
    projectCode: project.code,
    notionContractPageId: clean(first(raw, [
      'notionContractPageId',
      'notion_contract_page_id',
    ])),
    contractNumber: clean(first(raw, ['contractNumber', 'contract_number'])),
    title: clean(first(raw, ['title', 'contractTitle', 'contract_title'])),
    trade: clean(first(raw, ['trade'])),
    counterpartyName: clean(first(raw, ['counterpartyName', 'counterparty_name'])),
    counterpartyCompany: clean(first(raw, ['counterpartyCompany', 'counterparty_company'])),
    counterpartyTitle: clean(first(raw, ['counterpartyTitle', 'counterparty_title'])),
    amount: first(raw, ['amount'], null),
    currency: clean(first(raw, ['currency'], 'TWD')) || 'TWD',
    workflowState: clean(first(raw, ['workflowState', 'workflow_state'], 'draft')) || 'draft',
    executionStatus: clean(first(raw, ['executionStatus', 'execution_status'], 'not_started')) || 'not_started',
    createdAt: clean(first(raw, ['createdAt', 'created_at'])),
    updatedAt: clean(first(raw, ['updatedAt', 'updated_at'])),
  });
}

function packageFromVersion(version) {
  const snapshot = first(version, ['snapshot', 'contractSnapshot', 'contract_snapshot'], {});
  return first(version, ['documentPackage', 'contractPackage', 'package'],
    first(snapshot, ['documentPackage', 'contractPackage', 'package'], {}));
}

function normalizeVersion(raw, fallback = {}) {
  requireObject(raw, 'version');
  const snapshot = first(raw, ['snapshot', 'contractSnapshot', 'contract_snapshot'], fallback.snapshot || {});
  const frozenAt = clean(first(raw, ['frozenAt', 'frozen_at'], fallback.frozenAt || ''));
  const approvedAt = clean(first(raw, ['approvedAt', 'approved_at'], fallback.approvedAt || ''));
  const explicitStatus = clean(first(raw, ['status', 'versionStatus', 'version_status'], fallback.status || ''));
  const status = explicitStatus || (frozenAt ? 'frozen' : (approvedAt ? 'approved' : 'draft'));
  return freezeTree({
    ...cloneValue(raw),
    id: clean(first(raw, ['id', 'versionId', 'version_id'], fallback.id || '')),
    contractId: clean(first(raw, ['contractId', 'contract_id'], fallback.contractId || '')),
    versionNo: Number(first(raw, ['versionNo', 'version_no'], fallback.versionNo || 0)) || 0,
    status,
    snapshot: cloneValue(snapshot || {}),
    documentPackage: cloneValue(packageFromVersion({ ...fallback, ...raw, snapshot })),
    manifest: cloneValue(first(raw, ['manifest', 'bundleManifest', 'bundle_manifest'], fallback.manifest || [])),
    attachmentManifestHash: clean(first(raw, [
      'attachmentManifestHash',
      'attachment_manifest_hash',
      'bundleSha256',
      'bundle_sha256',
    ], fallback.attachmentManifestHash || '')),
    frozenAt: timestampText(first(raw, ['frozenAt', 'frozen_at'], fallback.frozenAt || '')),
    frozenBy: clean(first(raw, ['frozenBy', 'frozen_by'], fallback.frozenBy || '')),
    issuedAt: timestampText(first(raw, ['issuedAt', 'issued_at'], fallback.issuedAt || '')),
    issuedBy: clean(first(raw, ['issuedBy', 'issued_by'], fallback.issuedBy || '')),
    reviewSubmittedAt: timestampText(first(raw, [
      'reviewSubmittedAt',
      'review_submitted_at',
      'reviewedAt',
      'reviewed_at',
    ], fallback.reviewSubmittedAt || '')),
    reviewSubmittedBy: clean(first(raw, [
      'reviewSubmittedBy',
      'review_submitted_by',
      'reviewedBy',
      'reviewed_by',
    ], fallback.reviewSubmittedBy || '')),
    approvedAt: timestampText(first(raw, ['approvedAt', 'approved_at'], fallback.approvedAt || '')),
    approvedBy: clean(first(raw, ['approvedBy', 'approved_by'], fallback.approvedBy || '')),
    createdAt: timestampText(first(raw, ['createdAt', 'created_at'], fallback.createdAt || '')),
    createdBy: clean(first(raw, ['createdBy', 'created_by'], fallback.createdBy || '')),
  });
}

function assertStoreAdapter(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw managementError(
      'CONTRACT_STORE_ADAPTER_INVALID',
      'A contract management store adapter is required.',
      { missingMethods: STORE_METHODS },
      500,
    );
  }
  const missingMethods = STORE_METHODS.filter((name) => typeof store[name] !== 'function');
  if (missingMethods.length > 0) {
    throw managementError(
      'CONTRACT_STORE_ADAPTER_INVALID',
      'The contract management store adapter is incomplete.',
      { missingMethods },
      500,
    );
  }
  return store;
}

function unwrapStoreResult(result, operation) {
  if (result && typeof result === 'object' && clean(result.skipped)) {
    throw managementError(
      'CONTRACT_STORE_UNAVAILABLE',
      `Contract store skipped ${operation}.`,
      { operation, reason: clean(result.skipped) },
      503,
    );
  }
  if (result && typeof result === 'object' && own(result, 'value')) return result.value;
  return result;
}

function validateClock(clock) {
  if (typeof clock !== 'function') {
    throw managementError(
      'CONTRACT_CLOCK_INVALID',
      'Contract management clock must be a function.',
      {},
      500,
    );
  }
  return clock;
}

function nowIso(clock) {
  // Reuse the domain's offset-aware event-time parser. The resulting UTC value
  // is also used as the service observation time for non-signing operations.
  return contractEventTime('version_frozen', clock()).at;
}

function assertContractScope(scope, contract) {
  const project = requireProjectReference(contract);
  assertProjectScope(scope, project);
  return project;
}

function assertVersionBelongsToContract(version, contract) {
  if (!version.contractId || version.contractId !== contract.id) {
    throw managementError(
      'CONTRACT_VERSION_NOT_FOUND',
      'The requested version does not belong to the contract.',
      { contractId: contract.id, versionId: version.id },
      404,
    );
  }
  return version;
}

function contractAmount(contract) {
  if (contract.amount === undefined || contract.amount === null || contract.amount === '') return undefined;
  return contract.amount;
}

function draftPackage(input) {
  const snapshot = input.snapshot && typeof input.snapshot === 'object' && !Array.isArray(input.snapshot)
    ? input.snapshot
    : {};
  return first(input, ['documentPackage', 'contractPackage', 'package'],
    first(snapshot, ['documentPackage', 'contractPackage', 'package'], {}));
}

function draftSnapshot(input, documentPackage) {
  const snapshot = input.snapshot && typeof input.snapshot === 'object' && !Array.isArray(input.snapshot)
    ? cloneValue(input.snapshot)
    : {};
  snapshot.documentPackage = cloneValue(documentPackage || {});
  return snapshot;
}

function documentIdentity(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return '';
  const fileId = clean(first(document, ['fileId', 'file_id', 'driveFileId', 'drive_file_id']));
  if (fileId) return `file:${fileId}`;
  const hash = clean(first(document, ['sha256', 'contentSha256', 'contentHash'])).toLowerCase();
  if (hash) return `sha256:${hash}`;
  const url = clean(first(document, ['url', 'webViewLink']));
  if (url) return `url:${url}`;
  return '';
}

function normalizeAttachmentExclusion(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (/^(?:file|sha256|url):/.test(raw)) return raw;
  return `file:${raw}`;
}

function cumulativeAttachmentExclusions(versions, input) {
  const values = [];
  for (const version of versions) {
    const snapshot = version?.snapshot || {};
    if (Array.isArray(snapshot.attachmentExclusions)) values.push(...snapshot.attachmentExclusions);
  }
  if (Array.isArray(input.attachmentExclusions)) values.push(...input.attachmentExclusions);
  if (Array.isArray(input.snapshot?.attachmentExclusions)) values.push(...input.snapshot.attachmentExclusions);
  return [...new Set(values.map(normalizeAttachmentExclusion).filter(Boolean))].sort();
}

function withoutExcludedDocuments(requestedPackage, exclusions) {
  const documentPackage = cloneValue(
    requestedPackage && typeof requestedPackage === 'object' && !Array.isArray(requestedPackage)
      ? requestedPackage
      : {},
  );
  const excluded = new Set(exclusions);
  const retained = (document) => !excluded.has(documentIdentity(document));
  if (documentPackage.contractBody && !retained(documentPackage.contractBody)) delete documentPackage.contractBody;
  if (Array.isArray(documentPackage.constructionDrawings)) {
    documentPackage.constructionDrawings = documentPackage.constructionDrawings.filter(retained);
  }
  if (documentPackage.quotation && !retained(documentPackage.quotation)) delete documentPackage.quotation;
  if (Array.isArray(documentPackage.attachments)) {
    documentPackage.attachments = documentPackage.attachments.filter(retained);
    if (!documentPackage.attachments.length) delete documentPackage.attachments;
  }
  return documentPackage;
}

function packageDocuments(documentPackage, sourceVersionNo = 0) {
  const pkg = documentPackage && typeof documentPackage === 'object' && !Array.isArray(documentPackage)
    ? documentPackage
    : {};
  const output = [];
  const add = (document, category) => {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return;
    output.push({
      ...cloneValue(document),
      category: clean(document.category) || category,
      sourceVersionNo: Number(document.sourceVersionNo) || sourceVersionNo || undefined,
    });
  };
  add(pkg.contractBody, 'contract_body');
  for (const drawing of Array.isArray(pkg.constructionDrawings) ? pkg.constructionDrawings : []) {
    add(drawing, 'construction_drawing');
  }
  add(pkg.quotation, 'quotation');
  for (const attachment of Array.isArray(pkg.attachments) ? pkg.attachments : []) {
    add(attachment, clean(attachment?.category) || 'other');
  }
  return output;
}

function inheritHistoricalAttachments(versions, requestedPackage, nextVersionNo, exclusions = []) {
  const documentPackage = cloneValue(
    requestedPackage && typeof requestedPackage === 'object' && !Array.isArray(requestedPackage)
      ? requestedPackage
      : {},
  );
  const existingAttachments = Array.isArray(documentPackage.attachments)
    ? cloneValue(documentPackage.attachments)
    : [];
  const currentDocuments = packageDocuments({ ...documentPackage, attachments: existingAttachments }, nextVersionNo);
  const seen = new Set(currentDocuments.map(documentIdentity).filter(Boolean));
  const excluded = new Set(exclusions);
  const inherited = [];
  const ordered = [...versions].sort((a, b) => a.versionNo - b.versionNo || a.createdAt.localeCompare(b.createdAt));
  for (const version of ordered) {
    for (const document of packageDocuments(packageFromVersion(version), version.versionNo)) {
      const identity = documentIdentity(document);
      if (!identity || excluded.has(identity) || seen.has(identity)) continue;
      seen.add(identity);
      const sourceVersionNo = Number(document.sourceVersionNo) || version.versionNo;
      inherited.push({
        ...document,
        sourceVersionNo,
        revision: clean(document.revision) || `V${sourceVersionNo}`,
        inherited: true,
      });
    }
  }
  if (existingAttachments.length || inherited.length) {
    documentPackage.attachments = [...existingAttachments, ...inherited];
  } else {
    delete documentPackage.attachments;
  }
  return {
    documentPackage,
    inheritedCount: inherited.length,
    sourceVersionNos: [...new Set(inherited.map((item) => Number(item.sourceVersionNo)).filter(Boolean))].sort((a, b) => a - b),
  };
}

function rejectVersionContentOverride(input, operation) {
  for (const field of VERSION_CONTENT_INPUT_FIELDS) {
    if (own(input, field)) {
      throw managementError(
        'VERSION_CONTENT_OVERRIDE_FORBIDDEN',
        `${operation} uses the authoritative stored version and cannot replace its content.`,
        { field, operation },
        409,
      );
    }
  }
  for (const field of ['status', 'nextStatus', 'expectedStatus']) {
    if (own(input, field)) {
      throw managementError(
        'VERSION_STATUS_OVERRIDE_FORBIDDEN',
        `${operation} determines its legal status transition on the server.`,
        { field, operation },
        409,
      );
    }
  }
}

function requiredAttachmentEvidenceErrors(validation) {
  const manifest = Array.isArray(validation?.manifest) ? validation.manifest : [];
  const errors = [];
  for (const category of REQUIRED_BUNDLE_ATTACHMENT_CATEGORIES) {
    if (!manifest.some((item) => item.category === category && item.required === true)) {
      errors.push({
        code: 'REQUIRED_ATTACHMENT_CATEGORY_MISSING',
        path: 'attachments',
        message: `The frozen bundle needs a required ${category} attachment.`,
        category,
      });
    }
  }
  for (let index = 0; index < manifest.length; index += 1) {
    const attachment = manifest[index];
    if (attachment.required !== true) continue;
    if (!clean(attachment.fileId)) {
      errors.push({
        code: 'REQUIRED_ATTACHMENT_FILE_ID',
        path: `manifest[${index}].fileId`,
        message: 'Every required attachment needs an immutable storage file id.',
        category: attachment.category,
        name: attachment.name,
      });
    }
    if (!/^[a-f0-9]{64}$/.test(clean(attachment.sha256).toLowerCase())) {
      errors.push({
        code: 'REQUIRED_ATTACHMENT_SHA256',
        path: `manifest[${index}].sha256`,
        message: 'Every required attachment needs a 64-character SHA-256 content hash.',
        category: attachment.category,
        name: attachment.name,
      });
    }
  }
  return errors;
}

function assertFreezeAttachmentEvidence(validation) {
  const errors = requiredAttachmentEvidenceErrors(validation);
  if (errors.length > 0) {
    throw managementError(
      'CONTRACT_PACKAGE_INCOMPLETE',
      'Contract attachments are not eligible for an immutable frozen bundle.',
      { missing: [], errors },
      422,
    );
  }
  return validation;
}

function requestProjectReferences(input) {
  const refs = [];
  if (input.project) refs.push(projectReference(input.project));
  if (Array.isArray(input.projects)) {
    for (const project of input.projects) refs.push(projectReference(project));
  }
  if (Array.isArray(input.projectIds)) {
    const codes = Array.isArray(input.projectCodes) ? input.projectCodes : [];
    for (let index = 0; index < input.projectIds.length; index += 1) {
      refs.push({ id: clean(input.projectIds[index]), code: clean(codes[index]) });
    }
  }
  if (input.projectId) refs.push(projectReference(input));

  const unique = new Map();
  for (const project of refs) {
    if (!project.id && !project.code) continue;
    unique.set(`${project.id}\u0000${project.code}`, project);
  }
  return [...unique.values()];
}

function readinessBlockers(version, validation) {
  const blockers = [];
  if (version.status !== 'frozen' || !isVersionFrozen(version)) {
    blockers.push({
      code: 'VERSION_NOT_ACTIVE_FROZEN',
      path: 'version.status',
      message: 'Only the active frozen version can be issued.',
      status: version.status,
    });
  }
  if (!version.frozenAt || !version.frozenBy) {
    blockers.push({
      code: 'VERSION_FREEZE_EVIDENCE_MISSING',
      path: !version.frozenAt ? 'version.frozenAt' : 'version.frozenBy',
      message: 'The frozen version is missing authoritative freeze time or actor evidence.',
      missing: [
        ...(!version.frozenAt ? ['frozenAt'] : []),
        ...(!version.frozenBy ? ['frozenBy'] : []),
      ],
    });
  }
  if (version.issuedAt) {
    blockers.push({
      code: 'VERSION_ALREADY_ISSUED',
      path: 'version.issuedAt',
      message: 'This version has already been issued.',
      issuedAt: version.issuedAt,
    });
  }
  for (const field of validation.missing) {
    blockers.push({
      code: 'REQUIRED_CONTRACT_SECTION_MISSING',
      path: field,
      message: `Required contract section is missing: ${field}.`,
      field,
    });
  }
  for (const error of validation.errors) blockers.push(cloneValue(error));
  for (const error of requiredAttachmentEvidenceErrors(validation)) blockers.push(cloneValue(error));
  const contractFields = packageFromVersion(version).contractFields;
  if (contractFields && typeof contractFields === 'object') {
    const required = {
      trade: '工種', counterpartyName: '承攬對象', projectName: '工程名稱', projectAddress: '工程地址',
      workScope: '工程範圍', partyAOrganization: '甲方主體／公司',
      partyAResponsiblePerson: '甲方負責人', partyARepresentative: '甲方代表人／簽約人', partyAAddress: '甲方地址',
      startDate: '進場日', completionDate: '完工日', warrantyMonths: '保固月數',
      performanceBondPercent: '履約保證比例', performanceBondAmount: '履約保證／本票金額',
      promissoryNoteDueDate: '本票到期日', delayPenaltyPercent: '逾期違約金比例', signingDate: '立約日期',
    };
    for (const [field, label] of Object.entries(required)) {
      const value = contractFields[field];
      if (value === undefined || value === null || String(value).trim() === '') blockers.push({
        code: 'REQUIRED_LEGAL_FIELD_MISSING', path: `documentPackage.contractFields.${field}`,
        message: `正式送簽前請補齊：${label}。`, field, label,
      });
    }
    const profileId = clean(contractFields.partyAProfileId);
    if (profileId) {
      const profileType = clean(contractFields.partyAProfileType);
      const profileSnapshot = contractFields.partyAProfileSnapshot;
      const assets = profileSnapshot?.assets && typeof profileSnapshot.assets === 'object'
        ? profileSnapshot.assets : {};
      const requiredAssets = profileType === 'company' ? ['large_seal']
        : (profileType === 'individual' ? ['signature'] : []);
      if (!requiredAssets.length) blockers.push({
        code: 'PARTY_A_PROFILE_TYPE_INVALID', path: 'documentPackage.contractFields.partyAProfileType',
        message: '甲方主檔類型不完整，請重新選擇甲方。', field: 'partyAProfileType',
      });
      for (const kind of requiredAssets) if (!assets[kind]?.fileId || !assets[kind]?.sha256) blockers.push({
        code: 'PARTY_A_SIGNING_ASSET_MISSING', path: `documentPackage.contractFields.partyAProfileSnapshot.assets.${kind}`,
        message: profileType === 'company' ? '公司甲方必須保存公司大章快照。' : '個人甲方必須保存簽名快照。',
        field: kind,
      });
    }
  }

  if (!version.attachmentManifestHash) {
    blockers.push({
      code: 'ATTACHMENT_MANIFEST_HASH_MISSING',
      path: 'version.attachmentManifestHash',
      message: 'The frozen version has no attachment manifest hash.',
    });
  } else if (validation.manifestHash && version.attachmentManifestHash !== validation.manifestHash) {
    blockers.push({
      code: 'ATTACHMENT_MANIFEST_HASH_MISMATCH',
      path: 'version.attachmentManifestHash',
      message: 'The stored frozen manifest hash does not match the document package.',
      expected: validation.manifestHash,
      actual: version.attachmentManifestHash,
    });
  }
  return blockers;
}

/**
 * Create the internal contract-management service.
 *
 * Every call receives a server-owned context:
 * `{ tenant: { key }, actor, scope }`. Input actor fields are ignored. `scope`
 * must be explicit; use `'all'` only when the server has authorized all projects.
 */
export function createContractManagementService({ store, clock = () => new Date() } = {}) {
  const adapter = assertStoreAdapter(store);
  const serviceClock = validateClock(clock);

  async function createOrSyncContract(context, input = {}) {
    const { tenant, actor, scope } = requireServiceContext(context);
    requireObject(input, 'input');
    const project = requireProjectReference(input);
    assertProjectScope(scope, project);

    const notionContractPageId = requireText(
      first(input, ['notionContractPageId', 'notion_contract_page_id']),
      'NOTION_CONTRACT_PAGE_REQUIRED',
      'A Notion contract page id is required to create or synchronize a contract.',
      'notionContractPageId',
    );
    const title = requireText(
      first(input, ['title', 'contractTitle']),
      'CONTRACT_TITLE_REQUIRED',
      'Contract title is required.',
      'title',
    );
    const observedAt = nowIso(serviceClock);
    const amount = first(input, ['amount'], null);
    if (amount !== null && amount !== '' && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
      throw managementError(
        'CONTRACT_AMOUNT_RANGE',
        'Contract amount must be greater than 0 when provided.',
        { amount },
      );
    }

    const stored = unwrapStoreResult(await adapter.upsertContract(tenant, {
      projectId: project.id,
      projectCode: project.code,
      notionContractPageId,
      contractNumber: clean(first(input, ['contractNumber', 'contract_number'])),
      title,
      trade: clean(input.trade),
      counterpartyName: clean(first(input, ['counterpartyName', 'counterparty_name'])),
      counterpartyCompany: clean(first(input, ['counterpartyCompany', 'counterparty_company'])),
      counterpartyTitle: clean(first(input, ['counterpartyTitle', 'counterparty_title'])),
      amount: amount === null || amount === '' ? null : Number(amount),
      currency: clean(input.currency) || 'TWD',
      workflowState: clean(first(input, ['workflowState', 'workflow_state'])) || 'draft',
      executionStatus: clean(first(input, ['executionStatus', 'execution_status'])) || 'not_started',
      budgetItemId: clean(first(input, ['budgetItemId', 'budget_item_id'])),
      groupBindingId: clean(first(input, ['groupBindingId', 'group_binding_id'])),
      actor,
      observedAt,
    }), 'upsertContract');
    if (!stored) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'upsertContract did not return a contract.',
        { operation: 'upsertContract' },
        500,
      );
    }
    const contract = normalizeContract(stored);
    if (!contract.id || contract.projectId !== project.id) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'upsertContract returned an invalid or differently scoped contract.',
        { operation: 'upsertContract', expectedProjectId: project.id, actualProjectId: contract.projectId },
        500,
      );
    }
    assertContractScope(scope, contract);
    return freezeTree({ contract, synchronizedAt: observedAt, synchronizedBy: actor });
  }

  async function loadContract(context, selector) {
    const authority = requireServiceContext(context);
    requireObject(selector, 'selector');
    const contractId = clean(first(selector, ['contractId', 'contract_id']));
    const notionContractPageId = clean(first(selector, [
      'notionContractPageId',
      'notion_contract_page_id',
    ]));
    if (!contractId && !notionContractPageId) {
      throw managementError(
        'CONTRACT_REFERENCE_REQUIRED',
        'contractId or notionContractPageId is required.',
        {},
      );
    }
    const stored = unwrapStoreResult(await adapter.getContract(authority.tenant, {
      contractId: contractId || undefined,
      notionContractPageId: notionContractPageId || undefined,
    }), 'getContract');
    if (!stored) {
      throw managementError('CONTRACT_NOT_FOUND', 'Contract not found.', {}, 404);
    }
    const contract = normalizeContract(stored);
    if (!contract.id) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'getContract returned a contract without id.',
        { operation: 'getContract' },
        500,
      );
    }
    assertContractScope(authority.scope, contract);
    return { ...authority, contract };
  }

  async function loadContractAndVersion(context, input) {
    const loaded = await loadContract(context, input);
    const versionId = requireText(
      first(input, ['versionId', 'version_id']),
      'CONTRACT_VERSION_REFERENCE_REQUIRED',
      'versionId is required.',
      'versionId',
    );
    const stored = unwrapStoreResult(await adapter.getVersion(loaded.tenant, versionId), 'getVersion');
    if (!stored) {
      throw managementError('CONTRACT_VERSION_NOT_FOUND', 'Contract version not found.', {}, 404);
    }
    const version = normalizeVersion(stored);
    if (!version.id) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'getVersion returned a version without id.',
        { operation: 'getVersion' },
        500,
      );
    }
    assertVersionBelongsToContract(version, loaded.contract);
    return { ...loaded, version };
  }

  async function createDraftVersion(context, input = {}) {
    requireObject(input, 'input');
    if (clean(first(input, ['versionId', 'version_id']))) {
      throw managementError(
        'VERSION_INSERT_ONLY',
        'createDraftVersion creates a new version and cannot update an existing version id.',
        { field: 'versionId' },
        409,
      );
    }
    const { tenant, actor, contract } = await loadContract(context, input);
    const listed = unwrapStoreResult(await adapter.listVersions(tenant, contract.id), 'listVersions');
    if (!Array.isArray(listed)) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'listVersions must return an array.',
        { operation: 'listVersions' },
        500,
      );
    }
    const versions = listed.map((value) => normalizeVersion(value));
    for (const version of versions) assertVersionBelongsToContract(version, contract);
    const maxVersionNo = versions.reduce((max, version) => Math.max(max, version.versionNo || 0), 0);
    const versionNo = input.versionNo === undefined || input.versionNo === null || input.versionNo === ''
      ? maxVersionNo + 1
      : normalizePositiveInteger(input.versionNo, 'versionNo');
    if (versions.some((version) => version.versionNo === versionNo)) {
      throw managementError(
        'CONTRACT_VERSION_NUMBER_EXISTS',
        'A contract version with this number already exists.',
        { contractId: contract.id, versionNo },
        409,
      );
    }

    const attachmentExclusions = cumulativeAttachmentExclusions(versions, input);
    const requestedPackage = withoutExcludedDocuments(draftPackage(input), attachmentExclusions);
    const inheritance = inheritHistoricalAttachments(versions, requestedPackage, versionNo, attachmentExclusions);
    const documentPackage = inheritance.documentPackage;
    const validation = validateContractPackage(documentPackage, { contractAmount: contractAmount(contract) });
    const snapshot = draftSnapshot(input, documentPackage);
    snapshot.attachmentLineage = {
      mode: 'cumulative',
      inheritedCount: inheritance.inheritedCount,
      sourceVersionNos: inheritance.sourceVersionNos,
    };
    snapshot.attachmentExclusions = attachmentExclusions;
    const createdAt = nowIso(serviceClock);
    const stored = unwrapStoreResult(await adapter.createVersion(tenant, {
      contractId: contract.id,
      versionNo,
      status: 'draft',
      snapshot,
      documentPackage: cloneValue(documentPackage),
      manifest: cloneValue(validation.manifest),
      attachmentManifestHash: validation.manifestHash || null,
      bundleSha256: validation.manifestHash || null,
      actor,
      createdAt,
    }), 'createVersion');
    if (!stored) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'createVersion did not return a version.',
        { operation: 'createVersion' },
        500,
      );
    }
    const version = normalizeVersion(stored, {
      contractId: contract.id,
      versionNo,
      status: 'draft',
      snapshot,
      manifest: validation.manifest,
      attachmentManifestHash: validation.manifestHash,
      createdAt,
      createdBy: actor,
    });
    if (!version.id || version.contractId !== contract.id || version.versionNo !== versionNo || version.status !== 'draft') {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'createVersion must return the newly inserted draft version.',
        { operation: 'createVersion', contractId: contract.id, versionNo, status: version.status },
        500,
      );
    }
    return freezeTree({
      contract,
      version,
      packageValidation: validation,
      createdAt,
      createdBy: actor,
    });
  }

  async function transitionManagedVersion(context, input, definition) {
    requireObject(input, 'input');
    rejectVersionContentOverride(input, definition.operation);
    const { tenant, actor, contract, version } = await loadContractAndVersion(context, input);
    const contentFingerprint = versionContentFingerprint(version);
    const transitioned = patchContractVersion(version, { status: definition.to });
    const transitionedAt = nowIso(serviceClock);
    const transitionEvidence = definition.timeField && definition.actorField ? {
      [definition.timeField]: transitionedAt,
      [definition.actorField]: actor,
    } : {};
    const candidate = normalizeVersion({
      ...transitioned,
      ...transitionEvidence,
    });
    const stored = unwrapStoreResult(await adapter.transitionVersion(tenant, {
      versionId: version.id,
      contractId: contract.id,
      expectedStatus: definition.from,
      status: definition.to,
      nextStatus: definition.to,
      transitionedAt,
      transitionedBy: actor,
      transitionTimeField: definition.timeField || '',
      transitionActorField: definition.actorField || '',
      actor,
    }), 'transitionVersion');
    if (!stored) {
      throw managementError(
        'CONTRACT_VERSION_TRANSITION_CONFLICT',
        'The version status changed concurrently; reload before trying again.',
        {
          versionId: version.id,
          expectedStatus: definition.from,
          nextStatus: definition.to,
        },
        409,
      );
    }
    const persisted = normalizeVersion(stored, candidate);
    if (
      persisted.id !== version.id
      || persisted.contractId !== contract.id
      || persisted.status !== definition.to
      || (definition.timeField && persisted[definition.timeField] !== transitionedAt)
      || (definition.actorField && persisted[definition.actorField] !== actor)
      || versionContentFingerprint(persisted) !== contentFingerprint
    ) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'transitionVersion changed immutable content or did not persist the exact status evidence.',
        {
          operation: 'transitionVersion',
          versionId: version.id,
          expectedStatus: definition.from,
          nextStatus: definition.to,
        },
        500,
      );
    }
    return freezeTree({
      contract,
      version: persisted,
      transition: {
        from: definition.from,
        to: definition.to,
        at: transitionedAt,
        by: actor,
      },
    });
  }

  async function submitVersionForReview(context, input = {}) {
    return transitionManagedVersion(context, input, {
      operation: 'submitVersionForReview',
      from: 'draft',
      to: 'internal_review',
      timeField: 'reviewSubmittedAt',
      actorField: 'reviewSubmittedBy',
    });
  }

  async function returnVersionToDraft(context, input = {}) {
    return transitionManagedVersion(context, input, {
      operation: 'returnVersionToDraft',
      from: 'internal_review',
      to: 'draft',
    });
  }

  async function approveVersion(context, input = {}) {
    return transitionManagedVersion(context, input, {
      operation: 'approveVersion',
      from: 'internal_review',
      to: 'approved',
      timeField: 'approvedAt',
      actorField: 'approvedBy',
    });
  }

  async function freezeVersion(context, input = {}) {
    requireObject(input, 'input');
    rejectVersionContentOverride(input, 'freezeVersion');
    const { tenant, actor, contract, version } = await loadContractAndVersion(context, input);
    assertVersionMutable(version);
    const documentPackage = packageFromVersion(version);
    const validation = assertContractPackageComplete(documentPackage, {
      contractAmount: contractAmount(contract),
    });
    assertFreezeAttachmentEvidence(validation);
    const frozenAt = contractEventTime('version_frozen', serviceClock()).at;
    const frozen = freezeContractVersion(version, {
      at: frozenAt,
      serverContext: { actor },
      attachmentManifestHash: validation.manifestHash,
    });
    const stored = unwrapStoreResult(await adapter.freezeVersion(tenant, {
      versionId: version.id,
      contractId: contract.id,
      expectedStatus: 'approved',
      status: 'frozen',
      frozenAt: frozen.frozenAt,
      frozenBy: actor,
      manifest: cloneValue(validation.manifest),
      attachmentManifestHash: validation.manifestHash,
      bundleSha256: validation.manifestHash,
      actor,
    }), 'freezeVersion');
    if (!stored) {
      throw managementError(
        'CONTRACT_VERSION_FREEZE_CONFLICT',
        'The version could not be frozen because it changed concurrently.',
        { versionId: version.id, expectedStatus: 'approved' },
        409,
      );
    }
    const persisted = normalizeVersion(stored, frozen);
    if (
      persisted.id !== version.id
      || persisted.contractId !== contract.id
      || persisted.status !== 'frozen'
      || !isVersionFrozen(persisted)
      || persisted.attachmentManifestHash !== validation.manifestHash
      || persisted.frozenAt !== frozen.frozenAt
      || persisted.frozenBy !== actor
    ) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'freezeVersion did not persist the exact frozen version and manifest hash.',
        { operation: 'freezeVersion', versionId: version.id },
        500,
      );
    }
    return freezeTree({
      contract,
      version: persisted,
      packageValidation: validation,
      frozenAt: persisted.frozenAt,
      frozenBy: actor,
    });
  }

  async function issueReadiness(context, input = {}) {
    requireObject(input, 'input');
    const { actor, contract, version } = await loadContractAndVersion(context, input);
    const checkedAt = nowIso(serviceClock);
    const validation = validateContractPackage(packageFromVersion(version), {
      contractAmount: contractAmount(contract),
    });
    const blockers = readinessBlockers(version, validation);
    return freezeTree({
      ready: blockers.length === 0,
      blockers,
      contract,
      version,
      packageValidation: validation,
      checkedAt,
      checkedBy: actor,
    });
  }

  async function listContracts(context, input = {}) {
    const { tenant, actor, scope } = requireServiceContext(context);
    requireObject(input, 'input');
    const requestedProjects = requestProjectReferences(input);
    for (const project of requestedProjects) assertProjectScope(scope, project);
    const projectIds = requestedProjects.map((project) => project.id).filter(Boolean);
    const listed = unwrapStoreResult(await adapter.listContracts(
      tenant,
      projectIds.length > 0 ? projectIds : null,
    ), 'listContracts');
    if (!Array.isArray(listed)) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'listContracts must return an array.',
        { operation: 'listContracts' },
        500,
      );
    }
    const items = listed
      .map((value) => normalizeContract(value))
      .filter((contract) => {
        const project = projectReference(contract);
        if (!project.id) return false;
        if (!isProjectInScope(scope, project)) return false;
        if (requestedProjects.length === 0) return true;
        return requestedProjects.some((requested) => (
          (requested.id && requested.id === project.id)
          || (requested.code && requested.code.toLowerCase() === project.code.toLowerCase())
        ));
      });
    const listedAt = nowIso(serviceClock);
    return freezeTree({
      items,
      count: items.length,
      filters: { projects: requestedProjects },
      listedAt,
      listedBy: actor,
    });
  }

  async function getContractDetail(context, input = {}) {
    requireObject(input, 'input');
    const { tenant, actor, contract } = await loadContract(context, input);
    const listed = unwrapStoreResult(await adapter.listVersions(tenant, contract.id), 'listVersions');
    if (!Array.isArray(listed)) {
      throw managementError(
        'CONTRACT_STORE_ADAPTER_VIOLATION',
        'listVersions must return an array.',
        { operation: 'listVersions' },
        500,
      );
    }
    const versions = listed.map((value) => {
      const version = normalizeVersion(value);
      return assertVersionBelongsToContract(version, contract);
    }).sort((a, b) => b.versionNo - a.versionNo || b.createdAt.localeCompare(a.createdAt));
    const retrievedAt = nowIso(serviceClock);
    return freezeTree({
      contract,
      versions,
      latestVersion: versions[0] || null,
      retrievedAt,
      retrievedBy: actor,
    });
  }

  return Object.freeze({
    createOrSyncContract,
    createDraftVersion,
    submitVersionForReview,
    returnVersionToDraft,
    approveVersion,
    freezeVersion,
    issueReadiness,
    listContracts,
    getContractDetail,
    list: listContracts,
    detail: getContractDetail,
    'issue-readiness': issueReadiness,
  });
}

export const createEngineeringContractManagementService = createContractManagementService;

// Engineering contract management — pure domain rules.
//
// This module intentionally has no persistence, HTTP, Portal, Notion, or Drive
// behavior.  Existing route handlers can call these functions before they write
// anything, while storage adapters remain responsible for loading authoritative
// server context and saving the returned values.

import { createHash } from 'node:crypto';

export class ContractDomainError extends Error {
  constructor(code, message, details = {}, statusCode = 400) {
    super(message);
    this.name = 'ContractDomainError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = deepFreeze(cloneValue(details));
  }
}

export const CONTRACT_VERSION_STATUSES = Object.freeze([
  'draft',
  'internal_review',
  'approved',
  'frozen',
  'superseded',
  'voided',
]);

export const SIGNING_STATUSES = Object.freeze([
  'not_issued',
  'issued',
  'sent',
  'opened',
  'signed_pending_review',
  'revision_required',
  'confirmed',
  'expired',
  'revoked',
  'declined',
]);

export const CONTRACT_VERSION_TRANSITIONS = freezeTransitions({
  draft: ['internal_review', 'voided'],
  internal_review: ['draft', 'approved', 'voided'],
  approved: ['draft', 'frozen', 'voided'],
  frozen: ['superseded', 'voided'],
  superseded: [],
  voided: [],
});

export const SIGNING_TRANSITIONS = freezeTransitions({
  not_issued: ['issued'],
  issued: ['sent', 'opened', 'signed_pending_review', 'expired', 'revoked', 'declined'],
  sent: ['opened', 'signed_pending_review', 'expired', 'revoked', 'declined'],
  opened: ['signed_pending_review', 'expired', 'revoked', 'declined'],
  signed_pending_review: ['revision_required', 'confirmed', 'revoked'],
  revision_required: ['signed_pending_review', 'expired', 'revoked', 'declined'],
  confirmed: [],
  expired: [],
  revoked: [],
  declined: [],
});

export const REQUIRED_CONTRACT_PACKAGE_FIELDS = Object.freeze([
  'contractBody',
  'constructionDrawings',
  'quotation',
  'paymentMilestones',
  'acceptanceCriteria',
]);

export const ATTACHMENT_CATEGORIES = Object.freeze([
  'contract_body',
  'construction_drawing',
  'quotation',
  'other',
]);

// Times are server-observed event times.  In particular, sentAt is not a read
// receipt and firstOpenedAt is not proof of identity.
export const CONTRACT_EVENT_TIME_DEFINITIONS = deepFreeze({
  version_frozen: {
    field: 'frozenAt',
    meaning: 'The approved document package was frozen by the server.',
  },
  issued: {
    field: 'issuedAt',
    meaning: 'A signing session was issued for the frozen version.',
  },
  send_succeeded: {
    field: 'sentAt',
    meaning: 'The configured delivery provider accepted the outbound message.',
  },
  first_opened: {
    field: 'firstOpenedAt',
    meaning: 'The recipient link was first opened and observed by the server.',
  },
  signature_submitted: {
    field: 'signedAt',
    meaning: 'The signer submitted the signature action.',
  },
  submission_received: {
    field: 'submissionReceivedAt',
    meaning: 'The server successfully persisted the submitted signing payload.',
  },
  revision_requested: {
    field: 'revisionRequestedAt',
    meaning: 'An internal reviewer requested a replacement signature or evidence.',
  },
  revision_resubmitted: {
    field: 'revisionResubmittedAt',
    meaning: 'The signer resubmitted the requested material.',
  },
  confirmed: {
    field: 'confirmedAt',
    meaning: 'An authorized internal reviewer confirmed and archived the result.',
  },
  expired: {
    field: 'expiredAt',
    meaning: 'The signing session expired without confirmation.',
  },
  revoked: {
    field: 'revokedAt',
    meaning: 'An authorized internal actor revoked the signing session.',
  },
  declined: {
    field: 'declinedAt',
    meaning: 'The recipient declined the signing request.',
  },
  superseded: {
    field: 'supersededAt',
    meaning: 'A later frozen document version replaced this version.',
  },
});

const FROZEN_VERSION_STATUSES = new Set(['frozen', 'superseded', 'voided']);
const CATEGORY_ORDER = new Map(ATTACHMENT_CATEGORIES.map((value, index) => [value, index]));
const CATEGORY_ALIASES = Object.freeze({
  contract_body: 'contract_body',
  contract: 'contract_body',
  body: 'contract_body',
  '合約本文': 'contract_body',
  '正文': 'contract_body',
  construction_drawing: 'construction_drawing',
  drawing: 'construction_drawing',
  drawings: 'construction_drawing',
  '施工圖': 'construction_drawing',
  '圖面': 'construction_drawing',
  quotation: 'quotation',
  quote: 'quotation',
  '報價單': 'quotation',
  '報價': 'quotation',
  other: 'other',
  '其他': 'other',
});

function freezeTransitions(definition) {
  const output = {};
  for (const [from, targets] of Object.entries(definition)) {
    output[from] = Object.freeze([...targets]);
  }
  return Object.freeze(output);
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clean(value) {
  return String(value ?? '').trim();
}

function domainError(code, message, details = {}, statusCode = 400) {
  return new ContractDomainError(code, message, details, statusCode);
}

function requireRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('INVALID_ARGUMENT', name + ' must be an object.', { field: name });
  }
  return value;
}

function parseFiniteNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw domainError('INVALID_NUMBER', field + ' must be a finite number.', { field, value });
  }
  return number;
}

function normalizeId(value) {
  return clean(value).replace(/-/g, '').toLowerCase();
}

function normalizeScopeValue(value) {
  return clean(value).toLowerCase();
}

function issue(code, path, message, details = {}) {
  return Object.freeze({ code, path, message, ...details });
}

function fixedNumber(value, digits = 6) {
  return Number(Number(value || 0).toFixed(digits));
}

function validCalendarDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeIsoTimestamp(value, field = 'at') {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw domainError('INVALID_EVENT_TIME', field + ' is not a valid date.', { field });
    }
    return value.toISOString();
  }
  const text = clean(value);
  if (!text) {
    throw domainError('EVENT_TIME_REQUIRED', field + ' is required.', { field });
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    throw domainError(
      'EVENT_TIME_OFFSET_REQUIRED',
      field + ' must include an explicit UTC offset.',
      { field, value: text },
    );
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw domainError('INVALID_EVENT_TIME', field + ' is not a valid timestamp.', { field, value: text });
  }
  return new Date(parsed).toISOString();
}

function transitionAllowed(table, from, to) {
  return Boolean(table[from] && table[to] && table[from].includes(to));
}

function assertTransition(table, kind, from, to) {
  if (!table[from]) {
    throw domainError('UNKNOWN_' + kind + '_STATUS', 'Unknown ' + kind.toLowerCase() + ' status: ' + from, { from, to });
  }
  if (!table[to]) {
    throw domainError('UNKNOWN_' + kind + '_STATUS', 'Unknown ' + kind.toLowerCase() + ' status: ' + to, { from, to });
  }
  if (!transitionAllowed(table, from, to)) {
    throw domainError(
      'INVALID_' + kind + '_TRANSITION',
      'Illegal ' + kind.toLowerCase() + ' transition from ' + from + ' to ' + to + '.',
      { from, to, allowed: table[from] },
      409,
    );
  }
  return to;
}

export function canTransitionVersionStatus(from, to) {
  return transitionAllowed(CONTRACT_VERSION_TRANSITIONS, clean(from), clean(to));
}

export function assertVersionStatusTransition(from, to) {
  return assertTransition(CONTRACT_VERSION_TRANSITIONS, 'VERSION', clean(from), clean(to));
}

export function canTransitionSigningStatus(from, to) {
  return transitionAllowed(SIGNING_TRANSITIONS, clean(from), clean(to));
}

export function assertSigningStatusTransition(from, to) {
  return assertTransition(SIGNING_TRANSITIONS, 'SIGNING', clean(from), clean(to));
}

export function requireServerActor(serverContext) {
  if (!serverContext || typeof serverContext !== 'object' || Array.isArray(serverContext)) {
    throw domainError(
      'SERVER_ACTOR_REQUIRED',
      'An authoritative server context with actor is required.',
      {},
      403,
    );
  }
  const actor = clean(serverContext.actor || serverContext.access?.actor);
  if (!actor) {
    throw domainError(
      'SERVER_ACTOR_REQUIRED',
      'An authoritative server actor is required.',
      {},
      403,
    );
  }
  return actor;
}

export function isProjectInScope(scope, project) {
  if (scope === null || scope === undefined || scope === 'all') return true;
  if (scope === 'none') return false;

  const source = typeof project === 'string' ? { id: project, code: project } : (project || {});
  const id = normalizeId(source.id || source.projectId || source.pageId);
  const code = normalizeScopeValue(source.code || source.projectCode);
  if (!id && !code) return false;

  const matches = (values, type = 'either') => {
    const list = values instanceof Set ? [...values] : (Array.isArray(values) ? values : []);
    for (const value of list) {
      if ((type === 'id' || type === 'either') && id && normalizeId(value) === id) return true;
      if ((type === 'code' || type === 'either') && code && normalizeScopeValue(value) === code) return true;
    }
    return false;
  };

  if (scope instanceof Set || Array.isArray(scope)) return matches(scope);
  if (!scope || typeof scope !== 'object') return false;
  if (scope.all === true) return true;

  return matches(scope.projectIds || scope.allowedProjectIds, 'id')
    || matches(scope.projectCodes || scope.allowedProjectCodes, 'code');
}

export function assertProjectScope(scope, project) {
  if (!isProjectInScope(scope, project)) {
    throw domainError(
      'PROJECT_SCOPE_DENIED',
      'The contract project is outside the authorized project scope.',
      {
        projectId: clean(project?.id || project?.projectId || project?.pageId || (typeof project === 'string' ? project : '')),
        projectCode: clean(project?.code || project?.projectCode),
      },
      404,
    );
  }
  return project;
}

export function contractEventTime(eventType, at) {
  const type = clean(eventType);
  const definition = CONTRACT_EVENT_TIME_DEFINITIONS[type];
  if (!definition) {
    throw domainError('UNKNOWN_CONTRACT_EVENT', 'Unknown contract event type: ' + type, { eventType: type });
  }
  return deepFreeze({
    eventType: type,
    timeField: definition.field,
    at: normalizeIsoTimestamp(at, definition.field),
  });
}

export function isVersionFrozen(version) {
  if (!version || typeof version !== 'object') return false;
  return FROZEN_VERSION_STATUSES.has(clean(version.status)) || Boolean(clean(version.frozenAt));
}

export function assertVersionMutable(version) {
  requireRecord(version, 'version');
  if (isVersionFrozen(version)) {
    throw domainError(
      'CONTRACT_VERSION_FROZEN',
      'A frozen, superseded, or voided contract version cannot be edited in place.',
      { id: clean(version.id), status: clean(version.status), frozenAt: clean(version.frozenAt) },
      409,
    );
  }
  return version;
}

export function patchContractVersion(version, patch) {
  assertVersionMutable(version);
  requireRecord(patch, 'patch');
  for (const field of ['frozenAt', 'frozenBy', 'attachmentManifestHash']) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      throw domainError(
        'IMMUTABLE_VERSION_FIELD',
        field + ' may only be written by freezeContractVersion().',
        { field },
        409,
      );
    }
  }
  const from = clean(version.status || 'draft');
  const to = Object.prototype.hasOwnProperty.call(patch, 'status') ? clean(patch.status) : from;
  if (to === 'frozen') {
    throw domainError(
      'USE_FREEZE_CONTRACT_VERSION',
      'Use freezeContractVersion() to create a frozen version.',
      { from, to },
      409,
    );
  }
  if (to !== from) assertVersionStatusTransition(from, to);
  return { ...cloneValue(version), ...cloneValue(patch), status: to };
}

export function freezeContractVersion(version, { at, serverContext, attachmentManifestHash } = {}) {
  assertVersionMutable(version);
  const from = clean(version.status || 'draft');
  assertVersionStatusTransition(from, 'frozen');
  const actor = requireServerActor(serverContext);
  const manifestHash = clean(attachmentManifestHash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) {
    throw domainError(
      'ATTACHMENT_MANIFEST_HASH_REQUIRED',
      'A SHA-256 attachment manifest hash is required before freezing.',
      { attachmentManifestHash },
    );
  }
  return deepFreeze({
    ...cloneValue(version),
    status: 'frozen',
    frozenAt: normalizeIsoTimestamp(at, 'frozenAt'),
    frozenBy: actor,
    attachmentManifestHash: manifestHash,
  });
}

function normalizeAttachmentCategory(value) {
  const raw = clean(value);
  const normalized = CATEGORY_ALIASES[raw] || CATEGORY_ALIASES[raw.toLowerCase()];
  if (!normalized) {
    throw domainError(
      'INVALID_ATTACHMENT_CATEGORY',
      'Unsupported attachment category: ' + raw,
      { category: raw, allowed: ATTACHMENT_CATEGORIES },
    );
  }
  return normalized;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || clean(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || clean(value).toLowerCase() === 'false') return false;
  throw domainError('INVALID_BOOLEAN', 'Expected a boolean value.', { value });
}

function normalizeNonNegativeInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw domainError('INVALID_INTEGER', field + ' must be a non-negative integer.', { field, value });
  }
  return number;
}

function normalizeManifestEntry(input, index) {
  requireRecord(input, 'attachments[' + index + ']');
  const category = normalizeAttachmentCategory(input.category || input.type);
  const name = clean(input.name || input.filename || input.fileName);
  if (!name) {
    throw domainError(
      'ATTACHMENT_NAME_REQUIRED',
      'Every attachment needs a display name.',
      { index },
    );
  }

  const fileId = clean(input.fileId || input.driveFileId || input.sourceId);
  const url = clean(input.url || input.webViewLink);
  const rawHash = clean(input.sha256 || input.contentSha256 || input.contentHash)
    .toLowerCase()
    .replace(/^sha256:/, '');
  if (rawHash && !/^[a-f0-9]{64}$/.test(rawHash)) {
    throw domainError(
      'INVALID_ATTACHMENT_SHA256',
      'Attachment sha256 must contain 64 hexadecimal characters.',
      { index, name, sha256: rawHash },
    );
  }
  if (!fileId && !url && !rawHash) {
    throw domainError(
      'ATTACHMENT_SOURCE_REQUIRED',
      'Every attachment needs a file id, URL, or content hash.',
      { index, name },
    );
  }

  return Object.freeze({
    category,
    name,
    revision: clean(input.revision || input.version),
    fileId,
    url,
    mimeType: clean(input.mimeType || input.contentType).toLowerCase(),
    sizeBytes: normalizeNonNegativeInteger(input.sizeBytes ?? input.size, 'attachments[' + index + '].sizeBytes'),
    pageCount: normalizeNonNegativeInteger(input.pageCount, 'attachments[' + index + '].pageCount'),
    sha256: rawHash,
    required: normalizeBoolean(input.required, category !== 'other'),
  });
}

function compareManifestEntries(a, b) {
  const category = CATEGORY_ORDER.get(a.category) - CATEGORY_ORDER.get(b.category);
  if (category !== 0) return category;
  for (const field of ['name', 'revision', 'fileId', 'url', 'sha256']) {
    // Code-point order is deliberately locale-independent: the same manifest
    // must hash identically on developer machines and production runtimes.
    if (a[field] < b[field]) return -1;
    if (a[field] > b[field]) return 1;
  }
  return 0;
}

export function canonicalizeAttachmentManifest(input) {
  const source = Array.isArray(input) ? input : input?.attachments;
  if (!Array.isArray(source)) {
    throw domainError('INVALID_ATTACHMENT_MANIFEST', 'Attachment manifest must be an array.', {});
  }
  const seen = new Set();
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = normalizeManifestEntry(source[index], index);
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  output.sort(compareManifestEntries);
  return deepFreeze(output);
}

export function canonicalAttachmentManifestJson(input) {
  return JSON.stringify(canonicalizeAttachmentManifest(input));
}

export function sha256Hex(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw domainError('INVALID_HASH_INPUT', 'SHA-256 input must be a string or byte array.', {});
  }
  return createHash('sha256').update(value).digest('hex');
}

export function hashAttachmentManifest(input) {
  return sha256Hex(canonicalAttachmentManifestJson(input));
}

function normalizePaymentMilestone(input, index) {
  requireRecord(input, 'paymentMilestones[' + index + ']');
  const path = 'paymentMilestones[' + index + ']';
  const id = clean(input.id) || 'payment-' + String(index + 1).padStart(3, '0');
  const label = clean(input.label || input.name || input.title || input.milestone);
  if (!label) {
    throw domainError('PAYMENT_LABEL_REQUIRED', 'Every payment milestone needs a label.', { path });
  }

  const rawPercentage = parseFiniteNumber(input.percentage ?? input.percent, path + '.percentage');
  const rawRatio = parseFiniteNumber(input.ratio, path + '.ratio');
  if (rawPercentage !== null && rawRatio !== null && Math.abs(rawPercentage - rawRatio * 100) > 0.000001) {
    throw domainError(
      'PAYMENT_RATIO_CONFLICT',
      'percentage and ratio describe different allocations.',
      { path, percentage: rawPercentage, ratio: rawRatio },
    );
  }
  const percentage = rawPercentage !== null ? rawPercentage : (rawRatio !== null ? rawRatio * 100 : null);
  if (percentage !== null && (percentage <= 0 || percentage > 100)) {
    throw domainError(
      'PAYMENT_PERCENTAGE_RANGE',
      'Payment percentage must be greater than 0 and no more than 100.',
      { path, percentage },
    );
  }

  const amount = parseFiniteNumber(input.amount, path + '.amount');
  if (amount !== null && amount <= 0) {
    throw domainError('PAYMENT_AMOUNT_RANGE', 'Payment amount must be greater than 0.', { path, amount });
  }
  if (percentage === null && amount === null) {
    throw domainError(
      'PAYMENT_ALLOCATION_REQUIRED',
      'Every payment milestone needs percentage, ratio, or amount.',
      { path },
    );
  }

  const dueAt = input.dueAt ? normalizeIsoTimestamp(input.dueAt, path + '.dueAt') : '';
  const dueDate = clean(input.dueDate);
  const dueTime = clean(input.dueTime);
  if (dueDate && !validCalendarDate(dueDate)) {
    throw domainError(
      'INVALID_PAYMENT_DATE',
      'dueDate must be a real calendar date using YYYY-MM-DD.',
      { path, dueDate },
    );
  }
  if (dueTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
    throw domainError('INVALID_PAYMENT_TIME', 'dueTime must use HH:mm.', { path, dueTime });
  }
  if (dueTime && !dueDate) {
    throw domainError('PAYMENT_DATE_REQUIRED', 'dueTime requires dueDate.', { path, dueTime });
  }
  const trigger = clean(input.trigger || input.condition || input.dueTrigger);
  if (!dueAt && !dueDate && !trigger) {
    throw domainError(
      'PAYMENT_SCHEDULE_REQUIRED',
      'Every payment milestone needs a due time, due date, or trigger condition.',
      { path },
    );
  }

  return Object.freeze({
    id,
    label,
    percentage: percentage === null ? null : fixedNumber(percentage),
    amount: amount === null ? null : fixedNumber(amount, 2),
    dueAt,
    dueDate,
    dueTime,
    timezone: clean(input.timezone) || (dueDate ? 'Asia/Taipei' : ''),
    trigger,
    evidenceRequired: clean(input.evidenceRequired || input.evidence),
  });
}

export function validatePaymentMilestones(input, options = {}) {
  const source = Array.isArray(input) ? input : [];
  const errors = [];
  const milestones = [];
  const ids = new Set();

  for (let index = 0; index < source.length; index += 1) {
    try {
      const milestone = normalizePaymentMilestone(source[index], index);
      if (ids.has(milestone.id)) {
        errors.push(issue(
          'DUPLICATE_PAYMENT_ID',
          'paymentMilestones[' + index + '].id',
          'Payment milestone ids must be unique.',
          { id: milestone.id },
        ));
      } else {
        ids.add(milestone.id);
        milestones.push(milestone);
      }
    } catch (error) {
      if (!(error instanceof ContractDomainError)) throw error;
      errors.push(issue(
        error.code,
        error.details.path || 'paymentMilestones[' + index + ']',
        error.message,
        error.details,
      ));
    }
  }

  let contractAmount = null;
  try {
    contractAmount = parseFiniteNumber(options.contractAmount, 'contractAmount');
    if (contractAmount !== null && contractAmount <= 0) {
      errors.push(issue(
        'CONTRACT_AMOUNT_RANGE',
        'contractAmount',
        'Contract amount must be greater than 0.',
        { contractAmount },
      ));
      contractAmount = null;
    }
  } catch (error) {
    if (!(error instanceof ContractDomainError)) throw error;
    errors.push(issue(error.code, 'contractAmount', error.message, error.details));
  }

  const percentageTolerance = Number.isFinite(Number(options.percentageTolerance))
    ? Math.abs(Number(options.percentageTolerance))
    : 0.01;
  const amountTolerance = Number.isFinite(Number(options.amountTolerance))
    ? Math.abs(Number(options.amountTolerance))
    : 1;
  const withPercentage = milestones.filter((item) => item.percentage !== null);
  const withAmount = milestones.filter((item) => item.amount !== null);
  const percentageTotal = fixedNumber(withPercentage.reduce((sum, item) => sum + item.percentage, 0));
  const amountTotal = fixedNumber(withAmount.reduce((sum, item) => sum + item.amount, 0), 2);

  if (withPercentage.length > 0 && withPercentage.length !== milestones.length) {
    errors.push(issue(
      'PAYMENT_PERCENTAGE_INCOMPLETE',
      'paymentMilestones',
      'When percentages are used, every milestone needs a percentage.',
    ));
  } else if (withPercentage.length > 0 && Math.abs(percentageTotal - 100) > percentageTolerance) {
    errors.push(issue(
      'PAYMENT_PERCENTAGE_TOTAL',
      'paymentMilestones',
      'Payment percentages must total 100.',
      { total: percentageTotal, expected: 100, tolerance: percentageTolerance },
    ));
  }

  if (withAmount.length > 0 && withAmount.length !== milestones.length) {
    errors.push(issue(
      'PAYMENT_AMOUNT_INCOMPLETE',
      'paymentMilestones',
      'When amounts are used, every milestone needs an amount.',
    ));
  } else if (
    contractAmount !== null
    && withAmount.length > 0
    && Math.abs(amountTotal - contractAmount) > amountTolerance
  ) {
    errors.push(issue(
      'PAYMENT_AMOUNT_TOTAL',
      'paymentMilestones',
      'Payment amounts must total the contract amount.',
      { total: amountTotal, expected: contractAmount, tolerance: amountTolerance },
    ));
  }

  if (
    contractAmount !== null
    && withPercentage.length === milestones.length
    && withAmount.length === milestones.length
  ) {
    for (let index = 0; index < milestones.length; index += 1) {
      const milestone = milestones[index];
      const expected = contractAmount * milestone.percentage / 100;
      if (Math.abs(milestone.amount - expected) > amountTolerance) {
        errors.push(issue(
          'PAYMENT_ALLOCATION_MISMATCH',
          'paymentMilestones[' + index + ']',
          'Payment amount does not match its percentage of the contract amount.',
          {
            id: milestone.id,
            amount: milestone.amount,
            percentage: milestone.percentage,
            expectedAmount: fixedNumber(expected, 2),
            tolerance: amountTolerance,
          },
        ));
      }
    }
  }

  return deepFreeze({
    ok: errors.length === 0,
    milestones,
    errors,
    totals: {
      percentage: percentageTotal,
      amount: amountTotal,
      contractAmount: contractAmount === null ? null : fixedNumber(contractAmount, 2),
    },
  });
}

function meaningfulBody(value) {
  if (typeof value === 'string') return Boolean(clean(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(
    clean(value.content || value.html || value.markdown || value.text)
    || clean(value.fileId || value.driveFileId || value.url || value.sha256),
  );
}

function withCategory(value, category) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...value, category };
}

function collectPackageAttachments(packageInput) {
  const attachments = Array.isArray(packageInput.attachments) ? [...packageInput.attachments] : [];
  const body = packageInput.contractBody;
  if (
    body
    && typeof body === 'object'
    && !Array.isArray(body)
    && !clean(body.content || body.html || body.markdown || body.text)
  ) {
    attachments.push(withCategory(body, 'contract_body'));
  }

  const drawings = Array.isArray(packageInput.constructionDrawings)
    ? packageInput.constructionDrawings
    : (packageInput.constructionDrawings ? [packageInput.constructionDrawings] : []);
  for (const drawing of drawings) attachments.push(withCategory(drawing, 'construction_drawing'));

  const quoteValue = packageInput.quotation ?? packageInput.quote ?? packageInput.quotations;
  const quotations = Array.isArray(quoteValue) ? quoteValue : (quoteValue ? [quoteValue] : []);
  for (const quotation of quotations) attachments.push(withCategory(quotation, 'quotation'));
  return attachments;
}

function normalizeAcceptanceCriteria(input) {
  const source = Array.isArray(input) ? input : [];
  const criteria = [];
  const errors = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    const criterion = typeof value === 'string'
      ? clean(value)
      : clean(value?.criterion || value?.standard || value?.description || value?.name);
    if (!criterion) {
      errors.push(issue(
        'ACCEPTANCE_CRITERION_REQUIRED',
        'acceptanceCriteria[' + index + ']',
        'Every acceptance criterion needs measurable text.',
      ));
      continue;
    }
    criteria.push(Object.freeze({
      id: clean(value?.id) || 'acceptance-' + String(index + 1).padStart(3, '0'),
      criterion,
      reference: clean(value?.reference || value?.drawingReference),
      verificationMethod: clean(value?.verificationMethod || value?.method),
      passCondition: clean(value?.passCondition || value?.condition),
      evidenceRequired: clean(value?.evidenceRequired || value?.evidence),
      verifier: clean(value?.verifier),
    }));
  }
  return { criteria, errors };
}

export function validateContractPackage(packageInput, options = {}) {
  const source = packageInput && typeof packageInput === 'object' && !Array.isArray(packageInput)
    ? packageInput
    : {};
  const missing = [];
  const errors = [];
  let manifest = deepFreeze([]);
  let manifestHash = '';

  try {
    manifest = canonicalizeAttachmentManifest(collectPackageAttachments(source));
    manifestHash = hashAttachmentManifest(manifest);
  } catch (error) {
    if (!(error instanceof ContractDomainError)) throw error;
    errors.push(issue(error.code, 'attachments', error.message, error.details));
  }

  const hasContractBody = meaningfulBody(source.contractBody)
    || manifest.some((item) => item.category === 'contract_body');
  const hasDrawings = manifest.some((item) => item.category === 'construction_drawing');
  const hasQuotation = manifest.some((item) => item.category === 'quotation');
  if (!hasContractBody) missing.push('contractBody');
  if (!hasDrawings) missing.push('constructionDrawings');
  if (!hasQuotation) missing.push('quotation');

  const paymentSource = Array.isArray(source.paymentMilestones) ? source.paymentMilestones : [];
  if (paymentSource.length === 0) missing.push('paymentMilestones');
  const payment = validatePaymentMilestones(paymentSource, options);
  errors.push(...payment.errors);

  const acceptanceSource = Array.isArray(source.acceptanceCriteria)
    ? source.acceptanceCriteria
    : (Array.isArray(source.acceptanceStandards) ? source.acceptanceStandards : []);
  if (acceptanceSource.length === 0) missing.push('acceptanceCriteria');
  const acceptance = normalizeAcceptanceCriteria(acceptanceSource);
  errors.push(...acceptance.errors);

  return deepFreeze({
    ok: missing.length === 0 && errors.length === 0,
    missing,
    errors,
    manifest,
    manifestHash,
    payment,
    acceptanceCriteria: acceptance.criteria,
  });
}

export function assertContractPackageComplete(packageInput, options = {}) {
  const result = validateContractPackage(packageInput, options);
  if (!result.ok) {
    throw domainError(
      'CONTRACT_PACKAGE_INCOMPLETE',
      'Contract package is incomplete or invalid.',
      { missing: result.missing, errors: result.errors },
      422,
    );
  }
  return result;
}

// Engineering contract acceptance management.
//
// This module is intentionally storage- and transport-agnostic. It projects
// acceptance work exclusively from a frozen contract version, and all
// operational changes are append-only audit events supplied to an injected
// repository. It never sends a notification, creates a payment, or calls an
// external service.

import { createHash, randomUUID } from 'node:crypto';
import {
  ContractDomainError,
  assertProjectScope,
  isVersionFrozen,
  requireServerActor,
} from './contract-domain.js';

export const ENGINEERING_CONTRACT_ACCEPTANCE_VERSION = '2026-09-03.acceptance.v1';

export const ACCEPTANCE_EVENT_TYPES = Object.freeze([
  'acceptance_submitted',
  'acceptance_reviewed',
  'acceptance_reopened',
]);

export const ACCEPTANCE_STORE_INTERFACE = Object.freeze({
  getAcceptanceContext: {
    signature: 'async (tenant, { contractId, versionId }) => { contract, version, events }|null',
    guarantees: ['tenant isolation', 'events are ordered append-only records for one frozen version'],
  },
  appendAcceptanceEvent: {
    signature: 'async (tenant, event) => event',
    guarantees: [
      'tenant isolation',
      'atomic expectedSequenceNo and expectedPreviousEventHash compare-and-set',
      'insert only; never updates or deletes an existing event',
    ],
  },
});

const SUBMITTER_ROLES = new Set(['engineering_admin', 'engineering_acceptance_submitter', 'engineering_manager']);
const REVIEWER_ROLES = new Set(['engineering_admin', 'engineering_acceptance_reviewer', 'engineering_manager']);
const APPROVER_ROLES = new Set(['engineering_admin', 'engineering_acceptance_approver', 'engineering_manager']);
const ITEM_STATUSES = new Set(['pending', 'submitted', 'accepted', 'rework_required', 'rejected']);
const REVIEW_DECISIONS = new Set(['accepted', 'rework_required', 'rejected']);
const HEX_64 = /^[a-f0-9]{64}$/;

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = clone(child);
    return result;
  }
  return value;
}

function text(value, maximum = 1000) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, maximum);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? '';
}

function error(code, message, statusCode = 400, details = {}) {
  return new ContractDomainError(code, message, details, statusCode);
}

function iso(value, field = 'timestamp') {
  const source = text(value, 80);
  if (!source || !Number.isFinite(Date.parse(source))) {
    throw error('ACCEPTANCE_TIMESTAMP_INVALID', field + ' must be a valid timestamp.', 422, { field });
  }
  return new Date(source).toISOString();
}

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map((item) => canonical(item)).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRoles(context) {
  const source = first(context?.actorRoles, context?.access?.roles, context?.access?.actorRoles, []);
  const values = source instanceof Set ? [...source] : (Array.isArray(source) ? source : [source]);
  return new Set(values.map((value) => text(value, 100).toLowerCase()).filter(Boolean));
}

function requireRole(context, allowed, action) {
  const roles = normalizeRoles(context);
  if (![...roles].some((role) => allowed.has(role))) {
    throw error(
      'ACCEPTANCE_ROLE_DENIED',
      'This actor is not allowed to ' + action + ' an engineering acceptance item.',
      403,
      { action, requiredRoles: [...allowed].sort() },
    );
  }
}

function serverContext(context) {
  if (!context || typeof context !== 'object') throw error('ACCEPTANCE_SERVER_CONTEXT_REQUIRED', 'Authoritative server context is required.', 403);
  const actor = requireServerActor(context);
  if (!context.tenant || !text(context.tenant.key, 160)) {
    throw error('ACCEPTANCE_TENANT_REQUIRED', 'Authoritative tenant context is required.', 403);
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'scope') || context.scope === undefined) {
    throw error('ACCEPTANCE_SCOPE_REQUIRED', 'Authorized project scope is required.', 403);
  }
  return { actor, tenant: context.tenant, scope: context.scope, roles: normalizeRoles(context) };
}

function rejectAuthorityOverride(input) {
  for (const field of ['actor', 'actorId', 'tenant', 'scope', 'projectId', 'project_id', 'version', 'contract', 'eventHash', 'previousEventHash', 'sequenceNo', 'occurredAt']) {
    if (Object.prototype.hasOwnProperty.call(object(input), field)) {
      throw error('ACCEPTANCE_AUTHORITY_OVERRIDE_FORBIDDEN', 'Acceptance authority and audit fields are server-derived.', 403, { field });
    }
  }
}

function packageFor(version) {
  const source = object(version);
  const snapshot = object(first(source.contractSnapshot, source.contract_snapshot, source.snapshot));
  return object(first(snapshot.documentPackage, source.documentPackage, source.contractPackage, source.package));
}

function normalizeEvidenceRequirement(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 300)).filter(Boolean);
  const normalized = text(value, 600);
  return normalized ? [normalized] : [];
}

function criteriaFor(version) {
  const criteria = list(packageFor(version).acceptanceCriteria);
  const ids = new Set();
  return criteria.map((criterion, index) => {
    const source = object(criterion);
    const id = text(first(source.id, 'acceptance-' + String(index + 1).padStart(3, '0')), 160);
    if (!id || ids.has(id)) throw error('ACCEPTANCE_CRITERIA_INVALID', 'Frozen contract version contains duplicate or empty acceptance item ids.', 500, { id, index });
    ids.add(id);
    const title = text(first(source.criterion, source.label, source.name), 500);
    if (!title) throw error('ACCEPTANCE_CRITERIA_INVALID', 'Frozen contract version contains an acceptance item without a criterion.', 500, { id });
    return freezeTree({
      id,
      sequenceNo: index + 1,
      criterion: title,
      reference: text(source.reference, 600),
      verificationMethod: text(source.verificationMethod, 600),
      passCondition: text(source.passCondition, 1000),
      evidenceRequirements: normalizeEvidenceRequirement(source.evidenceRequired),
      verifier: text(source.verifier, 240),
    });
  });
}

/**
 * Creates the immutable acceptance checklist for a frozen contract version.
 * The result contains no mutable live contract data and can be persisted as a
 * snapshot alongside the first acceptance event.
 */
export function deriveAcceptanceItems(version) {
  if (!isVersionFrozen(version) || text(version?.status, 80).toLowerCase() === 'voided') {
    throw error('ACCEPTANCE_VERSION_NOT_FROZEN', 'Acceptance items can only be derived from a frozen contract version.', 409, {
      versionId: text(version?.id, 160),
      status: text(version?.status, 80),
    });
  }
  const items = criteriaFor(version);
  if (!items.length) throw error('ACCEPTANCE_CRITERIA_MISSING', 'Frozen contract version has no acceptance criteria.', 409);
  return freezeTree({
    schemaVersion: ENGINEERING_CONTRACT_ACCEPTANCE_VERSION,
    versionId: text(first(version?.id, version?.versionId, version?.version_id), 160),
    versionFrozenAt: text(first(version?.frozenAt, version?.frozen_at), 80),
    items,
    sourceHash: digest(canonical(items)),
  });
}

function normalizeEvidence(raw) {
  const seen = new Set();
  return list(raw).map((candidate) => {
    const source = object(candidate);
    const reference = text(first(source.reference, source.ref, source.driveFileId, source.drive_file_id, source.url), 500);
    const sha256 = text(first(source.sha256, source.hash), 80).toLowerCase();
    if (!reference || !HEX_64.test(sha256)) {
      throw error('ACCEPTANCE_EVIDENCE_INVALID', 'Each acceptance evidence item requires an immutable reference and SHA-256.', 422);
    }
    const key = reference + ':' + sha256;
    if (seen.has(key)) throw error('ACCEPTANCE_EVIDENCE_DUPLICATE', 'Duplicate acceptance evidence is not allowed.', 422, { reference });
    seen.add(key);
    return freezeTree({
      reference,
      sha256,
      label: text(first(source.label, source.name, source.caption), 300),
      kind: text(first(source.kind, source.documentKind, source.document_kind), 100),
    });
  });
}

function requiredEvidenceCount(item) {
  return item.evidenceRequirements.length ? 1 : 0;
}

function normalizeEvent(raw) {
  const source = object(raw);
  const type = text(first(source.type, source.eventType, source.event_type), 80);
  const sequenceNo = Number(first(source.sequenceNo, source.sequence_no));
  const previousEventHash = text(first(source.previousEventHash, source.previous_event_hash), 80).toLowerCase();
  const eventHash = text(first(source.eventHash, source.event_hash), 80).toLowerCase();
  const itemId = text(first(source.itemId, source.item_id), 160);
  const occurredAt = text(first(source.occurredAt, source.occurred_at, source.at), 80);
  if (!ACCEPTANCE_EVENT_TYPES.includes(type) || !Number.isInteger(sequenceNo) || sequenceNo < 1
    || !itemId || !HEX_64.test(eventHash) || (previousEventHash && !HEX_64.test(previousEventHash))) {
    throw error('ACCEPTANCE_EVENT_INVALID', 'Acceptance event has an invalid immutable audit shape.', 500, { type, sequenceNo, itemId });
  }
  const payload = object(source.payload);
  if (type === 'acceptance_submitted' && !Array.isArray(payload.evidence)) {
    throw error('ACCEPTANCE_EVENT_PAYLOAD_INVALID', 'Acceptance submission event lacks its evidence list.', 500, { sequenceNo });
  }
  if (type === 'acceptance_reviewed' && !REVIEW_DECISIONS.has(text(payload.decision, 80).toLowerCase())) {
    throw error('ACCEPTANCE_EVENT_PAYLOAD_INVALID', 'Acceptance review event has an invalid decision.', 500, { sequenceNo });
  }
  if (type === 'acceptance_reopened' && !text(payload.note, 1000)) {
    throw error('ACCEPTANCE_EVENT_PAYLOAD_INVALID', 'Acceptance reopen event lacks an immutable reason.', 500, { sequenceNo });
  }
  const canonicalForHash = {
    id: text(source.id, 160), type, contractId: text(first(source.contractId, source.contract_id), 160),
    versionId: text(first(source.versionId, source.version_id), 160), itemId, sequenceNo, previousEventHash,
    occurredAt: iso(occurredAt), actor: text(source.actor, 240), payload,
  };
  if (digest(canonical(canonicalForHash)) !== eventHash) {
    throw error('ACCEPTANCE_EVENT_HASH_INVALID', 'Acceptance event hash verification failed.', 409, { sequenceNo });
  }
  return freezeTree({ ...canonicalForHash, eventHash });
}

function nextEvent(context, currentEvents, type, itemId, payload, clock, idFactory) {
  const normalized = currentEvents.map(normalizeEvent).sort((left, right) => left.sequenceNo - right.sequenceNo);
  for (let index = 0; index < normalized.length; index += 1) {
    const event = normalized[index];
    const expectedSequence = index + 1;
    const expectedPrevious = index ? normalized[index - 1].eventHash : '';
    if (event.sequenceNo !== expectedSequence || event.previousEventHash !== expectedPrevious) {
      throw error('ACCEPTANCE_EVENT_CHAIN_BROKEN', 'Acceptance event chain is not contiguous.', 409, { sequenceNo: event.sequenceNo });
    }
  }
  const previousEventHash = normalized.at(-1)?.eventHash || '';
  const draft = {
    id: idFactory(), type, contractId: context.contractId, versionId: context.versionId, itemId,
    sequenceNo: normalized.length + 1, previousEventHash, occurredAt: iso(clock()), actor: context.actor, payload: clone(payload),
  };
  return freezeTree({ ...draft, eventHash: digest(canonical(draft)) });
}

function projectItem(item, events) {
  let status = 'pending';
  let latestSubmission = null;
  let latestDecision = null;
  for (const event of events.filter((entry) => entry.itemId === item.id)) {
    if (event.type === 'acceptance_submitted') {
      status = 'submitted';
      latestSubmission = event;
    } else if (event.type === 'acceptance_reviewed') {
      status = event.payload.decision;
      latestDecision = event;
    } else if (event.type === 'acceptance_reopened') {
      status = 'rework_required';
      latestDecision = event;
    }
  }
  return freezeTree({
    ...item,
    status: ITEM_STATUSES.has(status) ? status : 'pending',
    submittedAt: latestSubmission?.occurredAt || '',
    reviewedAt: latestDecision?.occurredAt || '',
    evidence: latestSubmission?.payload?.evidence || [],
    latestDecision: latestDecision ? {
      decision: latestDecision.payload.decision || 'reopened',
      note: text(latestDecision.payload.note, 1000),
      occurredAt: latestDecision.occurredAt,
    } : null,
  });
}

/**
 * A read-only projection. Events are hash-checked before being applied, so a
 * corrupted or non-append-only record can never appear as a completed acceptance.
 */
export function reduceAcceptanceWorkflow({ contract = {}, version = {}, events = [] } = {}) {
  const plan = deriveAcceptanceItems(version);
  const normalized = list(events).map(normalizeEvent).sort((left, right) => left.sequenceNo - right.sequenceNo);
  const expectedContractId = text(first(contract.id, contract.contractId, contract.contract_id), 160);
  for (const event of normalized) {
    if (event.contractId !== expectedContractId || event.versionId !== plan.versionId || !plan.items.some((item) => item.id === event.itemId)) {
      throw error('ACCEPTANCE_EVENT_RELATION_MISMATCH', 'Acceptance event is outside this contract/version/item boundary.', 409);
    }
  }
  const items = plan.items.map((item) => projectItem(item, normalized));
  const accepted = items.filter((item) => item.status === 'accepted').length;
  const needsAttention = items.some((item) => ['pending', 'submitted', 'rework_required', 'rejected'].includes(item.status));
  return freezeTree({
    schemaVersion: ENGINEERING_CONTRACT_ACCEPTANCE_VERSION,
    contractId: expectedContractId,
    versionId: plan.versionId,
    sourceHash: plan.sourceHash,
    items,
    totals: { total: items.length, accepted, outstanding: items.length - accepted },
    status: accepted === items.length ? 'accepted' : (items.some((item) => item.status === 'submitted') ? 'awaiting_review' : 'in_progress'),
    requiresAttention: needsAttention,
    eventChainHead: normalized.at(-1)?.eventHash || '',
  });
}

function validateRepository(repository) {
  for (const method of ['getAcceptanceContext', 'appendAcceptanceEvent']) {
    if (typeof repository?.[method] !== 'function') {
      throw error('ACCEPTANCE_STORE_INVALID', 'Acceptance repository is missing ' + method + '.', 500);
    }
  }
}

function publicWorkflow(workflow) {
  return freezeTree(clone(workflow));
}

/**
 * Server-side command service. The adapter must enforce an atomic append
 * compare-and-set using the supplied sequence/hash; therefore a concurrent
 * command cannot silently fork the acceptance audit chain.
 */
export function createContractAcceptanceService({ repository, clock = () => new Date(), idFactory = randomUUID } = {}) {
  validateRepository(repository);

  async function load(authority, input) {
    const contractId = text(input?.contractId, 160);
    const versionId = text(input?.versionId, 160);
    if (!contractId || !versionId) throw error('ACCEPTANCE_IDENTIFIER_REQUIRED', 'Contract and version identifiers are required.', 422);
    const context = await repository.getAcceptanceContext(authority.tenant, { contractId, versionId });
    if (!context) throw error('ACCEPTANCE_CONTEXT_NOT_FOUND', 'Engineering contract acceptance context was not found.', 404);
    const contract = object(context.contract);
    if (text(first(contract.id, contract.contractId, contract.contract_id), 160) !== contractId) {
      throw error('ACCEPTANCE_CONTRACT_RELATION_MISMATCH', 'Acceptance context contract does not match requested contract.', 409);
    }
    assertProjectScope(authority.scope, {
      id: first(contract.projectId, contract.project_id, contract.projectNotionPageId, contract.project_notion_page_id),
      code: first(contract.projectCode, contract.project_code),
    });
    const version = object(context.version);
    if (text(first(version.id, version.versionId, version.version_id), 160) !== versionId) {
      throw error('ACCEPTANCE_VERSION_RELATION_MISMATCH', 'Acceptance context version does not match requested version.', 409);
    }
    const events = list(context.events);
    const workflow = reduceAcceptanceWorkflow({ contract, version, events });
    return { contract, version, events, workflow, contractId, versionId };
  }

  async function append(authority, loaded, type, itemId, payload) {
    if (['superseded', 'voided'].includes(text(loaded.version.status, 80).toLowerCase())) {
      throw error('ACCEPTANCE_VERSION_INACTIVE', 'A superseded or voided contract version is read-only for acceptance operations.', 409);
    }
    const item = loaded.workflow.items.find((candidate) => candidate.id === itemId);
    if (!item) throw error('ACCEPTANCE_ITEM_NOT_FOUND', 'Acceptance item was not found in the frozen version.', 404, { itemId });
    const event = nextEvent(
      { actor: authority.actor, contractId: loaded.contractId, versionId: loaded.versionId },
      loaded.events, type, itemId, payload, clock, idFactory,
    );
    const saved = await repository.appendAcceptanceEvent(authority.tenant, {
      ...event,
      expectedSequenceNo: event.sequenceNo,
      expectedPreviousEventHash: event.previousEventHash,
    });
    return { event: normalizeEvent(saved || event), item };
  }

  return Object.freeze({
    async get(context, identifiers) {
      const authority = serverContext(context);
      const loaded = await load(authority, identifiers);
      return publicWorkflow(loaded.workflow);
    },
    async submit(context, input = {}) {
      rejectAuthorityOverride(input);
      const authority = serverContext(context);
      requireRole(context, SUBMITTER_ROLES, 'submit');
      const loaded = await load(authority, input);
      const itemId = text(input.itemId, 160);
      const item = loaded.workflow.items.find((candidate) => candidate.id === itemId);
      if (!item) throw error('ACCEPTANCE_ITEM_NOT_FOUND', 'Acceptance item was not found in the frozen version.', 404);
      if (!['pending', 'rework_required', 'rejected'].includes(item.status)) {
        throw error('ACCEPTANCE_SUBMISSION_NOT_ALLOWED', 'Acceptance item is not eligible for a new submission.', 409, { status: item.status });
      }
      const evidence = normalizeEvidence(input.evidence);
      if (evidence.length < requiredEvidenceCount(item)) {
        throw error('ACCEPTANCE_EVIDENCE_REQUIRED', 'This acceptance item requires linked immutable evidence before submission.', 422, { itemId });
      }
      const result = await append(authority, loaded, 'acceptance_submitted', itemId, {
        evidence, note: text(input.note, 1000), sourceHash: loaded.workflow.sourceHash,
      });
      return freezeTree({ ok: true, event: result.event, workflow: publicWorkflow(reduceAcceptanceWorkflow({
        contract: loaded.contract, version: loaded.version, events: [...loaded.events, result.event],
      })) });
    },
    async review(context, input = {}) {
      rejectAuthorityOverride(input);
      const authority = serverContext(context);
      requireRole(context, REVIEWER_ROLES, 'review');
      const loaded = await load(authority, input);
      const itemId = text(input.itemId, 160);
      const item = loaded.workflow.items.find((candidate) => candidate.id === itemId);
      if (!item) throw error('ACCEPTANCE_ITEM_NOT_FOUND', 'Acceptance item was not found in the frozen version.', 404);
      if (item.status !== 'submitted') {
        throw error('ACCEPTANCE_REVIEW_NOT_ALLOWED', 'Only a submitted acceptance item can be reviewed.', 409, { status: item.status });
      }
      const decision = text(input.decision, 80).toLowerCase();
      if (!REVIEW_DECISIONS.has(decision)) throw error('ACCEPTANCE_DECISION_INVALID', 'Acceptance review decision is invalid.', 422);
      if (decision !== 'accepted' && !text(input.note, 1000)) {
        throw error('ACCEPTANCE_REVIEW_NOTE_REQUIRED', 'A non-acceptance review requires a recorded reason.', 422);
      }
      const result = await append(authority, loaded, 'acceptance_reviewed', itemId, {
        decision, note: text(input.note, 1000), evidenceCount: item.evidence.length, sourceHash: loaded.workflow.sourceHash,
      });
      return freezeTree({ ok: true, event: result.event, workflow: publicWorkflow(reduceAcceptanceWorkflow({
        contract: loaded.contract, version: loaded.version, events: [...loaded.events, result.event],
      })) });
    },
    async reopen(context, input = {}) {
      rejectAuthorityOverride(input);
      const authority = serverContext(context);
      requireRole(context, APPROVER_ROLES, 'reopen');
      const loaded = await load(authority, input);
      const itemId = text(input.itemId, 160);
      const item = loaded.workflow.items.find((candidate) => candidate.id === itemId);
      if (!item) throw error('ACCEPTANCE_ITEM_NOT_FOUND', 'Acceptance item was not found in the frozen version.', 404);
      if (item.status !== 'accepted') {
        throw error('ACCEPTANCE_REOPEN_NOT_ALLOWED', 'Only an accepted item can be reopened.', 409, { status: item.status });
      }
      const note = text(input.note, 1000);
      if (!note) throw error('ACCEPTANCE_REOPEN_REASON_REQUIRED', 'Reopening an accepted item requires an immutable reason.', 422);
      const result = await append(authority, loaded, 'acceptance_reopened', itemId, {
        note, previousDecision: 'accepted', sourceHash: loaded.workflow.sourceHash,
      });
      return freezeTree({ ok: true, event: result.event, workflow: publicWorkflow(reduceAcceptanceWorkflow({
        contract: loaded.contract, version: loaded.version, events: [...loaded.events, result.event],
      })) });
    },
  });
}

export const __test = Object.freeze({
  canonical,
  digest,
  normalizeEvidence,
  normalizeEvent,
  nextEvent,
});

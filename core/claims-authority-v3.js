import crypto from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,239}$/u;
const OPAQUE_REFERENCE = /^line-ref:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function requireSafe(value, label, expression = SAFE_ID) {
  if (!expression.test(String(value || ''))) throw new Error(`Finance V3 ${label} is invalid.`);
  return String(value);
}

export function createClaimsAuthorityV3Adapter({ groupEntry, verifySource, resolveApplicantReference, syncMembership } = {}) {
  if (typeof groupEntry?.enqueue !== 'function'
    || typeof verifySource !== 'function'
    || typeof resolveApplicantReference !== 'function'
    || typeof syncMembership !== 'function') {
    throw new Error('Claims authority Finance V3 adapter dependencies are incomplete.');
  }

  const financeProvisioner = {
    async provision({ tenantKey, bindingId, financeScope, idempotencyKey }) {
      const sourceId = requireSafe(financeScope?.sourceId, 'source id');
      const formKey = requireSafe(financeScope?.formKey, 'form key');
      const groupReference = requireSafe(financeScope?.groupReference, 'group reference', OPAQUE_REFERENCE);
      const verified = await verifySource({ tenantKey, bindingId, sourceId, formKey, groupReference, idempotencyKey });
      if (!verified?.ok || verified.sourceId !== sourceId) return { ok: false };
      return { ok: true, sourceId, formKey, groupReference };
    },
  };

  async function openV3Claim({ tenant, binding, event, userId, idempotencyKey }) {
    const tenantKey = requireSafe(tenant?.key, 'tenant key');
    const sourceId = requireSafe(binding?.financeSourceId || binding?.sourceId, 'source id');
    const formKey = requireSafe(binding?.claimFormKey || binding?.formKey, 'form key');
    const groupReference = requireSafe(binding?.groupReference || binding?.identityReference, 'group reference', OPAQUE_REFERENCE);
    const applicantReference = requireSafe(
      await resolveApplicantReference({ tenant, userId, event }),
      'applicant reference',
      OPAQUE_REFERENCE,
    );
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(['authority-v1', idempotencyKey, tenantKey, sourceId, formKey, applicantReference]))
      .digest('hex');
    const requestId = `membership-${digest.slice(0, 40)}`;
    const membership = await syncMembership({
      contractVersion: 'finance-claims-v3.am-bridge-v1',
      requestId,
      tenantKey,
      sourceId,
      identityReference: applicantReference,
      desiredState: 'active',
      eventSequence: Math.max(1, Number(event?.timestamp) || Date.now()),
      effectiveAt: new Date(Number(event?.timestamp) || Date.now()).toISOString(),
    });
    if (!membership?.matched || membership.effectiveState !== 'active' || membership.evidenceRecorded !== true) {
      throw new Error('Finance V3 membership could not be activated.');
    }
    const record = {
      eventKey: `group-entry:${digest}`,
      jobKind: 'entry',
      tenantKey,
      sourceId,
      formKey,
      groupReference,
      applicantReference,
      desiredState: 'active',
      keyword: '請款',
      occurredAt: new Date(Number(event?.timestamp) || Date.now()).toISOString(),
      membershipRequestId: requestId,
      entryRequestId: `entry-${digest.slice(0, 40)}`,
      deliveryEventKey: `entry-invite-${digest.slice(0, 40)}`,
    };
    const rows = await groupEntry.enqueue([record]);
    return { queued: true, eventKey: record.eventKey, replayed: rows[0]?.inserted === false };
  }

  return { financeProvisioner, openV3Claim };
}

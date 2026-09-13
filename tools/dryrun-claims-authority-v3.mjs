import assert from 'node:assert/strict';
import { createClaimsAuthorityV3Adapter } from '../core/claims-authority-v3.js';

const groupReference = 'line-ref:v1:00000000-0000-4000-8000-000000000010';
const applicantReference = 'line-ref:v1:00000000-0000-4000-8000-000000000011';
const queued = [];
const membershipCalls = [];
const adapter = createClaimsAuthorityV3Adapter({
  groupEntry: { enqueue: async (records) => { queued.push(...records); return [{ inserted: true }]; } },
  verifySource: async (input) => ({ ok: true, sourceId: input.sourceId }),
  resolveApplicantReference: async () => applicantReference,
  syncMembership: async (input) => {
    membershipCalls.push(input);
    return { matched: true, effectiveState: 'active', evidenceRecorded: true };
  },
});

const provisioned = await adapter.financeProvisioner.provision({
  tenantKey: 'hozo-test',
  bindingId: 'binding-test',
  financeScope: { sourceId: 'source-test', formKey: 'employee_expense', groupReference },
  idempotencyKey: 'activation-test',
});
assert.equal(provisioned.ok, true);
const result = await adapter.openV3Claim({
  tenant: { key: 'hozo-test' },
  binding: { sourceId: 'source-test', formKey: 'employee_expense', groupReference },
  event: { timestamp: 1789197000000 },
  userId: 'synthetic-user-never-persisted',
  idempotencyKey: 'a'.repeat(64),
});
assert.equal(result.queued, true);
assert.equal(membershipCalls.length, 1);
assert.equal(membershipCalls[0].identityReference, applicantReference);
assert.equal(queued.length, 1);
assert.equal(queued[0].applicantReference, applicantReference);
assert.equal(queued[0].sourceId, 'source-test');
assert.match(queued[0].entryRequestId, /^entry-[a-f0-9]{40}$/u);
assert.equal(JSON.stringify(queued).includes('synthetic-user-never-persisted'), false);

console.log('claims authority Finance V3 adapter dry-run passed');

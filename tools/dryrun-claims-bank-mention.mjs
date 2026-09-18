import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClaimsAuthority } from '../core/claims-authority.js';

const identityKey = 'synthetic-bank-mention-identity-key-not-production';
const key = crypto.createHash('sha256').update(`encryption:${identityKey}`).digest();
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['fixed-v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
const tenant = { tenantId: '00000000-0000-4000-8000-000000000001', key: 'synthetic-finance' };
const groupId = `C${'1'.repeat(32)}`;
const userId = `U${'2'.repeat(32)}`;
const member = {
  group_ciphertext: encrypt(groupId), group_key_id: 'fixed-v1',
  group_state: 'active', oa_state: 'present', member_ciphertext: encrypt(userId),
  member_name_ciphertext: encrypt('測試覆核員'), key_id: 'fixed-v1',
  state: 'observed', manual_deny: false, tenant_key: tenant.key,
  identity_reference: 'line-ref:v1:11111111-1111-4111-8111-111111111111',
};
let rows = [member];
let queryCount = 0;
let configuredReference = '';
const authority = createClaimsAuthority({ identityKey,
  verifiedRecipientReferenceFactory: async (input) => {
    assert.equal(input.tenant.key, tenant.key);
    return input.userId === userId ? configuredReference : '';
  }, store: {
  async transaction(scope, work) {
    assert.equal(scope.tenantId, tenant.tenantId);
    return work({ async query(sql, params) {
      queryCount += 1;
      assert.match(sql, /ca:resolve-group-mention.*SELECT/su);
      assert.match(sql, /WHERE g.tenant_id=\$1 AND g.group_lookup=\$2/u);
      assert.equal(params[0], tenant.tenantId);
      assert.equal(params[1], authority.opaqueIdentity(tenant, 'group', groupId));
      assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/iu);
      return { rows };
    } });
  },
} });
const resolve = (mentionName = '測試覆核員') => authority.resolveGroupMention({ tenant, groupId, mentionName });
assert.deepEqual(await resolve(' 測試覆核員 '), { name: '測試覆核員', userId });
for (const override of [
  { group_state: 'paused' }, { group_state: 'needs_attention' }, { oa_state: 'left' },
  { state: 'left' }, { manual_deny: true }, { manual_deny: null },
  { tenant_key: 'another-tenant' }, { identity_reference: null },
  { group_key_id: 'other-key' }, { key_id: 'other-key' },
  { group_ciphertext: encrypt(`C${'3'.repeat(32)}`) },
  { member_ciphertext: encrypt('invalid-line-user') },
]) {
  rows = [{ ...member, ...override }];
  assert.equal(await resolve(), null);
}
rows = [{ ...member }, { ...member, state: 'left', manual_deny: true }];
assert.equal(await resolve(), null, 'Ambiguity must not be resolved by filtering denied identities.');
rows = [{ ...member, member_name_ciphertext: encrypt('不同姓名') }];
assert.equal(await resolve(), null, 'No nickname/full-name guessing.');
rows = [];
assert.equal(await resolve(), null);
assert.deepEqual(await authority.resolveGroupMention({ tenant, groupId, mentionName: '測試覆核員', diagnose: true }), { resolved: false, reason: 'group_or_members_missing' });
for (const [override, reason] of [
  [{ member_name_ciphertext: encrypt('其他人') }, 'member_name_not_found'],
  [{ group_state: 'paused' }, 'group_not_active'],
  [{ oa_state: 'left' }, 'oa_not_present'],
  [{ state: 'left' }, 'member_not_present'],
  [{ manual_deny: true }, 'member_denied'],
  [{ tenant_key: null }, 'member_tenant_mismatch'],
  [{ identity_reference: null }, 'member_reference_missing'],
]) {
  rows = [{ ...member, ...override }];
  const result = await authority.resolveGroupMention({ tenant, groupId, mentionName: '測試覆核員', diagnose: true });
  assert.deepEqual(result, { resolved: false, reason });
  assert.ok(!JSON.stringify(result).includes(userId));
}
rows = [{ ...member, member_name_ciphertext: 'invalid-ciphertext' }];
await assert.rejects(resolve(), /ciphertext/u);
const before = queryCount;
assert.equal(await authority.resolveGroupMention({ tenant, groupId: 'bad', mentionName: '測試覆核員' }), null);
assert.equal(await resolve(''), null);
assert.equal(queryCount, before);
const referenceInput = { tenant, groupId, mentionName: '顯示姓名', mentionIdentityReference: member.identity_reference, diagnose: true };
rows = [{ ...member, member_name_ciphertext: encrypt('不同 LINE 暱稱') }];
assert.deepEqual(await authority.resolveGroupMention(referenceInput), { name: '顯示姓名', userId });
rows = [{ ...member, member_name_ciphertext: null, tenant_key: null, identity_reference: null }];
assert.deepEqual(await authority.resolveGroupMention(referenceInput), { resolved: false, reason: 'member_reference_not_found' });
configuredReference = member.identity_reference;
assert.deepEqual(await authority.resolveGroupMention(referenceInput), { name: '顯示姓名', userId });
for (const [override, reason] of [
  [{ tenant_key: 'another-tenant' }, 'member_tenant_mismatch'],
  [{ identity_reference: 'line-ref:v1:22222222-2222-4222-8222-222222222222' }, 'member_reference_conflict'],
  [{ state: 'left' }, 'member_not_present'],
  [{ manual_deny: true }, 'member_denied'],
  [{ oa_state: 'left' }, 'oa_not_present'],
  [{ group_state: 'paused' }, 'group_not_active'],
]) {
  rows = [{ ...member, tenant_key: null, identity_reference: null, ...override }];
  assert.deepEqual(await authority.resolveGroupMention(referenceInput), { resolved: false, reason });
}
rows = [{ ...member }, { ...member, state: 'left' }];
assert.deepEqual(await authority.resolveGroupMention(referenceInput), { resolved: false, reason: 'member_reference_ambiguous' });
rows = [{ ...member }];
assert.deepEqual(await authority.resolveGroupMention({ ...referenceInput, mentionIdentityReference: 'bad' }), { resolved: false, reason: 'invalid_lookup_input' });
console.log('Bank mention registry checks passed: encrypted exact-group membership, tenant scope, denial/state/identity/ambiguity guards, SELECT-only resolution.');

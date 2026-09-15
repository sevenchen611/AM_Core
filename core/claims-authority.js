import crypto from 'node:crypto';

const COMMAND = /^(?:#?請款|我要請款|開啟請款|請款按鈕)$/u;
const MANAGE = new Set(['platform_owner', 'claims_access_admin']);
const READ = new Set([...MANAGE, 'operator', 'auditor']);
const PLATFORM_ONLY = new Set(['platform_owner']);
const ENTITIES = new Set(['group', 'member', 'binding']);
const PLATFORM_SCOPE = Object.freeze({
  tenantId: '00000000-0000-4000-8000-000000000000',
  key: 'platform',
});
const FIXED_KEY_ID = 'fixed-v1';
const CLAIM_FORM_KEYS = Object.freeze(['legacy_social_insurance', 'legacy_shared_operating', 'legacy_other', 'employee_expense']);
const CLAIM_FORM_KEY_SET = new Set(CLAIM_FORM_KEYS);

export const isClaimsCommand = (text) => COMMAND.test(String(text || '').trim());
export const redact = (value) => value
  ? `[redacted:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}]`
  : '';

function registryMode(tenant) {
  const value = String(tenant?.config?.claims?.authorityRegistry?.mode || 'off').toLowerCase();
  return ['shadow', 'enforce'].includes(value) ? value : 'off';
}

function requireRole(actor, allowed) {
  if (![...(actor?.roles || [])].some((value) => allowed.has(value))) {
    throw new Error('Claims authority access denied.');
  }
}

function requireTenant(tenant) {
  if (!tenant?.tenantId || !tenant?.key) throw new Error('Tenant identity is required.');
}

function requireLookup(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(String(value || ''))) throw new Error(`${label} lookup is invalid.`);
}

function createIdentityCodec(identityKey) {
  const input = Buffer.from(String(identityKey || ''));
  if (input.length < 32) throw new Error('Claims authority identity key must be at least 32 bytes.');
  const encryptionKey = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('encryption:'), input])).digest();
  const lookupKey = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('lookup:'), input])).digest();

  function opaque(tenant, entity, raw) {
    requireTenant(tenant);
    if (!ENTITIES.has(entity) || !String(raw || '')) throw new Error('Claims authority lookup scope is invalid.');
    return crypto.createHmac('sha256', lookupKey)
      .update(`${FIXED_KEY_ID}:${tenant.tenantId}:${entity}:${String(raw)}`)
      .digest('hex');
  }

  function encrypt(raw) {
    if (!String(raw || '')) throw new Error('Claims authority identity is required.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const value = Buffer.concat([cipher.update(String(raw), 'utf8'), cipher.final()]);
    return [FIXED_KEY_ID, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), value.toString('base64url')].join('.');
  }

  function decrypt(value) {
    const [keyId, ivValue, tagValue, encryptedValue, ...extra] = String(value || '').split('.');
    if (keyId !== FIXED_KEY_ID || !ivValue || !tagValue || !encryptedValue || extra.length) {
      throw new Error('Claims authority ciphertext key is unsupported.');
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivValue, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Claims authority ciphertext could not be authenticated.');
    }
  }

  return { opaque, encrypt, decrypt, keyId: FIXED_KEY_ID };
}

function canonicalEventFingerprint({ tenant, groupLookup, memberLookup = '', event }) {
  requireTenant(tenant);
  requireLookup(groupLookup, 'Group');
  if (memberLookup) requireLookup(memberLookup, 'Member');
  const webhookEventId = String(event?.webhookEventId || '').trim();
  const messageId = String(event?.message?.id || '').trim();
  const timestamp = Number.isFinite(Number(event?.timestamp)) ? Number(event.timestamp) : null;
  if (!webhookEventId && !messageId && timestamp === null) {
    throw new Error('LINE event has no stable idempotency identity.');
  }
  const canonical = webhookEventId
    ? ['v1', tenant.tenantId, groupLookup, memberLookup, String(event?.type || ''), 'webhook', webhookEventId]
    : ['v1', tenant.tenantId, groupLookup, memberLookup, String(event?.type || ''), 'fallback', timestamp, messageId];
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function createClaimsAuthority({ store, identityKey, financeProvisioner, openV3Claim, identityResolver, applicantReferenceFactory, membershipSynchronizer } = {}) {
  if (!store) throw new Error('Claims authority store is required.');
  const codec = createIdentityCodec(identityKey);

  const tenantTx = async (tenant, work) => {
    requireTenant(tenant);
    if (typeof store.transaction !== 'function') throw new Error('Claims authority tenant store is unavailable.');
    return store.transaction(tenant, work);
  };
  const discoveryTx = async (work) => {
    if (typeof store.discoveryTransaction !== 'function') throw new Error('Claims authority discovery store is unavailable.');
    return store.discoveryTransaction(work);
  };
  const platformTx = async (actor, work) => {
    requireRole(actor, PLATFORM_ONLY);
    if (typeof store.platformTransaction !== 'function') throw new Error('Claims authority platform store is unavailable.');
    return store.platformTransaction(actor, work);
  };
  const audit = (client, tenant, action, subject, actor, detail = {}) => client.query(
    '/* ca:audit */ INSERT INTO am_claims.audit (tenant_id,action,subject_lookup,actor_subject,detail) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [tenant.tenantId, action, subject || null, actor?.subject || null, JSON.stringify(detail)],
  );
  const outbox = (client, tenant, eventKey, type, group, detail = {}) => client.query(
    "/* ca:outbox */ INSERT INTO am_claims.outbox (tenant_id,event_key,event_type,group_lookup,payload,status,available_at) VALUES ($1,$2,$3,$4,$5::jsonb,'pending',now()) ON CONFLICT (tenant_id,event_key) DO NOTHING",
    [tenant.tenantId, eventKey, type, group, JSON.stringify(detail)],
  );
  const eventFingerprint = (tenant, groupLookup, memberLookup, event) => canonicalEventFingerprint({
    tenant,
    groupLookup,
    memberLookup,
    event,
  });
  const resolveOptionalName = async (resolver, input) => {
    if (typeof resolver !== 'function') return '';
    try {
      return String(await resolver(input) || '').trim().slice(0, 160);
    } catch {
      return '';
    }
  };

  async function discover({ event, groupId, groupDisplayName }) {
    const group = codec.opaque(PLATFORM_SCOPE, 'group', groupId);
    const fingerprint = eventFingerprint(PLATFORM_SCOPE, group, '', event);
    const resolvedName = String(groupDisplayName || '').trim().slice(0, 160)
      || await resolveOptionalName(identityResolver?.resolveGroupName, { groupId, event });
    return discoveryTx(async (client) => {
      await client.query(
        "/* ca:platform-discover */ INSERT INTO am_claims.discovered_groups (group_lookup,group_ciphertext,group_name_ciphertext,key_id,state,oa_state,last_event_key,updated_at) VALUES ($1,$2,$3,$4,'unassigned','present',$5,now()) ON CONFLICT (group_lookup) DO UPDATE SET group_name_ciphertext=COALESCE(EXCLUDED.group_name_ciphertext,am_claims.discovered_groups.group_name_ciphertext),oa_state='present',last_event_key=EXCLUDED.last_event_key,updated_at=now()",
        [group, codec.encrypt(groupId), resolvedName ? codec.encrypt(resolvedName) : null, codec.keyId, fingerprint],
      );
      return { handled: true, state: 'unassigned', discoveryLookup: group };
    });
  }

  async function activate({ tenant, actor, groupId, groupDisplayName = '', bindingId, financeScope }) {
    requireRole(actor, MANAGE);
    const group = codec.opaque(tenant, 'group', groupId);
    const binding = codec.opaque(tenant, 'binding', bindingId);
    const idempotencyKey = `activate:${group}:${binding}`;
    await tenantTx(tenant, async (client) => {
      await client.query(
        "/* ca:activating */ INSERT INTO am_claims.groups (tenant_id,group_lookup,group_ciphertext,group_name_ciphertext,binding_lookup,binding_ciphertext,key_id,state,oa_state) VALUES ($1,$2,$3,$4,$5,$6,$7,'activating','present') ON CONFLICT (tenant_id,group_lookup) DO UPDATE SET group_name_ciphertext=COALESCE(EXCLUDED.group_name_ciphertext,am_claims.groups.group_name_ciphertext),binding_lookup=EXCLUDED.binding_lookup,binding_ciphertext=EXCLUDED.binding_ciphertext,key_id=EXCLUDED.key_id,state='activating',oa_state='present',updated_at=now()",
        [tenant.tenantId, group, codec.encrypt(groupId), groupDisplayName ? codec.encrypt(groupDisplayName) : null, binding, codec.encrypt(bindingId), codec.keyId],
      );
      await outbox(client, tenant, idempotencyKey, 'activation_requested', group, { binding });
      await audit(client, tenant, 'activation_requested', group, actor, { binding });
    });
    try {
      const response = await financeProvisioner?.provision?.({
        tenantKey: tenant.key,
        bindingId,
        financeScope,
        idempotencyKey,
      });
      if (!response?.ok || !response?.sourceId) throw new Error('Finance source activation was rejected.');
      await tenantTx(tenant, async (client) => {
        await client.query(
          "/* ca:active */ UPDATE am_claims.groups SET state='active',finance_source_ref=$3,finance_form_key=$4,finance_group_reference=$5,last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2",
          [tenant.tenantId, group, String(response.sourceId), String(response.formKey), String(response.groupReference)],
        );
        await outbox(client, tenant, `${idempotencyKey}:active`, 'activation_succeeded', group, { binding });
        await audit(client, tenant, 'activation_succeeded', group, actor, { binding });
      });
      return { ok: true, state: 'active', groupLookup: group };
    } catch (error) {
      await tenantTx(tenant, async (client) => {
        await client.query(
          "/* ca:failed */ UPDATE am_claims.groups SET state='needs_attention',last_error=$3,updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2",
          [tenant.tenantId, group, String(error?.message || error).slice(0, 300)],
        );
        await outbox(client, tenant, `${idempotencyKey}:failed`, 'activation_failed', group, { binding });
        await audit(client, tenant, 'activation_failed', group, actor, { binding });
      });
      return { ok: false, state: 'needs_attention', groupLookup: group };
    }
  }

  async function assignGroup({ actor, discoveryLookup, tenant, bindingId, financeScope }) {
    requireRole(actor, PLATFORM_ONLY);
    requireLookup(discoveryLookup, 'Discovery');
    requireTenant(tenant);
    const discovered = await platformTx(actor, async (client) => {
      const result = await client.query(
        "/* ca:platform-claim */ SELECT group_ciphertext,group_name_ciphertext,key_id,state,assigned_tenant_id FROM am_claims.discovered_groups WHERE group_lookup=$1 FOR UPDATE",
        [discoveryLookup],
      );
      const row = result.rows?.[0];
      if (!row) throw new Error('Discovered LINE group was not found.');
      if (row.key_id !== codec.keyId) throw new Error('Discovered LINE group uses an unsupported fixed key.');
      const sameActivation = row.state === 'activating' && row.assigned_tenant_id === tenant.tenantId;
      if (!['unassigned', 'needs_attention'].includes(row.state) && !sameActivation) {
        throw new Error('Discovered LINE group is not assignable.');
      }
      await client.query(
        "/* ca:platform-activating */ UPDATE am_claims.discovered_groups SET state='activating',assigned_tenant_id=$2,last_error=NULL,updated_at=now() WHERE group_lookup=$1",
        [discoveryLookup, tenant.tenantId],
      );
      return row;
    });
    let groupId;
    let groupDisplayName;
    try {
      groupId = codec.decrypt(discovered.group_ciphertext);
      groupDisplayName = discovered.group_name_ciphertext ? codec.decrypt(discovered.group_name_ciphertext) : '';
    } catch (error) {
      await platformTx(actor, (client) => client.query(
        "/* ca:platform-decrypt-failed */ UPDATE am_claims.discovered_groups SET state='needs_attention',last_error='Identity ciphertext validation failed.',updated_at=now() WHERE group_lookup=$1",
        [discoveryLookup],
      ));
      throw error;
    }
    const activation = await activate({ tenant, actor, groupId, groupDisplayName, bindingId, financeScope });
    await platformTx(actor, async (client) => {
      await client.query(
        "/* ca:platform-assigned */ UPDATE am_claims.discovered_groups SET state=$2,assigned_tenant_id=$3,assigned_group_lookup=$4,last_error=$5,updated_at=now() WHERE group_lookup=$1",
        [
          discoveryLookup,
          activation.ok ? 'active' : 'needs_attention',
          tenant.tenantId,
          activation.groupLookup,
          activation.ok ? null : 'Finance source activation failed.',
        ],
      );
    });
    return { ...activation, discoveryLookup };
  }

  async function setMemberDenied({ tenant, actor, groupLookup, memberLookup, denied = true }) {
    requireRole(actor, MANAGE);
    requireLookup(groupLookup, 'Group');
    requireLookup(memberLookup, 'Member');
    const updated = await tenantTx(tenant, async (client) => {
      const result = await client.query(
        `/* ca:deny-lookup */ WITH changed AS (
           UPDATE am_claims.members SET manual_deny=$4,updated_at=now()
           WHERE tenant_id=$1 AND group_lookup=$2 AND member_lookup=$3
           RETURNING member_lookup,identity_reference
         ) SELECT c.member_lookup,c.identity_reference,g.finance_source_ref
           FROM changed c JOIN am_claims.groups g ON g.tenant_id=$1 AND g.group_lookup=$2`,
        [tenant.tenantId, groupLookup, memberLookup, Boolean(denied)],
      );
      if (!result.rows?.length) throw new Error('Claims authority member was not found.');
      await audit(client, tenant, denied ? 'member_denied' : 'member_allowed', memberLookup, actor, { group: groupLookup });
      return result.rows[0];
    });
    let financeSync = 'not_applicable';
    if (updated.identity_reference && updated.finance_source_ref && typeof membershipSynchronizer === 'function') {
      try {
        const eventSequence = Date.now();
        const result = await membershipSynchronizer({
          contractVersion: 'finance-claims-v3.am-bridge-v1',
          requestId: `member-policy-${crypto.randomUUID()}`,
          tenantKey: tenant.key,
          sourceId: updated.finance_source_ref,
          identityReference: updated.identity_reference,
          desiredState: denied ? 'revoked' : 'active',
          eventSequence,
          effectiveAt: new Date(eventSequence).toISOString(),
        });
        financeSync = result?.status === 200 && result.body?.effectiveState === (denied ? 'revoked' : 'active') ? 'applied' : 'pending';
      } catch {
        financeSync = 'pending';
      }
    }
    return { ok: true, denied: Boolean(denied), financeSync };
  }

  async function setGroupState({ tenant, actor, groupLookup, state }) {
    requireRole(actor, MANAGE);
    requireLookup(groupLookup, 'Group');
    if (!['active', 'paused'].includes(state)) throw new Error('Claims authority group state is invalid.');
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        '/* ca:set-group-state */ UPDATE am_claims.groups SET state=$3,updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2 RETURNING group_lookup,state',
        [tenant.tenantId, groupLookup, state],
      );
      if (!result.rows?.length) throw new Error('Claims authority group was not found.');
      await audit(client, tenant, `group_${state}`, groupLookup, actor);
      return result.rows[0];
    });
  }

  async function handleEvent({ tenant, binding, event, openClaim = openV3Claim }) {
    const groupId = event?.source?.groupId || event?.source?.roomId;
    if (!groupId) return { handled: false };
    if (!tenant?.tenantId || !tenant?.key) return discover({ event, groupId });
    requireTenant(tenant);
    const currentMode = registryMode(tenant);
    if (currentMode === 'off') return { handled: false, mode: 'legacy' };
    const liveBindingId = String(binding?.pageId || binding?.id || '');
    if (!liveBindingId) {
      const groupLookup = codec.opaque(tenant, 'group', groupId);
      const registered = await tenantTx(tenant, (client) => client.query(
        '/* ca:resolve-group */ SELECT binding_ciphertext,finance_source_ref,finance_form_key,finance_group_reference FROM am_claims.groups WHERE tenant_id=$1 AND group_lookup=$2',
        [tenant.tenantId, groupLookup],
      ));
      const row = registered.rows?.[0];
      if (!row) return discover({ event, groupId });
      binding = {
        pageId: codec.decrypt(row.binding_ciphertext),
        financeSourceId: row.finance_source_ref,
        claimFormKey: row.finance_form_key,
        groupReference: row.finance_group_reference,
      };
    }
    if (isClaimsCommand(event.message?.text) && liveBindingId) {
      const groupLookup = codec.opaque(tenant, 'group', groupId);
      await tenantTx(tenant, (client) => client.query(
        `/* ca:reconcile-origin-binding */ UPDATE am_claims.groups
         SET binding_lookup=$3,binding_ciphertext=$4,last_error=NULL,updated_at=now()
         WHERE tenant_id=$1 AND group_lookup=$2`,
        [tenant.tenantId, groupLookup, codec.opaque(tenant, 'binding', liveBindingId), codec.encrypt(liveBindingId)],
      ));
    }
    const userId = event?.source?.userId;
    const group = codec.opaque(tenant, 'group', groupId);
    const member = userId ? codec.opaque(tenant, 'member', userId) : '';
    const identityReference = userId && typeof applicantReferenceFactory === 'function'
      ? String(await applicantReferenceFactory({ tenant, userId }) || '') : '';
    const fingerprint = eventFingerprint(tenant, group, member, event);
    const outcome = await tenantTx(tenant, async (client) => {
      const accepted = await client.query(
        '/* ca:event */ INSERT INTO am_claims.events (tenant_id,event_key,event_type,group_lookup,member_lookup) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,event_key) DO NOTHING RETURNING event_key',
        [tenant.tenantId, fingerprint, String(event?.type || 'unknown'), group, member || null],
      );
      if (!accepted.rows?.length) return { handled: true, mode: currentMode, duplicate: true };
      if (event.type === 'leave') {
        await client.query(
          "/* ca:leave */ UPDATE am_claims.groups SET state='paused',oa_state='left',updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2",
          [tenant.tenantId, group],
        );
      }
      if (event.type === 'join') {
        await client.query(
          "/* ca:join */ UPDATE am_claims.groups SET oa_state='present',updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2",
          [tenant.tenantId, group],
        );
      }
      if (event.type === 'memberLeft') {
        for (const item of event.left?.members || []) {
          await client.query(
            "/* ca:left */ UPDATE am_claims.members SET state='left',updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2 AND member_lookup=$3",
            [tenant.tenantId, group, codec.opaque(tenant, 'member', item.userId)],
          );
        }
      }
      if (event.type === 'message' && userId) {
        const memberDisplayName = await resolveOptionalName(identityResolver?.resolveMemberName, { groupId, userId, event });
        await client.query(
          "/* ca:observed */ INSERT INTO am_claims.members (tenant_id,tenant_key,group_lookup,member_lookup,member_ciphertext,member_name_ciphertext,identity_reference,key_id,state,manual_deny,first_observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'observed',false,now()) ON CONFLICT (tenant_id,group_lookup,member_lookup) DO UPDATE SET tenant_key=EXCLUDED.tenant_key,identity_reference=EXCLUDED.identity_reference,member_name_ciphertext=COALESCE(EXCLUDED.member_name_ciphertext,am_claims.members.member_name_ciphertext),state=CASE WHEN am_claims.members.state='left' THEN 'observed' ELSE am_claims.members.state END,updated_at=now()",
          [tenant.tenantId, tenant.key, group, member, codec.encrypt(userId), memberDisplayName ? codec.encrypt(memberDisplayName) : null, identityReference || null, codec.keyId],
        );
      }
      await outbox(client, tenant, `line:${fingerprint}`, `line_${event.type}`, group, { type: event.type });
      await audit(client, tenant, `line_${event.type}`, group, null, { hasUser: Boolean(userId), event: fingerprint });
      if (!isClaimsCommand(event.message?.text)) return { handled: true, mode: currentMode };
      if (!userId) return { handled: true, mode: currentMode, claim: { ok: false, reason: 'identity_unavailable' } };
      const authorization = await client.query(
        '/* ca:authorize */ SELECT g.state AS group_state,g.oa_state,m.state AS member_state,m.manual_deny FROM am_claims.groups g LEFT JOIN am_claims.members m ON m.tenant_id=g.tenant_id AND m.group_lookup=g.group_lookup AND m.member_lookup=$3 WHERE g.tenant_id=$1 AND g.group_lookup=$2',
        [tenant.tenantId, group, member],
      );
      const row = authorization.rows?.[0];
      const allowed = row?.group_state === 'active'
        && row?.oa_state === 'present'
        && row?.member_state === 'observed'
        && !row?.manual_deny;
      const routing = await client.query(
        `/* ca:form-routing */ SELECT c.revision,f.form_key
         FROM am_claims.group_form_configs c
         LEFT JOIN am_claims.group_forms f ON f.tenant_id=c.tenant_id AND f.group_lookup=c.group_lookup
         WHERE c.tenant_id=$1 AND c.group_lookup=$2 ORDER BY f.sort_order,f.form_key`,
        [tenant.tenantId, group],
      );
      const configured = routing.rows?.length > 0;
      const availableForms = configured ? routing.rows.map((item) => item.form_key).filter((key) => CLAIM_FORM_KEY_SET.has(key)) : [];
      return {
        handled: true,
        mode: currentMode,
        claim: {
          ok: (currentMode === 'shadow' || allowed) && (!configured || availableForms.length > 0),
          allowed,
          reason: !allowed ? 'not_ready_or_denied' : configured && !availableForms.length ? 'no_forms_published' : null,
          routing: { configured, revision: Number(routing.rows?.[0]?.revision || 0), availableForms },
        },
      };
    });
    if (outcome.duplicate) return outcome;
    if (outcome.claim?.ok && typeof openClaim === 'function') {
      return { ...outcome, v3: await openClaim({ tenant, binding, event, groupId, userId, groupLookup: group, memberLookup: member, idempotencyKey: fingerprint, routing: outcome.claim.routing }) };
    }
    return outcome;
  }

  async function listGroups({ tenant, actor }) {
    requireRole(actor, READ);
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        '/* ca:list */ SELECT group_lookup,group_name_ciphertext,state,oa_state,finance_source_ref,last_error,discovered_at,updated_at FROM am_claims.groups WHERE tenant_id=$1 ORDER BY updated_at DESC',
        [tenant.tenantId],
      );
      await audit(client, tenant, 'groups_listed', null, actor);
      return (result.rows || []).map(({ group_name_ciphertext: encryptedName, ...row }) => ({
        ...row,
        display_name: encryptedName ? codec.decrypt(encryptedName) : '',
      }));
    });
  }

  async function listMembers({ tenant, actor, groupLookup }) {
    requireRole(actor, READ);
    requireLookup(groupLookup, 'Group');
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        '/* ca:list-members */ SELECT member_lookup,member_name_ciphertext,state,manual_deny,first_observed_at,updated_at FROM am_claims.members WHERE tenant_id=$1 AND group_lookup=$2 ORDER BY first_observed_at,member_lookup',
        [tenant.tenantId, groupLookup],
      );
      await audit(client, tenant, 'members_listed', groupLookup, actor);
      return (result.rows || []).map(({ member_name_ciphertext: encryptedName, ...row }) => ({
        ...row,
        display_name: encryptedName ? codec.decrypt(encryptedName) : '',
      }));
    });
  }

  async function listUnassigned({ actor }) {
    requireRole(actor, PLATFORM_ONLY);
    return platformTx(actor, async (client) => {
      const result = await client.query(
        "/* ca:list-unassigned */ SELECT group_lookup,group_name_ciphertext,state,oa_state,assigned_tenant_id,last_error,discovered_at,updated_at FROM am_claims.discovered_groups WHERE state IN ('unassigned','needs_attention') ORDER BY updated_at DESC",
      );
      return (result.rows || []).map(({ group_name_ciphertext: encryptedName, ...row }) => ({
        ...row,
        display_name: encryptedName ? codec.decrypt(encryptedName) : '',
      }));
    });
  }

  async function resolveNotificationRecipient({ tenantKey, identityReference, allowDenied = false }) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u.test(String(tenantKey || ''))
      || !/^line-ref:v1:[0-9a-f-]{36}$/iu.test(String(identityReference || ''))) return null;
    return platformTx({ subject: 'claims-notification-router', roles: ['platform_owner'] }, async (client) => {
      const result = await client.query(
        `/* ca:resolve-notification-recipient */ SELECT m.member_ciphertext,m.key_id,m.manual_deny
         FROM am_claims.members m
         JOIN am_claims.groups g ON g.tenant_id=m.tenant_id AND g.group_lookup=m.group_lookup
         WHERE m.tenant_key=$1 AND m.identity_reference=$2 AND m.state='observed'
           AND g.state='active' AND g.oa_state='present'`,
        [String(tenantKey), String(identityReference)],
      );
      if (!allowDenied && !(result.rows || []).some((row) => !row.manual_deny)) return null;
      const targets = [...new Set((result.rows || []).map((row) => {
        if (row.key_id !== codec.keyId) throw new Error('Claims notification recipient uses an unsupported fixed key.');
        return codec.decrypt(row.member_ciphertext);
      }))];
      if (targets.length !== 1) return null;
      return { tenantKey: String(tenantKey), type: 'line_user', target: targets[0] };
    });
  }

  function requireFormKey(formKey) {
    if (!CLAIM_FORM_KEY_SET.has(String(formKey || ''))) throw new Error('請款單識別碼無效。');
    return String(formKey);
  }

  async function listFormGroups({ tenant, actor, formKey }) {
    requireRole(actor, READ);
    const key = requireFormKey(formKey);
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        `/* ca:list-form-groups */ SELECT g.group_lookup,g.group_name_ciphertext,g.state,g.oa_state,
           (f.form_key IS NOT NULL) AS assigned,COALESCE(c.revision,0)::int AS routing_revision
         FROM am_claims.groups g
         LEFT JOIN am_claims.group_form_configs c ON c.tenant_id=g.tenant_id AND c.group_lookup=g.group_lookup
         LEFT JOIN am_claims.group_forms f ON f.tenant_id=g.tenant_id AND f.group_lookup=g.group_lookup AND f.form_key=$2
         WHERE g.tenant_id=$1 ORDER BY g.updated_at DESC`,
        [tenant.tenantId, key],
      );
      await audit(client, tenant, 'form_groups_listed', null, actor, { formKey: key });
      return (result.rows || []).map(({ group_name_ciphertext: encryptedName, ...row }) => ({
        ...row,
        display_name: encryptedName ? codec.decrypt(encryptedName) : '',
      }));
    });
  }

  async function publishFormGroups({ tenant, actor, formKey, groupLookups }) {
    requireRole(actor, MANAGE);
    const key = requireFormKey(formKey);
    const selected = [...new Set((Array.isArray(groupLookups) ? groupLookups : []).map(String))];
    if (selected.length > 500) throw new Error('一次最多設定 500 個群組。');
    selected.forEach((lookup) => requireLookup(lookup, 'Group'));
    return tenantTx(tenant, async (client) => {
      const existing = await client.query('/* ca:form-groups-before */ SELECT group_lookup FROM am_claims.group_forms WHERE tenant_id=$1 AND form_key=$2 FOR UPDATE', [tenant.tenantId, key]);
      const before = existing.rows.map((row) => String(row.group_lookup));
      if (selected.length) {
        const eligible = await client.query("/* ca:form-groups-eligible */ SELECT group_lookup FROM am_claims.groups WHERE tenant_id=$1 AND group_lookup=ANY($2::char(64)[]) AND state='active' AND oa_state='present'", [tenant.tenantId, selected]);
        if (eligible.rows.length !== selected.length) throw new Error('只能發布給目前啟用且小幫手仍在群內的群組。');
      }
      const affected = [...new Set([...before, ...selected])];
      for (const lookup of affected) {
        await client.query(
          `/* ca:publish-form-config */ INSERT INTO am_claims.group_form_configs(tenant_id,group_lookup,revision,published_by)
           VALUES($1,$2,1,$3) ON CONFLICT(tenant_id,group_lookup) DO UPDATE
           SET revision=am_claims.group_form_configs.revision+1,published_at=now(),published_by=EXCLUDED.published_by`,
          [tenant.tenantId, lookup, actor?.subject || null],
        );
      }
      await client.query('/* ca:replace-form-groups */ DELETE FROM am_claims.group_forms WHERE tenant_id=$1 AND form_key=$2', [tenant.tenantId, key]);
      for (const lookup of selected) {
        await client.query(
          '/* ca:add-form-group */ INSERT INTO am_claims.group_forms(tenant_id,group_lookup,form_key,sort_order,published_by) VALUES($1,$2,$3,$4,$5)',
          [tenant.tenantId, lookup, key, CLAIM_FORM_KEYS.indexOf(key), actor?.subject || null],
        );
      }
      await audit(client, tenant, 'form_groups_published', null, actor, { formKey: key, before, after: selected, immediate: true });
      return { ok: true, formKey: key, assignedCount: selected.length, affectedGroupCount: affected.length };
    });
  }

  async function createFormSelectionSession({ tenant, groupLookup, memberLookup, eventKey, formKeys, ttlMs = 15 * 60 * 1000 }) {
    requireLookup(groupLookup, 'Group');
    requireLookup(memberLookup, 'Member');
    const keys = [...new Set((formKeys || []).map(requireFormKey))];
    if (!keys.length) throw new Error('此群組尚未發布可用的請款單。');
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        `/* ca:create-form-session */ INSERT INTO am_claims.form_selection_sessions
         (tenant_id,session_id,group_lookup,member_lookup,event_key,available_form_keys,expires_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(tenant_id,event_key) DO UPDATE SET event_key=EXCLUDED.event_key
         RETURNING session_id,expires_at,available_form_keys`,
        [tenant.tenantId, sessionId, groupLookup, memberLookup, eventKey, JSON.stringify(keys), expiresAt],
      );
      return { sessionId: result.rows[0].session_id, expiresAt: new Date(result.rows[0].expires_at).toISOString(), formKeys: result.rows[0].available_form_keys };
    });
  }

  async function resolveFormSelection({ tenant, sessionId, formKey = '' }) {
    if (!/^[0-9a-f-]{36}$/iu.test(String(sessionId || ''))) throw new Error('請款連結無效。');
    const requestedKey = formKey ? requireFormKey(formKey) : '';
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        `/* ca:resolve-form-session */ SELECT s.*,g.group_ciphertext,g.group_name_ciphertext,g.binding_ciphertext,
           g.finance_source_ref,g.finance_form_key,g.finance_group_reference,m.member_ciphertext,m.manual_deny,m.state AS member_state,
           g.state AS group_state,g.oa_state
         FROM am_claims.form_selection_sessions s
         JOIN am_claims.groups g ON g.tenant_id=s.tenant_id AND g.group_lookup=s.group_lookup
         JOIN am_claims.members m ON m.tenant_id=s.tenant_id AND m.group_lookup=s.group_lookup AND m.member_lookup=s.member_lookup
         WHERE s.tenant_id=$1 AND s.session_id=$2`,
        [tenant.tenantId, sessionId],
      );
      const row = result.rows?.[0];
      if (!row || Date.parse(row.expires_at) <= Date.now()) throw new Error('請款連結已失效，請回到群組重新輸入「請款」。');
      if (row.group_state !== 'active' || row.oa_state !== 'present' || row.member_state !== 'observed' || row.manual_deny) throw new Error('目前沒有使用此請款連結的權限。');
      const current = await client.query('/* ca:current-form-routing */ SELECT form_key FROM am_claims.group_forms WHERE tenant_id=$1 AND group_lookup=$2 ORDER BY sort_order,form_key', [tenant.tenantId, row.group_lookup]);
      const available = current.rows.map((item) => item.form_key).filter((key) => row.available_form_keys.includes(key));
      if (requestedKey && !available.includes(requestedKey)) throw new Error('這張請款單目前不適用此群組。');
      if (requestedKey && row.selected_form_key && row.selected_form_key !== requestedKey) throw new Error('此連結已選擇其他請款單，請回群組重新開啟。');
      return {
        sessionId: row.session_id,
        expiresAt: new Date(row.expires_at).toISOString(),
        formKeys: available,
        selectedFormKey: row.selected_form_key || '',
        resolvedUrl: row.resolved_url || '',
        groupId: codec.decrypt(row.group_ciphertext),
        groupName: row.group_name_ciphertext ? codec.decrypt(row.group_name_ciphertext) : '',
        bindingId: codec.decrypt(row.binding_ciphertext),
        userId: codec.decrypt(row.member_ciphertext),
        sourceId: row.finance_source_ref,
        v3FormKey: row.finance_form_key,
        groupReference: row.finance_group_reference,
      };
    });
  }

  async function completeFormSelection({ tenant, sessionId, formKey, resolvedUrl }) {
    const key = requireFormKey(formKey);
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        `/* ca:complete-form-session */ UPDATE am_claims.form_selection_sessions
         SET selected_form_key=$3,resolved_url=$4,selected_at=COALESCE(selected_at,now())
         WHERE tenant_id=$1 AND session_id=$2 AND (selected_form_key IS NULL OR selected_form_key=$3)
         RETURNING session_id`,
        [tenant.tenantId, sessionId, key, String(resolvedUrl || '').slice(0, 4096)],
      );
      if (!result.rows.length) throw new Error('此連結已選擇其他請款單，請回群組重新開啟。');
      return { ok: true };
    });
  }

  return {
    discover,
    activate,
    assignGroup,
    handleEvent,
    listGroups,
    listMembers,
    listUnassigned,
    resolveNotificationRecipient,
    listFormGroups,
    publishFormGroups,
    createFormSelectionSession,
    resolveFormSelection,
    completeFormSelection,
    setGroupState,
    setMemberDenied,
    eventFingerprint,
    opaqueIdentity: codec.opaque,
    fixedKeyId: codec.keyId,
  };
}

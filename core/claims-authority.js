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

export function createClaimsAuthority({ store, identityKey, financeProvisioner, openV3Claim, identityResolver } = {}) {
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
    return tenantTx(tenant, async (client) => {
      const result = await client.query(
        '/* ca:deny-lookup */ UPDATE am_claims.members SET manual_deny=$4,updated_at=now() WHERE tenant_id=$1 AND group_lookup=$2 AND member_lookup=$3 RETURNING member_lookup',
        [tenant.tenantId, groupLookup, memberLookup, Boolean(denied)],
      );
      if (!result.rows?.length) throw new Error('Claims authority member was not found.');
      await audit(client, tenant, denied ? 'member_denied' : 'member_allowed', memberLookup, actor, { group: groupLookup });
      return { ok: true, denied: Boolean(denied) };
    });
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
    if (!binding?.id && !binding?.pageId) {
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
    const userId = event?.source?.userId;
    const group = codec.opaque(tenant, 'group', groupId);
    const member = userId ? codec.opaque(tenant, 'member', userId) : '';
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
          "/* ca:observed */ INSERT INTO am_claims.members (tenant_id,group_lookup,member_lookup,member_ciphertext,member_name_ciphertext,key_id,state,manual_deny,first_observed_at) VALUES ($1,$2,$3,$4,$5,$6,'observed',false,now()) ON CONFLICT (tenant_id,group_lookup,member_lookup) DO UPDATE SET member_name_ciphertext=COALESCE(EXCLUDED.member_name_ciphertext,am_claims.members.member_name_ciphertext),state=CASE WHEN am_claims.members.state='left' THEN 'observed' ELSE am_claims.members.state END,updated_at=now()",
          [tenant.tenantId, group, member, codec.encrypt(userId), memberDisplayName ? codec.encrypt(memberDisplayName) : null, codec.keyId],
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
      return {
        handled: true,
        mode: currentMode,
        claim: {
          ok: currentMode === 'shadow' || allowed,
          allowed,
          reason: allowed ? null : 'not_ready_or_denied',
        },
      };
    });
    if (outcome.duplicate) return outcome;
    if (outcome.claim?.ok && typeof openClaim === 'function') {
      return { ...outcome, v3: await openClaim({ tenant, binding, event, groupId, userId, idempotencyKey: fingerprint }) };
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

  return {
    discover,
    activate,
    assignGroup,
    handleEvent,
    listGroups,
    listMembers,
    listUnassigned,
    setGroupState,
    setMemberDenied,
    eventFingerprint,
    opaqueIdentity: codec.opaque,
    fixedKeyId: codec.keyId,
  };
}

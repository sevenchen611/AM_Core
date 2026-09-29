import { ioError } from './store.js';

const groupPattern = /^C[0-9a-f]{32}$/i;
const userPattern = /^U[0-9a-f]{32}$/i;
const iso = (ms) => Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null;
async function concurrent(items, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4,items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

export function createDirectory({ store, router, line, clients, ioState, now = Date.now }) {
  let scanAt = 0;
  let scanComplete = false;
  let scanning;
  let enumerationDeniedUntil = 0;
  // Per-group, short-lived snapshots avoid enumerating hundreds of members on every page.
  const enumerated = new Map();
  let routes = new Map();
  async function sync() {
    if (scanAt && now() - scanAt < 300000) return;
    if (scanning) return scanning;
    scanning = (async () => {
      const scanned = await router.listDirectoryBindings();
      const nextRoutes = new Map();
      for (const group of scanned.groups) nextRoutes.set(group.groupId,
        nextRoutes.has(group.groupId) ? null : { tenantKey:group.tenantKey,status:group.status });
      const groups = scanned.groups.map((g) => ({ ...g, members: Object.fromEntries(
        Object.entries(g.members || {}).filter(([,id]) => userPattern.test(id)).map(([name,id]) => [id,name])) }));
      for (const client of clients) for (const groupId of client.groupIds) {
        const group = groups.find((g) => g.groupId === groupId) || { groupId,members: {} };
        if (!groups.includes(group)) groups.push(group);
        for (const id of [...(client.inputUserIds || []),client.notifyUserId].filter(Boolean)) group.members[id] ||= '';
      }
      await store.seed(groups.filter((g) => groupPattern.test(g.groupId)));
      scanComplete = scanned.complete;
      routes = scanned.complete ? nextRoutes : new Map();
      scanAt = now();
    })();
    try { await scanning; } finally { scanning = null; }
  }
  async function capture(events) {
    const records = [];
    for (const e of events) {
      if (e?.source?.type !== 'group' || !groupPattern.test(e.source.groupId)) continue;
      if (!Number.isSafeInteger(e.timestamp) || e.timestamp <= 0 || e.timestamp > now() + 300000) continue;
      const members = new Map();
      if (userPattern.test(e.source.userId)) members.set(e.source.userId,
        { userId:e.source.userId,membership:'present',interacted:['message','postback'].includes(e.type) });
      for (const m of e.joined?.members || []) if (userPattern.test(m.userId)) members.set(m.userId,{ userId:m.userId,membership:'present' });
      for (const m of e.left?.members || []) if (userPattern.test(m.userId)) members.set(m.userId,{ userId:m.userId,membership:'left' });
      records.push({ groupId:e.source.groupId,at:e.timestamp,presence:e.type === 'leave' ? 'left' : 'present',members:[...members.values()] });
      enumerated.delete(e.source.groupId);
    }
    if (records.length) await store.observe(records);
  }
  function pagination(url, kind) {
    const after = url.searchParams.get('after') || '';
    const raw = url.searchParams.get('limit') || '25';
    if ((after && !(kind === 'groups' ? groupPattern : userPattern).test(after))
      || !/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 50) throw ioError(400,'invalid_pagination');
    return { after,limit:Number(raw) };
  }
  async function authorize(client, groupId) {
    if (client.directoryAllGroups) return;
    if (!client.groupIds.includes(groupId)) throw ioError(403,'group_denied');
    router.invalidate(groupId);
    const route = await router.resolveGroupBinding(groupId);
    if (route.tenant?.key !== client.tenantKey || !route.binding) throw ioError(403,'group_unavailable');
  }
  async function summary(groupId) {
    try {
      const value = await line.lineGet(`/v2/bot/group/${groupId}/summary`,{ timeoutMs:4000 });
      return { presence:'present',name:value.groupName || '',checkedAt:new Date(now()).toISOString() };
    } catch (e) {
      return { presence:'unknown',checkedAt:new Date(now()).toISOString(),
        warning:[400,404].includes(e.lineStatus) ? 'group_not_accessible' : 'group_verification_unavailable' };
    }
  }
  async function groups(client,url) {
    await sync();
    const page = await store.groups({ ...pagination(url,'groups'),groupIds:client.directoryAllGroups ? null : client.groupIds });
    const groups = (await concurrent(page.rows,async (row) => {
      try { await authorize(client,row.groupId); } catch (e) { if (e.status === 403) return null; throw e; }
      const verified = await summary(row.groupId);
      return { groupId:row.groupId,name:verified.name || row.name,presence:verified.presence,
        observedPresence:row.presence,lastSeenAt:iso(row.lastSeenAt),presenceCheckedAt:verified.checkedAt,
        selectable:verified.presence === 'present',warning:verified.warning || null,
        io:await ioState(client,row.groupId,routes.get(row.groupId),scanComplete) };
    })).filter(Boolean);
    return { groups,nextCursor:page.rows.at(-1)?.groupId || url.searchParams.get('after') || '',hasMore:page.hasMore,
      coverage:{ scope:client.directoryAllGroups ? 'oa-known-groups' : 'client-authorized-groups',
        complete:false,reason:'LINE has no endpoint enumerating every group containing the OA; unseen historical groups require a new webhook event.',
        bindingScanComplete:scanComplete,bindingScannedAt:new Date(scanAt).toISOString() } };
  }
  async function members(client,groupId,url) {
    if (!groupPattern.test(groupId)) throw ioError(400,'invalid_group');
    const paging = pagination(url,'members');
    await authorize(client,groupId);
    await sync();
    if (!await store.group(groupId)) throw ioError(404,'group_not_known');
    const group = await summary(groupId);
    if (group.presence !== 'present') throw ioError(503,'group_verification_unavailable');
    let enumeration = enumerated.get(groupId);
    if (!enumeration || now() - enumeration.at > 60000) {
      enumeration = { at:now(),complete:false,reason:'member_enumeration_unavailable' };
      if (now() < enumerationDeniedUntil) enumeration.reason = 'oa_member_enumeration_forbidden';
      else {
        try {
          const ids = await line.listGroupMemberIds(groupId,{ timeoutMs:4000,maxPages:100,deadlineMs:12000 });
          await store.seed([{ groupId,members:Object.fromEntries(ids.filter((id) => userPattern.test(id)).map((id) => [id,''])) }]);
          enumeration = { at:now(),complete:true,reason:null,ids:new Set(ids) };
        } catch (e) {
          if (e.lineStatus === 403) { enumerationDeniedUntil = now() + 3600000; enumeration.reason = 'oa_member_enumeration_forbidden'; }
        }
      }
      enumerated.set(groupId,enumeration);
      if (enumerated.size > 1000) enumerated.delete(enumerated.keys().next().value);
    }
    let memberCount = null;
    try { memberCount = (await line.lineGet(`/v2/bot/group/${groupId}/members/count`,{ timeoutMs:4000 })).count; } catch {}
    const page = await store.members({ groupId,...paging });
    const users = await concurrent(page.rows,async (row) => {
      const base = { userId:row.userId,displayName:row.displayName,lastSeenAt:iso(row.lastSeenAt),active:false,
        membership:row.membership,checkedAt:null };
      if ((enumeration.complete && !enumeration.ids.has(row.userId)) || (!enumeration.complete && row.membership === 'left')) return { ...base,membership:'left' };
      try {
        const profile = await line.lineGet(`/v2/bot/group/${groupId}/member/${row.userId}`,{ timeoutMs:4000 });
        return { ...base,displayName:profile.displayName || row.displayName,membership:'present',active:true,checkedAt:new Date(now()).toISOString() };
      } catch (e) { return { ...base,membership:'unknown',checkedAt:new Date(now()).toISOString(),
        warning:e.lineStatus === 404 ? 'profile_not_accessible' : 'member_verification_unavailable' }; }
    });
    return { groupId,name:group.name,users,activeUserIds:users.filter((u) => u.active).map((u) => u.userId),
      activeDefinition:'Group member profile successfully verified at checkedAt; not online presence.',
      nextCursor:page.rows.at(-1)?.userId || paging.after,hasMore:page.hasMore,
      coverage:{ complete:enumeration.complete,reason:enumeration.reason,memberCount,
        enumeratedAt:new Date(enumeration.at).toISOString(),verificationComplete:users.every((u) => u.membership !== 'unknown'),
        note:'activeUserIds covers this page only; follow nextCursor while hasMore is true. Membership can change after verification.' } };
  }
  return { capture,groups,members };
}

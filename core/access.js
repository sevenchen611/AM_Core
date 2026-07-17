// AM Platform core — 租戶 / 對話群組授權模型。
//
// Portal 帳號的 amAccess 是唯一群組權限來源；allowedFeatures / projectIds 只在 shadow
// 遷移期作為 legacy 判斷。所有 page id 比對都正規化，避免 Notion UUID 有無連字號造成誤判。

const VALID_MODES = new Set(['shadow', 'enforce', 'owner-only']);

export const normalizeBindingId = (value) => String(value || '').trim().replace(/-/g, '').toLowerCase();

export function normalizeAuthzMode(value, fallback = 'shadow') {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : fallback;
}

export function normalizeAmAccess(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const result = {};
  for (const [rawTenantKey, rawEntry] of Object.entries(value)) {
    const tenantKey = String(rawTenantKey || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(tenantKey) || !rawEntry || typeof rawEntry !== 'object') continue;
    const mode = rawEntry.mode === 'all' ? 'all' : 'selected';
    const ids = [...new Set((Array.isArray(rawEntry.groupBindingIds) ? rawEntry.groupBindingIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean))];
    if (mode === 'selected' && !ids.length && rawEntry.reviewed !== false) continue;
    result[tenantKey] = {
      mode,
      groupBindingIds: mode === 'all' ? [] : ids,
      reviewed: rawEntry.reviewed !== false,
    };
  }
  return result;
}

export class AccessDeniedError extends Error {
  constructor(message = 'Forbidden', statusCode = 403) {
    super(message);
    this.name = 'AccessDeniedError';
    this.statusCode = statusCode;
  }
}

export function createAccessContext({
  user,
  tenant,
  authzMode = 'shadow',
  legacyAllowed = false,
  principal = 'portal',
  logger = console,
} = {}) {
  const tenantKey = String(tenant?.key || '').trim().toLowerCase();
  const platformOwner = Boolean(user && user.role === 'owner');
  const modeSetting = normalizeAuthzMode(authzMode);
  const amAccess = normalizeAmAccess(user?.amAccess);
  const entry = tenantKey ? amAccess[tenantKey] : null;
  const selected = new Set((entry?.groupBindingIds || []).map(normalizeBindingId).filter(Boolean));
  const explicitValid = Boolean(entry?.reviewed !== false
    && (entry?.mode === 'all' || (entry?.mode === 'selected' && selected.size > 0)));

  let mode = 'none';
  let allowed = false;
  let shadowFallback = false;
  if (platformOwner || principal === 'emergency-owner') {
    mode = 'owner';
    allowed = true;
  } else if (modeSetting !== 'owner-only' && explicitValid) {
    mode = entry.mode;
    allowed = true;
  } else if (modeSetting === 'shadow' && legacyAllowed) {
    // shadow 只記錄「新制原本會拒絕」，不在遷移期間中斷既有入口。
    mode = 'legacy';
    allowed = true;
    shadowFallback = true;
  }

  const isTenantAll = mode === 'owner' || mode === 'all' || mode === 'legacy';
  const actor = String(user?.displayName || user?.username || user?.id
    || (principal === 'emergency-owner' ? '緊急最高管理者' : 'Portal 使用者')).slice(0, 120);

  function canGroup(groupBindingId, { status = '啟用' } = {}) {
    if (!allowed) return false;
    if (isTenantAll) return true;
    if (mode !== 'selected' || status !== '啟用') return false;
    return selected.has(normalizeBindingId(groupBindingId));
  }

  function can(action, groupBindingId, options = {}) {
    if (!allowed) return false;
    const name = String(action || 'tenant.read');
    if (name === 'tenant.read') return true;
    if (name === 'unassigned.read' || name === 'unassigned.manage' || name === 'groups.core') return isTenantAll;
    if (!groupBindingId) return false;
    if (name === 'groups.core.edit' && !isTenantAll) return false;
    return canGroup(groupBindingId, options);
  }

  function assert(action, groupBindingId, options = {}) {
    if (can(action, groupBindingId, options)) return true;
    const specific = Boolean(groupBindingId);
    throw new AccessDeniedError(specific ? '找不到可存取的群組資料。' : '您沒有此租戶的權限。', specific ? 404 : 403);
  }

  function filterBindings(rows, action = 'groups.read') {
    return (Array.isArray(rows) ? rows : []).filter((row) => can(action, row?.id, { status: row?.status || '啟用' }));
  }

  if (shadowFallback) {
    logger?.warn?.(`AM group authz shadow fallback (user=${user?.id || '?'}, tenant=${tenantKey || '?'})`);
  }

  return {
    user: user || null,
    principal,
    tenantKey,
    authzMode: modeSetting,
    mode,
    allowed,
    shadowFallback,
    isPlatformOwner: platformOwner || principal === 'emergency-owner',
    isTenantAll,
    allowsUnassigned: isTenantAll,
    allowedGroupIds: entry?.mode === 'selected' ? [...(entry.groupBindingIds || [])] : [],
    groupBindingIds: entry?.mode === 'selected' ? [...(entry.groupBindingIds || [])] : [],
    authzVersion: Number(user?.authzVersion) || 0,
    actor,
    canGroup,
    can,
    assert,
    filterBindings,
  };
}

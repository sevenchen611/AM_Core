// AM Platform core — Portal 授權(給 web routes 用)
//
// 1. PIN 登入改為「租戶範圍 cookie」：登入工程租戶不會順便取得其他租戶資料。
// 2. AM Portal SSO：驗 hozo_session → rental /api/me，再依租戶 feature/project 授權。
// 3. 遷移期可由 tenant.config.portal 宣告舊 feature/project/cookie 名稱；僅做相容，不成為新主鍵。

import crypto from 'node:crypto';

const safeKey = (tenant) => String(tenant?.key || 'platform').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
const portalConfig = (tenant) => tenant?.config?.portal || {};
const list = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x) : []);

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    cookies[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return cookies;
}

function featureRoots(tenant) {
  return [...new Set([`am-${tenant.key}`, ...list(portalConfig(tenant).featureAliases)])];
}

function projectKeys(tenant) {
  return [...new Set([tenant.key, ...list(portalConfig(tenant).projectAliases)])];
}

export function createPortal({
  queueAccessKey,
  portalPin,
  meEndpoint = 'https://rental.hozorental.com/api/me',
  handoffEndpoint = 'https://rental.hozorental.com/api/am-sso/consume',
  logger = console,
}) {
  const meCache = new Map();

  const tenantSecret = (tenant) => tenant?.queueAccessKey || queueAccessKey || '';
  const tenantPin = (tenant) => tenant?.portalPin || portalPin || '';
  const legacyCookieValue = (tenant) => crypto.createHmac('sha256', tenantSecret(tenant)).update('portal-v1').digest('hex');

  function pinCookieName(tenant) {
    return tenant ? `amcore_auth_${safeKey(tenant)}` : 'amcore_auth';
  }

  function pinCookieValue(tenant) {
    const secret = tenantSecret(tenant);
    const payload = tenant ? `portal-v2:${tenant.key}` : 'portal-v1';
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  function pinCookieHeader(tenant) {
    return `${pinCookieName(tenant)}=${pinCookieValue(tenant)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
  }

  function ssoCookieValue(user) {
    if (!queueAccessKey || !user) return '';
    const safeUser = {
      id: String(user.id || ''), username: String(user.username || ''), displayName: String(user.displayName || user.username || ''),
      role: String(user.role || ''), projectIds: Array.isArray(user.projectIds) ? user.projectIds : [],
      allowedFeatures: Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [], active: user.active !== false,
    };
    const payload = Buffer.from(JSON.stringify(safeUser)).toString('base64url');
    const signature = crypto.createHmac('sha256', queueAccessKey).update(`portal-sso-v1:${payload}`).digest('base64url');
    return `${payload}.${signature}`;
  }

  function ssoCookieHeader(user) {
    const value = ssoCookieValue(user);
    if (!value) return '';
    return `amcore_portal_sso=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 8}`;
  }

  function ssoAuthed(req) {
    if (!queueAccessKey) return null;
    const value = parseCookies(req).amcore_portal_sso || '';
    const [payload, signature] = value.split('.');
    if (!payload || !signature) return null;
    const expected = crypto.createHmac('sha256', queueAccessKey).update(`portal-sso-v1:${payload}`).digest('base64url');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return user?.active === false || !user?.id ? null : user;
    } catch {
      return null;
    }
  }

  function pinAuthed(req, tenant = null) {
    const secret = tenantSecret(tenant);
    if (!secret) return false;
    const cookies = parseCookies(req);
    if (cookies[pinCookieName(tenant)] === pinCookieValue(tenant)) return true;

    if (!tenant) return false;
    const cfg = portalConfig(tenant);
    // 舊 AM Platform 全域 cookie 只在租戶明確允許時接受，避免跨租戶放大權限。
    if (cfg.acceptLegacyGlobalPinCookie && cookies.amcore_auth === legacyCookieValue(tenant)) return true;
    // 工程租戶切換時承接原服務 cookie；值仍需通過相同 HMAC 金鑰驗證。
    return list(cfg.legacyPinCookies).some((name) => cookies[name] === legacyCookieValue(tenant));
  }

  function checkPin(pin, tenant = null) {
    return Boolean(tenantPin(tenant)) && pin === tenantPin(tenant);
  }

  // 驗 hozo_session → 回傳 user 物件(未登入/無效回 null)。租戶授權另由 tenantAuthorized 判斷。
  async function userAuthed(req) {
    const match = String(req?.headers?.cookie || '').match(/hozo_session=([^;]+)/);
    if (!match) return ssoAuthed(req);
    const sessionKey = match[1];
    const cached = meCache.get(sessionKey);
    if (cached && Date.now() < cached.exp) return cached.user;
    try {
      const response = await fetch(meEndpoint, { headers: { cookie: `hozo_session=${sessionKey}` } });
      if (!response.ok) return null;
      const user = (await response.json()).user;
      if (!user || user.active === false) return null;
      meCache.set(sessionKey, { user, exp: Date.now() + 5 * 60 * 1000 });
      return user;
    } catch (error) {
      logger.warn(`Portal /api/me failed: ${error.message}`);
      return null;
    }
  }

  async function consumeHandoff(token, tenant) {
    if (!token || !tenant?.key) return null;
    try {
      const response = await fetch(handoffEndpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, tenant: tenant.key }),
      });
      if (!response.ok) return null;
      const result = await response.json();
      const user = result?.user;
      return user && tenantAuthorized(user, tenant) ? user : null;
    } catch (error) {
      logger.warn(`Portal SSO handoff failed: ${error.message}`);
      return null;
    }
  }

  function tenantAuthorized(user, tenant) {
    if (!user || !tenant) return false;
    if (user.role === 'owner') return true;
    const features = Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [];
    const projects = Array.isArray(user.projectIds) ? user.projectIds : [];
    return featureRoots(tenant).some((key) => features.includes(key))
      || projectKeys(tenant).some((key) => projects.includes(key));
  }

  // null = 全部；'none' = 無專案；其餘為逗號分隔館別代碼。
  function tenantScope(user, tenant) {
    if (!user || user.role === 'owner') return null;
    const features = Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [];
    const codes = new Set();
    for (const root of featureRoots(tenant)) {
      const prefix = `${root}-`;
      for (const feature of features) {
        if (!feature.startsWith(prefix)) continue;
        const suffix = feature.slice(prefix.length);
        if (suffix && !['budget', 'contract'].includes(suffix.toLowerCase())) codes.add(suffix.toUpperCase());
      }
    }
    return [...codes].join(',') || 'none';
  }

  function featureGranted(user, tenant, suffix) {
    if (!user || !tenant) return false;
    if (user.role === 'owner') return true;
    const features = Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [];
    return featureRoots(tenant).some((root) => features.includes(`${root}-${suffix}`));
  }

  return {
    pinCookieName,
    pinCookieValue,
    pinCookieHeader,
    ssoCookieHeader,
    pinAuthed,
    checkPin,
    userAuthed,
    consumeHandoff,
    tenantAuthorized,
    tenantScope,
    featureGranted,
    pinConfigured: Boolean(portalPin),
  };
}

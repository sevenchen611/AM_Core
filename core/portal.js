// AM Platform core — Portal SSO、緊急登入與租戶 / 對話群組授權。

import crypto from 'node:crypto';
import { createAccessContext, normalizeAuthzMode } from './access.js';

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

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createPortal({
  queueAccessKey,
  portalPin,
  meEndpoint = 'https://rental.hozorental.com/api/me',
  handoffEndpoint = 'https://rental.hozorental.com/api/am-sso/consume',
  verifyEndpoint = 'https://rental.hozorental.com/api/am-sso/verify',
  portalServiceToken = '',
  groupAuthzMode = 'shadow',
  emergencyPinEnabled = false,
  emergencyPinTtlSeconds = 15 * 60,
  logger = console,
}) {
  const authzMode = normalizeAuthzMode(groupAuthzMode);
  const emergencyTtl = Math.min(15 * 60, Math.max(60, Number(emergencyPinTtlSeconds) || 15 * 60));
  const tenantSecret = (tenant) => tenant?.queueAccessKey || queueAccessKey || '';
  const tenantPin = (tenant) => tenant?.portalPin || portalPin || '';

  function legacyTenantAuthorized(user, tenant) {
    if (!user || !tenant) return false;
    if (user.role === 'owner') return true;
    const features = Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [];
    const projects = Array.isArray(user.projectIds) ? user.projectIds : [];
    return featureRoots(tenant).some((key) => features.includes(key))
      || projectKeys(tenant).some((key) => projects.includes(key));
  }

  function accessForUser(user, tenant, principal = 'portal') {
    return createAccessContext({
      user,
      tenant,
      authzMode,
      legacyAllowed: legacyTenantAuthorized(user, tenant),
      principal,
      logger,
    });
  }

  function pinCookieName(tenant) {
    return tenant ? `amcore_emergency_${safeKey(tenant)}` : 'amcore_emergency';
  }

  function pinCookieValue(tenant, expiresAt = Math.floor(Date.now() / 1000) + emergencyTtl) {
    const secret = tenantSecret(tenant);
    if (!secret) return '';
    const exp = Math.floor(Number(expiresAt));
    const signature = crypto.createHmac('sha256', secret)
      .update(`emergency-owner-v1:${tenant?.key || 'platform'}:${exp}`)
      .digest('base64url');
    return `${exp}.${signature}`;
  }

  function pinCookieHeader(tenant) {
    const value = pinCookieValue(tenant);
    return `${pinCookieName(tenant)}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${emergencyTtl}`;
  }

  function pinAuthed(req, tenant = null) {
    if (!emergencyPinEnabled || !tenantSecret(tenant)) return false;
    const value = parseCookies(req)[pinCookieName(tenant)] || '';
    const [rawExp, signature] = value.split('.');
    const exp = Number(rawExp);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000) || exp > Math.floor(Date.now() / 1000) + emergencyTtl) return false;
    const expected = pinCookieValue(tenant, exp).split('.')[1] || '';
    return timingSafeTextEqual(signature, expected);
  }

  function checkPin(pin, tenant = null) {
    return emergencyPinEnabled && Boolean(tenantPin(tenant)) && timingSafeTextEqual(pin, tenantPin(tenant));
  }

  function signSsoPayload(prefix, payload) {
    return crypto.createHmac('sha256', queueAccessKey || '').update(`${prefix}:${payload}`).digest('base64url');
  }

  function ssoCookieValue(value) {
    if (!queueAccessKey || !value) return '';
    const sessionToken = typeof value === 'string' ? value : value.sessionToken;
    if (!sessionToken) return '';
    const payload = Buffer.from(String(sessionToken)).toString('base64url');
    return `v2.${payload}.${signSsoPayload('portal-sso-v2', payload)}`;
  }

  function ssoCookieHeader(value) {
    const cookie = ssoCookieValue(value);
    if (!cookie) return '';
    return `amcore_portal_sso=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 8}`;
  }

  function readSignedSsoCookie(req) {
    if (!queueAccessKey) return null;
    const value = parseCookies(req).amcore_portal_sso || '';
    const [version, payload, signature] = value.split('.');
    if (!version || !payload || !signature) return null;
    const prefix = version === 'v2' ? 'portal-sso-v2' : '';
    if (!prefix || !timingSafeTextEqual(signature, signSsoPayload(prefix, payload))) return null;
    try {
      return { version, sessionToken: Buffer.from(payload, 'base64url').toString('utf8') };
    } catch {
      return null;
    }
  }

  async function verifyPortalSession(sessionToken, tenantKey = '') {
    if (!sessionToken || !portalServiceToken) return null;
    try {
      const response = await fetch(verifyEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-am-platform-token': portalServiceToken },
        body: JSON.stringify({ sessionToken, tenant: tenantKey || undefined }),
      });
      if (!response.ok) return null;
      const user = (await response.json())?.user;
      return user && user.active !== false ? user : null;
    } catch (error) {
      logger.warn(`Portal SSO verify failed: ${error.message}`);
      return null;
    }
  }

  // 每次請求重新向 Portal 取得目前帳號；不跨請求快取權限，撤權立即生效。
  async function userAuthed(req, tenant = null) {
    const direct = String(req?.headers?.cookie || '').match(/hozo_session=([^;]+)/);
    if (direct) {
      try {
        const response = await fetch(meEndpoint, { headers: { cookie: `hozo_session=${direct[1]}`, 'cache-control': 'no-store' } });
        if (!response.ok) return null;
        const user = (await response.json())?.user;
        return user && user.active !== false ? user : null;
      } catch (error) {
        logger.warn(`Portal /api/me failed: ${error.message}`);
        return null;
      }
    }
    const signed = readSignedSsoCookie(req);
    if (!signed) return null;
    return verifyPortalSession(signed.sessionToken, tenant?.key || '');
  }

  async function consumeHandoff(token, tenant) {
    if (!token || !tenant?.key) return null;
    try {
      const response = await fetch(handoffEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(portalServiceToken ? { 'x-am-platform-token': portalServiceToken } : {}),
        },
        body: JSON.stringify({ token, tenant: tenant.key }),
      });
      if (!response.ok) return null;
      const result = await response.json();
      const user = result?.user;
      if (!user || !accessForUser(user, tenant).allowed) return null;
      if (!result.sessionToken) return null;
      return { user, sessionToken: String(result.sessionToken || '') };
    } catch (error) {
      logger.warn(`Portal SSO handoff failed: ${error.message}`);
      return null;
    }
  }

  function tenantAuthorized(user, tenant) {
    return accessForUser(user, tenant).allowed;
  }

  async function resolveAccess(req, tenant) {
    if (pinAuthed(req, tenant)) {
      const emergencyUser = { id: 'emergency-owner', username: 'emergency-owner', displayName: '緊急最高管理者', role: 'owner', active: true };
      return accessForUser(emergencyUser, tenant, 'emergency-owner');
    }
    const user = await userAuthed(req, tenant);
    return accessForUser(user, tenant);
  }

  // 舊工程專案範圍仍服務 budget / contracts；群組權限不再由 suffix 推導。
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
    authzMode,
    pinCookieName,
    pinCookieValue,
    pinCookieHeader,
    ssoCookieHeader,
    pinAuthed,
    checkPin,
    userAuthed,
    consumeHandoff,
    verifyPortalSession,
    tenantAuthorized,
    resolveAccess,
    accessForUser,
    tenantScope,
    featureGranted,
    pinConfigured: Boolean(emergencyPinEnabled && portalPin),
    portalServiceConfigured: Boolean(portalServiceToken),
  };
}

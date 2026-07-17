// Core↔Portal opaque session / live authorization dry-run（無網路、無正式帳號）。
import assert from 'node:assert/strict';
import { createPortal } from '../core/portal.js';

const tenant = { key: 'forest', config: { portal: { featureAliases: ['am-forest'] } } };
const GROUP_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let currentUser = {
  id: 'u1', username: 'tony', displayName: 'Tony', role: 'user', active: true, authzVersion: 3,
  amAccess: { forest: { mode: 'selected', groupBindingIds: [GROUP_A] } },
  allowedFeatures: ['am-forest'],
};
let verifyCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  verifyCalls += 1;
  assert.equal(options.headers['x-am-platform-token'], 'portal-service-secret');
  return new Response(JSON.stringify({ user: currentUser }), {
    status: currentUser ? 200 : 403,
    headers: { 'content-type': 'application/json' },
  });
};

try {
  const portal = createPortal({
    queueAccessKey: 'core-cookie-signing-secret',
    portalServiceToken: 'portal-service-secret',
    verifyEndpoint: 'https://portal.invalid/api/am-sso/verify',
    groupAuthzMode: 'enforce',
    emergencyPinEnabled: false,
    portalPin: 'should-not-work',
    logger: { warn() {} },
  });
  const header = portal.ssoCookieHeader({ sessionToken: 'opaque-session-handle' });
  assert.match(header, /amcore_portal_sso=v2\./);
  assert.doesNotMatch(header, /tony|forest|groupBindingIds|aaaaaaaa/);
  const cookie = header.split(';')[0];
  const req = { headers: { cookie } };

  const first = await portal.resolveAccess(req, tenant);
  assert.equal(first.allowed, true);
  assert.equal(first.can('tasks.read', GROUP_A, { status: '啟用' }), true);

  currentUser = { ...currentUser, authzVersion: 4, amAccess: {}, allowedFeatures: [] };
  const revoked = await portal.resolveAccess(req, tenant);
  assert.equal(revoked.allowed, false);
  assert.equal(verifyCalls, 2, '每次後臺請求都必須重新驗證，不得跨請求快取');

  currentUser = { ...currentUser, active: false, authzVersion: 5 };
  const disabled = await portal.resolveAccess(req, tenant);
  assert.equal(disabled.allowed, false);
  assert.equal(verifyCalls, 3);

  assert.equal(portal.checkPin('should-not-work', tenant), false, '日常 PIN 預設關閉');
  assert.equal(portal.pinConfigured, false);

  console.log('✅ opaque cookie 不含帳號或權限內容');
  console.log('✅ 每次請求 live verify；撤權與停用下一次立即生效');
  console.log('✅ 日常 PIN 預設關閉');
} finally {
  globalThis.fetch = originalFetch;
}

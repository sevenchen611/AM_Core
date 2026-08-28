import assert from 'node:assert/strict';
import { createLine } from '../core/line.js';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url).includes('/oauth2/v2.1/verify')) {
    return new Response(JSON.stringify({ client_id: '12345', expires_in: 3600, scope: 'profile openid' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  if (String(url).endsWith('/v2/profile')) {
    return new Response(JSON.stringify({ userId: 'U12345678901234567890', displayName: '王先生' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error(`unexpected fetch ${url}`);
};

try {
  const line = createLine({ channelAccessToken: 'channel-token', channelSecret: 'channel-secret' });
  const identity = await line.verifyLiffIdentity('liff-access-token', '12345-contracts');
  assert.equal(identity.userId, 'U12345678901234567890');
  assert.match(calls[0].url, /access_token=liff-access-token/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer liff-access-token');
  await assert.rejects(() => line.verifyLiffIdentity('other-token', '99999-contracts'), /another channel/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Engineering contract LIFF dry-run passed: access-token verification, channel binding, and profile lookup verified.');

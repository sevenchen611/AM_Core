import assert from 'node:assert/strict';
import { createLine } from '../core/line.js';

const originalFetch = globalThis.fetch;
const logs = [];
const logger = {
  info: (message) => logs.push(String(message)),
  warn: (message) => logs.push(String(message)),
};

try {
  let capturedOptions = null;
  globalThis.fetch = async (_url, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'x-line-request-id' ? 'req-123' : null },
      text: async () => JSON.stringify({ sentMessages: [{ id: 'msg-123' }] }),
    };
  };
  const line = createLine({ channelAccessToken: 'test-token', channelSecret: 'test-secret', logger, pushTimeoutMs: 50 });
  const receipt = await line.pushLineMessage('C_TEST', 'hello', undefined, { retryKey: '11111111-1111-4111-8111-111111111111' });
  assert.equal(capturedOptions.headers['X-Line-Retry-Key'], '11111111-1111-4111-8111-111111111111');
  assert.equal(receipt.requestId, 'req-123');
  assert.deepEqual(receipt.messageIds, ['msg-123']);
  assert.ok(logs.some((line) => line.includes('requestId=req-123') && line.includes('messageIds=msg-123')));

  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const timedLine = createLine({ channelAccessToken: 'test-token', channelSecret: 'test-secret', logger, pushTimeoutMs: 20 });
  await assert.rejects(
    () => timedLine.pushLineMessage('C_TEST', 'hello'),
    (error) => error?.code === 'LINE_PUSH_TIMEOUT' && /20ms/.test(error.message),
  );

  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    headers: { get: (name) => name.toLowerCase() === 'x-line-accepted-request-id' ? 'accepted-123' : null },
    text: async () => '{}',
  });
  const replayed = await line.pushLineMessage('C_TEST', 'hello', undefined, { retryKey: '11111111-1111-4111-8111-111111111111' });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.acceptedRequestId, 'accepted-123');

  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    headers: { get: () => null },
    text: async () => '{}',
  });
  await assert.rejects(
    () => line.pushLineMessage('C_TEST', 'hello'),
    (error) => error?.code === 'LINE_PUSH_FAILED' && error?.lineStatus === 409,
  );

  console.log('LINE push verification passed: timeout abort, retry key, request/message IDs, and accepted replay are working.');
} finally {
  globalThis.fetch = originalFetch;
}

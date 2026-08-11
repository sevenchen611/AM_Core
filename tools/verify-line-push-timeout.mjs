import assert from 'node:assert/strict';
import { createLine, normalizeLineRetryKey } from '../core/line.js';

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

  await line.pushLineMessage('C_TEST', 'result text', undefined, {
    retryKey: 'bank-draft-images',
    additionalMessages: [{
      type: 'image',
      originalContentUrl: 'https://rental.hozorental.com/screenshot.png',
      previewImageUrl: 'https://rental.hozorental.com/screenshot.png',
    }],
  });
  const mixedMessages = JSON.parse(capturedOptions.body).messages;
  assert.equal(mixedMessages.length, 2);
  assert.equal(mixedMessages[0].type, 'text');
  assert.equal(mixedMessages[1].type, 'image');

  await line.pushLineMessage('C_TEST', { type: 'flex', altText: '請款申請', contents: { type: 'bubble' } }, undefined, { retryKey: 'claim-button-flex' });
  const flexPushMessage = JSON.parse(capturedOptions.body).messages[0];
  assert.equal(flexPushMessage.type, 'flex');
  assert.equal(flexPushMessage.altText, '請款申請');

  await line.replyLineMessage('reply-token', { type: 'flex', altText: '請款申請', contents: { type: 'bubble' } });
  const flexReplyMessage = JSON.parse(capturedOptions.body).messages[0];
  assert.equal(flexReplyMessage.type, 'flex');
  assert.equal(flexReplyMessage.altText, '請款申請');

  const derivedRetryKey = normalizeLineRetryKey('amc_hozo-am-2-0_submission');
  assert.match(derivedRetryKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(derivedRetryKey, normalizeLineRetryKey('amc_hozo-am-2-0_submission'));
  const derivedReceipt = await line.pushLineMessage('C_TEST', 'hello', undefined, { retryKey: 'amc_hozo-am-2-0_submission' });
  assert.equal(capturedOptions.headers['X-Line-Retry-Key'], derivedRetryKey);
  assert.equal(derivedReceipt.retryKey, derivedRetryKey);

  await line.pushLineMessage('C_TEST', 'Maggie，新請款已送出，待您核准', {
    name: 'Maggie', userId: 'U480627aaad7650bdd40117714fa69bc1',
  }, { retryKey: 'claim-reviewer-mention' });
  const mentionMessage = JSON.parse(capturedOptions.body).messages[0];
  assert.equal(mentionMessage.type, 'textV2');
  assert.match(mentionMessage.text, /^\{who\}，新請款已送出/);
  assert.deepEqual(mentionMessage.substitution.who, {
    type: 'mention', mentionee: { type: 'user', userId: 'U480627aaad7650bdd40117714fa69bc1' },
  });

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

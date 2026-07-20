import assert from 'node:assert/strict';
import meetings, { __test } from '../modules/meetings/index.js';

const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(
    () => __test.lineProfileFromAccessToken('test-token', { timeoutMs: 20 }),
    (error) => error?.code === 'LINE_PROFILE_TIMEOUT' && error?.statusCode === 504,
  );

  const session = {
    memberMap: {},
    binding: { pageId: 'binding-page', members: {} },
  };
  meetings.init({ notionRequest: async () => new Promise(() => {}) });
  const startedAt = Date.now();
  const result = await __test.ensureSessionMemberBestEffort(session, 'Seven', 'U_TEST', 20);
  assert.equal(result, false, 'slow member persistence must not block the host action');
  assert.ok(Date.now() - startedAt < 500, 'member persistence timeout should return promptly');
  assert.equal(session.memberMap.Seven, 'U_TEST', 'in-memory member identity should still be available');

  console.log('Meeting review network timeout verification passed: LINE identity and member persistence cannot hang the host action.');
} finally {
  globalThis.fetch = originalFetch;
}

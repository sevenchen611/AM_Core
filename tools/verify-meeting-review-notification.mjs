import assert from 'node:assert/strict';
import meetings, { __test } from '../modules/meetings/index.js';

function makeSession() {
  return {
    id: 'b'.repeat(20),
    status: 'awaiting_host_choice',
    groupId: 'C_TEST_GROUP',
    tenant: { config: { meetings: { liffId: '2010757652-jdUzj6hG' } } },
  };
}

let calls = 0;
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async () => {
    calls += 1;
    if (calls < 3) throw new Error(`temporary LINE error ${calls}`);
  },
});

const recovered = makeSession();
await __test.beginMeetingReview(recovered, { attempts: 3, delayMs: 0 });
assert.equal(calls, 3, 'LINE notification should retry transient failures');
assert.equal(recovered.status, 'reviewing', 'review should open only after the group notification succeeds');

calls = 0;
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async () => {
    calls += 1;
    throw new Error('LINE unavailable');
  },
});

const failed = makeSession();
await assert.rejects(
  () => __test.beginMeetingReview(failed, { attempts: 3, delayMs: 0 }),
  (error) => error?.statusCode === 502 && /請稍後再按一次/.test(error.message),
);
assert.equal(calls, 3, 'LINE notification should stop after the configured retry count');
assert.equal(failed.status, 'awaiting_host_choice', 'failed notification must restore a retryable host-choice state');

console.log('Meeting review notification verification passed: retry, success gating, and rollback are working.');

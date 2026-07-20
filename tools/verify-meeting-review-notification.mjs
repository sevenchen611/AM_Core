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
const retryKeys = [];
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async (_to, _text, _mention, delivery) => {
    calls += 1;
    retryKeys.push(delivery?.retryKey || '');
    if (calls < 3) throw new Error(`temporary LINE error ${calls}`);
    return { status: 200, requestId: 'req-test', messageIds: ['msg-test'] };
  },
});

const recovered = makeSession();
await __test.beginMeetingReview(recovered, { attempts: 3, delayMs: 0 });
assert.equal(calls, 3, 'LINE notification should retry transient failures');
assert.equal(new Set(retryKeys).size, 1, 'all retries must reuse one LINE retry key');
assert.ok(retryKeys[0], 'LINE retry key must be present');
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

const failedKey = failed.notificationRetryKeys['review-opened'];
let recoveredKey = '';
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async (_to, _text, _mention, delivery) => {
    recoveredKey = delivery?.retryKey || '';
    return { status: 409, acceptedRequestId: 'accepted-test', replayed: true };
  },
});
await __test.beginMeetingReview(failed, { attempts: 1, delayMs: 0 });
assert.equal(recoveredKey, failedKey, 'a new host click must reuse the prior retry key after an ambiguous failure');
assert.equal(failed.status, 'reviewing', 'an already-accepted LINE request should safely complete the review opening');

const ambiguousDeliveries = [];
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async (to, text, _mention, delivery) => {
    ambiguousDeliveries.push({ to, text, retryKey: delivery?.retryKey || '' });
    if (ambiguousDeliveries.length === 1) {
      throw Object.assign(new Error('response timed out after LINE may have accepted it'), { code: 'LINE_PUSH_TIMEOUT' });
    }
    return { status: 409, acceptedRequestId: 'accepted-after-timeout', replayed: true };
  },
});
const ambiguous = makeSession();
await __test.beginMeetingReview(ambiguous, { attempts: 2, delayMs: 0 });
assert.equal(ambiguousDeliveries.length, 2);
assert.deepEqual(ambiguousDeliveries[1], ambiguousDeliveries[0], 'an ambiguous retry must keep recipient, content, and retry key identical');
assert.equal(ambiguous.status, 'reviewing');

let permanentCalls = 0;
meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  pushLineMessage: async () => {
    permanentCalls += 1;
    throw Object.assign(new Error('bad recipient'), { code: 'LINE_PUSH_FAILED', lineStatus: 400 });
  },
});
const permanentFailure = makeSession();
await assert.rejects(() => __test.beginMeetingReview(permanentFailure, { attempts: 3, delayMs: 0 }), /請稍後再按一次/);
assert.equal(permanentCalls, 1, 'permanent LINE 4xx errors must not be retried');
assert.equal(permanentFailure.status, 'awaiting_host_choice');

console.log('Meeting review notification verification passed: retry, success gating, and rollback are working.');

import assert from 'node:assert/strict';
import vm from 'node:vm';
import meetings, { __test } from '../modules/meetings/index.js';

meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  publicBaseUrl: 'https://example.test',
});

const todo = {
  id: 'todo-1',
  content: '完成測試',
  owner: 'Seven',
  due: '2026-07-21',
  ownerConfirmed: false,
  ownerConfirmedBy: '',
  ownerConfirmedAt: '',
  version: 1,
};

const session = {
  id: 'a'.repeat(20),
  status: 'awaiting_host_choice',
  hostName: 'Seven',
  hostUserId: 'U_TEST_HOST',
  meetingUrl: 'https://example.test/meeting',
  publicUrl: 'https://example.test/m/meeting',
  tenant: { config: { meetings: { liffId: '123456-test' } } },
  memberMap: { Seven: 'U_TEST_HOST' },
  todos: [todo],
};

const html = __test.renderReviewHtml(session);
const sdkTag = '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>';
assert.ok(html.includes(`${sdkTag}<script>`), 'LIFF SDK must be closed before the meeting-review client script starts');
assert.ok(!html.includes('<\\/script>'), 'HTML must not contain an escaped script closing tag');

const inlineStart = html.indexOf('<script>', html.indexOf(sdkTag) + sdkTag.length);
const inlineEnd = html.indexOf('</script>', inlineStart);
assert.ok(inlineStart >= 0 && inlineEnd > inlineStart, 'meeting-review client script must be extractable');
const clientScript = html.slice(inlineStart + '<script>'.length, inlineEnd);
new vm.Script(clientScript, { filename: 'meeting-review-client.js' });

const elements = {
  statusText: { textContent: '' },
  authText: { textContent: '' },
  errorBox: { textContent: '', style: {} },
  summary: { innerHTML: '' },
  hostChoice: { style: {} },
  finalize: { disabled: false },
  tasks: { innerHTML: '' },
  toast: { textContent: '', style: {} },
};
let clickHandler = null;
const fetchCalls = [];
const context = {
  console,
  AbortController,
  setTimeout: () => 0,
  clearTimeout: () => {},
  document: {
    getElementById: (id) => elements[id],
    querySelectorAll: () => [],
    addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler; },
  },
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    fetchCalls.push({ url, body });
    const status = body.action === 'start'
      ? 'reviewing'
      : body.action === 'complete'
        ? 'completed_without_review'
        : body.action === 'finalize'
          ? 'finalized'
          : 'awaiting_host_choice';
    return {
      ok: true,
      json: async () => ({
        session: {
          status,
          members: ['Seven'],
          todos: [todo],
          summary: { total: 1, requiredReady: 1, confirmed: 0, allReady: true, allConfirmed: false },
        },
      }),
    };
  },
};
context.liff = {
  init: async () => {},
  isLoggedIn: () => true,
  getProfile: async () => ({ userId: 'U_TEST_HOST', displayName: 'Seven' }),
  getAccessToken: () => 'test-access-token',
};
context.window = { liff: context.liff };

new vm.Script(clientScript, { filename: 'meeting-review-client.js' }).runInNewContext(context);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(typeof clickHandler, 'function', 'meeting-review click handler must be registered');
assert.equal(fetchCalls[0]?.body?.action, 'identify', 'LIFF identity must be verified after initialization');

const startButton = {
  dataset: { action: 'start' },
  id: '',
  closest: (selector) => (selector === 'button' ? startButton : null),
};
await clickHandler({ target: startButton });

const startCall = fetchCalls.find((call) => call.body.action === 'start');
assert.ok(startCall, 'start button must send a POST action');
assert.match(startCall.url, /^\/meetings\/review\/[a-f0-9]{20}-[a-f0-9]{16}$/);
assert.equal(startCall.body.actorUserId, 'U_TEST_HOST');
assert.equal(startCall.body.liffAccessToken, 'test-access-token');
assert.equal(elements.statusText.textContent, '等待負責人確認');

const completeButton = {
  dataset: { action: 'complete' },
  id: '',
  closest: (selector) => (selector === 'button' ? completeButton : null),
};
await clickHandler({ target: completeButton });
assert.ok(fetchCalls.find((call) => call.body.action === 'complete'), 'complete button must send a POST action');

const finalizeButton = {
  dataset: {},
  id: 'finalize',
  closest: (selector) => (selector === 'button' ? finalizeButton : null),
};
await clickHandler({ target: finalizeButton });
assert.ok(fetchCalls.find((call) => call.body.action === 'finalize'), 'finalize button must send a POST action');

console.log('Meeting review client verification passed: LIFF script and all three host actions use the signed POST path and update state.');

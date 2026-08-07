import assert from 'node:assert/strict';
import personalAssistant from '../modules/personal-assistant/index.js';
import { parseBindingCommand, isRevokeBindingCommand } from '../modules/personal-assistant/index.js';

assert.deepEqual(parseBindingCommand('綁定 123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁定：123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁定碼 123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁定　１２３４５６'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁\u200B定 123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁訂 123456'), { code: '123456' });
assert.deepEqual(parseBindingCommand('綁 定 123456。'), { code: '123456' });
assert.equal(parseBindingCommand('綁定 12345'), null);
assert.equal(parseBindingCommand('綁定 1234567'), null);
assert.equal(parseBindingCommand('123456 78'), null);
assert.equal(isRevokeBindingCommand('撤銷綁定'), true);

const replies = [];
const calls = [];
personalAssistant.init({
  calendarIntegrationConfigured: true,
  calendarBindingConsume: async (payload) => {
    calls.push(payload);
    return { ok: true, status: 200, displayName: 'Seven 陳聖文', personId: 'person-1' };
  },
  replyLineMessage: async (_token, message) => replies.push(message),
});

const handled = await personalAssistant.onDirectMessage({
  tenant: { key: 'hozo-am-2-0', displayName: 'HOZO AM 2.0', config: { personalAssistant: { enabled: true } } },
  directUserId: 'U-test-line-user',
  text: '綁定 123456',
  event: { replyToken: 'reply-token', webhookEventId: 'event-1' },
  message: { id: 'message-1' },
  personalBinding: { displayName: 'Seven' },
});

assert.equal(handled, true);
assert.deepEqual(calls, [{
  tenantKey: 'hozo-am-2-0',
  code: '123456',
  lineUserId: 'U-test-line-user',
  idempotencyKey: 'line-binding:event-1',
}]);
assert.match(replies[0], /已綁定到 HOZO Rental 帳號/);

console.log('Personal Calendar binding dry-run passed: command parsing, machine payload and safe reply.');

import assert from 'node:assert/strict';
import calendar, { dateAtOffset, parseCreateCommand, parseItemAction } from '../modules/calendar/index.js';
import { isCalendarCommand } from '../modules/calendar/commands.js';
import { isDelegatedCommand } from '../modules/personal-assistant/index.js';

assert.equal(isCalendarCommand('我的今天'), true);
assert.equal(isCalendarCommand('新增工作 明天 10:00 回覆房東'), true);
assert.equal(isDelegatedCommand('我的今天'), true);
assert.equal(parseCreateCommand('新增工作 明天 10:00 回覆房東').title, '回覆房東');
assert.equal(parseCreateCommand('新增工作 沒有日期').error.length > 0, true);
assert.deepEqual(parseItemAction('完成 2'), { action: 'complete', number: 2 });
assert.equal(parseItemAction('延到明天 1').scheduledDate, dateAtOffset(1));

const replies = [];
const queries = [];
const creates = [];
const updates = [];
let queryItems = [{
  id: 'personal-1', title: '整理本週工作', scheduledDate: dateAtOffset(0), startAt: '',
  status: 'planned', sourceSystem: 'line', actionPolicy: 'personal_edit',
}];

calendar.init({
  calendarIntegrationConfigured: true,
  replyLineMessage: async (_token, message) => replies.push(message),
  calendarPersonalQuery: async (payload) => { queries.push(payload); return { ok: true, items: queryItems }; },
  calendarPersonalCreate: async (payload) => {
    creates.push(payload);
    return { ok: true, item: { id: 'personal-2', ...payload.item } };
  },
  calendarPersonalUpdate: async (payload) => {
    updates.push(payload);
    return { ok: true, item: { id: payload.update.itemId, status: payload.update.action } };
  },
});

function ctx(text, eventId) {
  return {
    tenant: { key: 'hozo-am-2-0', config: { personalAssistant: { enabled: true } } },
    directUserId: 'U-seven',
    text,
    event: { replyToken: `reply-${eventId}`, webhookEventId: eventId },
    message: { id: `message-${eventId}` },
  };
}

assert.equal(await calendar.onDirectMessage(ctx('我的今天', 'query-1')), true);
assert.equal(queries.length, 1);
assert.match(replies.at(-1), /整理本週工作/);

assert.equal(await calendar.onDirectMessage(ctx('完成 1', 'complete-1')), true);
assert.equal(updates[0].update.itemId, 'personal-1');
assert.equal(updates[0].update.action, 'complete');

assert.equal(await calendar.onDirectMessage(ctx('新增工作 明天 10:00 回覆房東', 'create-1')), true);
assert.equal(creates.length, 0);
assert.match(replies.at(-1), /確認新增/);
assert.equal(await calendar.onDirectMessage(ctx('確認新增', 'confirm-1')), true);
assert.equal(creates.length, 1);
assert.equal(creates[0].item.title, '回覆房東');
assert.equal(creates[0].item.scheduledDate, dateAtOffset(1));

queryItems = [{
  id: 'am-1', title: 'AM 來源工作', scheduledDate: dateAtOffset(0), startAt: '',
  status: 'planned', sourceSystem: 'am-platform', actionPolicy: 'view_only',
}];
assert.equal(await calendar.onDirectMessage(ctx('我的今天', 'query-2')), true);
assert.equal(await calendar.onDirectMessage(ctx('取消 1', 'cancel-am-1')), true);
assert.equal(updates.length, 1);
assert.match(replies.at(-1), /只能查看/);

console.log('Calendar LINE operations dry-run passed: query, numbered actions, confirmed create and source read-only guard.');

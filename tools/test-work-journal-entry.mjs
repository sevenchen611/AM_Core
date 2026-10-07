import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkJournalEntry, isWorkJournalEvent, workJournalAction } from '../core/work-journal-entry.js';

const userId = 'U' + '1'.repeat(32), menuId = 'richmenu-' + 'a'.repeat(32);
const event = text => ({ type: 'message', source: { type: 'user', userId }, message: { type: 'text', text }, replyToken: 'fixture-reply' });
const menu = uri => ({ areas: [{ action: { type: 'uri', label: '工作日誌', uri } }, { action: { type: 'message', label: 'UOF 待簽', text: '待簽' } }] });
const uri = 'https://journal.example.com/?openExternalBrowser=1#today';
const missing = () => Object.assign(Error('missing'), { lineStatus: 404 });
function fixture(read) {
  const requests = [], replies = [];
  const entry = createWorkJournalEntry({ line: { lineGet: async path => { requests.push(path); return read(path); }, replyLineMessages: async (token, messages) => replies.push({ token, messages }) }, logger: { warn() {} } });
  return { entry, requests, replies };
}
test('only explicit direct-chat commands are navigation, with no task or group capture', () => {
  for (const text of ['工作日誌', ' 開啟工作日誌 ', '\u200B打開工作日誌\uFEFF']) assert(isWorkJournalEvent(event(text)));
  for (const text of ['待辦', '待簽', '新增待辦 明天填工作日誌', '工作日誌今天要補完', '請款', '取消新增', '工作日誌 https://evil.example']) assert(!isWorkJournalEvent(event(text)));
  for (const source of [{ type: 'group', groupId: 'fixture-group', userId }, { type: 'room', roomId: 'fixture-room', userId }, { type: 'user', userId, groupId: 'fixture-group' }, { type: 'user', userId: '' }]) assert(!isWorkJournalEvent({ ...event('工作日誌'), source }));
  assert(!isWorkJournalEvent({ ...event('工作日誌'), type: 'postback' }));
});
test('default and per-user actions preserve exactly the active Rich Menu URL', async () => {
  const f = fixture(path => { if (path.includes(userId)) throw missing(); if (path === '/v2/bot/user/all/richmenu') return { richMenuId: menuId }; return menu(uri); });
  assert(await f.entry.handle(event('工作日誌')));
  const sent = f.replies[0];assert.equal(sent.token, 'fixture-reply');assert.equal(sent.messages[0].template.actions[0].uri, uri);assert.equal(sent.messages[0].template.actions[0].label, '開啟工作日誌');assert.equal(sent.messages[0].type, 'template');
  assert.deepEqual(f.requests, [`/v2/bot/user/${userId}/richmenu`, '/v2/bot/user/all/richmenu', `/v2/bot/richmenu/${menuId}`]);
  const personal = fixture(path => path.includes(userId) ? { richMenuId: menuId } : menu('https://personal.example.com/?openExternalBrowser=1'));
  await personal.entry.handle(event('工作日誌'));assert.equal(personal.replies[0].messages[0].template.actions[0].uri, 'https://personal.example.com/?openExternalBrowser=1');assert(!personal.requests.includes('/v2/bot/user/all/richmenu'));
});
test('rechecks active menu association, coalesces immutable menu reads and adopts a new menu', async () => {
  let id = menuId;const other = 'richmenu-' + 'b'.repeat(32);
  const f = fixture(path => path.includes(userId) ? { richMenuId: id } : menu(path.endsWith(other) ? 'https://new.example.com/?openExternalBrowser=1' : uri));
  await Promise.all([f.entry.handle(event('工作日誌')), f.entry.handle({ ...event('工作日誌'), replyToken: 'fixture-other' })]);assert.equal(f.requests.filter(p => p === `/v2/bot/richmenu/${menuId}`).length, 1);
  id = other;await f.entry.handle(event('工作日誌'));assert.equal(f.replies.at(-1).messages[0].template.actions[0].uri, 'https://new.example.com/?openExternalBrowser=1');
});
test('provider failures and missing/ambiguous journal tiles never guess a destination', async () => {
  for (const read of [() => { throw Error('offline'); }, path => path.includes(userId) ? { richMenuId: menuId } : { areas: [] }, path => path.includes(userId) ? { richMenuId: menuId } : { areas: [...menu(uri).areas, menu(uri).areas[0]] }]) {
    const f = fixture(read);await f.entry.handle(event('工作日誌'));assert.equal(f.replies[0].messages[0].type, 'text');assert(f.replies[0].messages[0].text.includes('目前無法取得'));assert(!JSON.stringify(f.replies).includes('http'));
  }
  const unavailable = fixture(() => { throw Object.assign(Error('forbidden'), { lineStatus: 403 }); });await unavailable.entry.handle(event('工作日誌'));assert(!unavailable.requests.includes('/v2/bot/user/all/richmenu'));
  for (const bad of ['http://journal.example.com/', 'https://user:pass@journal.example.com/', 'javascript:alert(1)', 'https://localhost/']) assert.throws(() => workJournalAction(menu(bad)));
});
test('a failed menu read can recover; unsupported or standby events send nothing', async () => {
  let offline = true;const f = fixture(path => { if (path.includes(userId)) return { richMenuId: menuId }; if (offline) throw Error('offline'); return menu(uri); });
  await f.entry.handle(event('工作日誌'));offline = false;await f.entry.handle(event('工作日誌'));assert.equal(f.replies.at(-1).messages[0].type, 'template');
  const count = f.requests.length;assert.equal(await f.entry.handle(event('待簽')), false);assert(await f.entry.handle({ ...event('工作日誌'), mode: 'standby' }));assert(await f.entry.handle({ ...event('工作日誌'), replyToken: undefined }));assert.equal(f.requests.length, count);assert.equal(f.replies.length, 2);
});

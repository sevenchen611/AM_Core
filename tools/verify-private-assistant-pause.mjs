import assert from 'node:assert/strict';
import * as workJournalEntry from '../core/work-journal-entry.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as directLine from '../core/direct-line.js';
import * as leafCalendar from '../core/leaf-calendar/index.js';

const source = { type: 'user', userId: 'synthetic-private-user' };
const privateEvents = [
  ...['你好', '待簽', '我的身分', '新增待辦 明天回覆', '我的今天', '請款', '請提供這個檔案給我'].map((text, i) => ({
    type: 'message', source, replyToken: `synthetic-${i}`, message: { id: `synthetic-${i}`, type: 'text', text },
  })),
  ...['image', 'file', 'audio', 'video'].map(type => ({ type: 'message', source, message: { type, id: `synthetic-${type}` } })),
  { type: 'postback', source, replyToken: 'synthetic-button', postback: { data: 'synthetic-action' } },
  { type: 'follow', source, replyToken: 'synthetic-follow' },
  { type: 'unfollow', source },
];
const forbidden = () => { throw new Error('paused private event must not reach a handler, lookup or reply'); };
assert.equal(directLine.PERSONAL_ASSISTANT_ENABLED, false);
for (const event of privateEvents) {
  assert.deepEqual(await directLine.routeDirectLineEvent({
    event, router: { resolveDirectBinding: forbidden, resolveDirectAttachmentBinding: forbidden },
    dispatcher: { dispatchDirectMessage: forbidden, dispatchDirectPostback: forbidden }, replyLineMessage: forbidden,
  }), { matched: true, routed: false, handled: true, reason: 'paused' });
}
const group = { type: 'message', source: { type: 'group', groupId: 'synthetic-group', userId: source.userId }, message: { id: 'synthetic-group-message', type: 'text', text: '群組訊息' } };
const room = { ...group, source: { type: 'room', roomId: 'synthetic-room', userId: source.userId } };
const transport = { type: 'message', source, message: { id: 'synthetic-owned-uof', type: 'text', text: '待簽' } };
for (const event of [group, room]) {
  assert.equal(directLine.isPausedDirectEvent(event), false);
  assert.deepEqual(await directLine.routeDirectLineEvent({ event }), { matched: false });
}

// Real server handler: pause before transport intake, finance, attachments and dispatch.
let handler;
const passed = { io: [], bank: [], archive: [], retrieval: [], dispatch: [] };
const calls = { io: 0, bank: 0, archive: 0, retrieval: 0, dispatch: 0 };
const logger = { log() {}, warn() {}, error(message) { throw new Error(message); } };
const tenant = { key: 'synthetic', modules: [], runtimeEnabled: true, dataSources: {} };
const router = { resolveGroupBinding: async () => ({ tenant, binding: { status: '啟用' } }) };
const platform = {
  attachmentArchive: {
    contract: 'synthetic', health: () => ({}), setTransportResolver() {},
    capture: async events => { calls.archive++; passed.archive.push(...events); return []; },
  },
};
const secret = 'synthetic-signature-secret';
const journalReads = [], journalReplies = [];
const sign = raw => crypto.createHmac('sha256', secret).update(raw).digest('base64');
const dependencies = {
  'node:http': { default: { createServer(fn) { handler = fn; return { listen() {} }; } } },
  'node:crypto': { default: crypto },
  './core/bootstrap.js': { bootstrap: async () => ({
    tenants: [tenant], line: { configured: true, isValidSignature: (raw, signature) => signature === sign(raw), replyLineMessage: forbidden,
      lineGet: async path => { journalReads.push(path);return path.startsWith('/v2/bot/user/') ? { richMenuId: 'richmenu-' + 'a'.repeat(32) } : { areas: [{ action: { type: 'uri', label: '工作日誌', uri: 'https://journal.example.com/?openExternalBrowser=1' } }] }; },
      replyLineMessages: async (token, messages) => journalReplies.push({ token, messages }),
    },
    router, dispatcher: { collectRoutes: () => [], dispatchMessage: async ({ event }) => { calls.dispatch++; passed.dispatch.push(event); } },
    portal: {}, modules: new Map(), platform, llm: { available: false, backends: [] }, logger,
  }) },
  './core/line-io/index.js': { createLineIo: async () => ({
    enabled: false, owns: event => event.message?.id === transport.message.id, handle: async () => false, capture: async events => { calls.io++; passed.io.push(...events); },
  }), readLineIoBody: async req => req.rawBody },
  './core/bank-line-reply-intake.js': { createBankLineReplyIntake: () => ({
    receive: async event => { calls.bank++; passed.bank.push(event); return false; }, drain: async () => {},
  }) },
  './core/attachment-retrieval.js': { createAttachmentRetrieval: () => ({
    contract: 'synthetic', handle: async event => { calls.retrieval++; passed.retrieval.push(event); return false; },
  }), parseAttachmentRequest: () => null },
  './core/work-journal-entry.js': workJournalEntry,
  './core/direct-line.js': directLine,
  './core/leaf-calendar/index.js': leafCalendar,
  './core/access-directory.js': { createAccessDirectory: () => ({}) },
  './core/portal-handoff.js': { safePortalHandoffLocation: () => '/' },
  './core/util.js': { readBody: async req => req.rawBody, sendJson: (res, status, body) => { res.status = status; res.body = body; }, sendText: (res, status) => { res.status = status; } },
  './core/group-onboarding.js': Object.fromEntries(['GROUP_ONBOARDING_BUILD', 'deliverGroupOnboardingReply', 'groupOnboardingProperties',
    'groupOnboardingRepairProperties', 'groupOnboardingSuccessMessage', 'parseGroupOnboardingCommand',
    'supportedGroupOnboardingExamples', 'withResolvedGroupName'].map(key => [key, () => ({ isCommand: false })])),
};
const context = vm.createContext({ URL, Buffer, console, process: { env: {} }, setInterval: () => ({ unref() {} }) });
const module = new vm.SourceTextModule(await fs.readFile(new URL('../server.js', import.meta.url), 'utf8'), { context });
await module.link(name => new vm.SyntheticModule(Object.keys(dependencies[name]), function () {
  for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
}, { context }));
await module.evaluate();
async function webhook(events, valid = true) {
  const rawBody = JSON.stringify({ events });
  const res = {};
  await handler({ method: 'POST', url: '/webhook/line', rawBody, headers: { 'x-line-signature': valid ? sign(rawBody) : 'invalid' } }, res);
  await new Promise(resolve => setImmediate(resolve));
  return res;
}
assert.equal((await webhook(privateEvents, false)).status, 401);
assert.equal((await webhook(privateEvents)).status, 200);
for (const events of Object.values(passed)) assert.deepEqual(events, []);
assert.ok(Object.values(calls).every(count => count === 0), 'private-only requests must bypass the entire processing pipeline');
assert.equal((await webhook([...privateEvents, group, room, transport])).status, 200);
for (const [kind, events] of Object.entries(passed)) {
  const expected = ['io', 'archive', 'retrieval'].includes(kind) ? [group, room, transport] : [group, room];
  assert.deepEqual(JSON.parse(JSON.stringify(events)), expected);
}
const health = {};
await handler({ method: 'GET', url: '/health' }, health);
assert.equal(health.body.personalAssistant.enabled, false);
assert.equal(health.body.personalAssistant.contract, 'private-assistant-pause-v1');
assert.equal(health.body.workJournalEntry.contract, 'line-work-journal-rich-menu-entry-v1');
const journal = { type: 'message', source: { type: 'user', userId: 'U' + '1'.repeat(32) }, replyToken: 'synthetic-journal', message: { id: 'synthetic-journal', type: 'text', text: '工作日誌' } };
assert.equal((await webhook([journal], false)).status, 401);
assert.equal(journalReads.length, 0);
assert.equal((await webhook([journal])).status, 200);
assert.equal(journalReplies.length, 1);
assert.equal(journalReplies[0].messages[0].template.actions[0].uri, 'https://journal.example.com/?openExternalBrowser=1');
const previous = Object.fromEntries(Object.entries(passed).map(([key, events]) => [key, events.length]));
assert.equal((await webhook([journal, transport])).status, 200);
for (const [key, events] of Object.entries(passed)) assert.equal(events.length, previous[key] + (['io', 'archive', 'retrieval'].includes(key) ? 1 : 0), 'Navigation bypasses ' + key + '; mixed UOF transport still runs');
assert.equal(journalReplies.length, 2);
console.log('Private assistant pause verified: private events bypass intake, lookup, dispatch and reply; groups/rooms and explicitly owned independent transport retained; live health exposes pause.');

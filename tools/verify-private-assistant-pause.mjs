import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as directLine from '../core/direct-line.js';

const source = { type: 'user', userId: 'synthetic-private-user' };
const privateEvents = [
  ...['你好', '我的身分', '新增待辦 明天回覆', '我的今天', '請款', '請提供這個檔案給我'].map((text, i) => ({
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
for (const event of [group, room]) {
  assert.equal(directLine.isPausedDirectEvent(event), false);
  assert.deepEqual(await directLine.routeDirectLineEvent({ event }), { matched: false });
}

// Real server handler: pause before transport intake, finance, attachments and dispatch.
let handler;
const passed = { io: [], bank: [], archive: [], retrieval: [], dispatch: [] };
const logger = { log() {}, warn() {}, error(message) { throw new Error(message); } };
const tenant = { key: 'synthetic', modules: [], runtimeEnabled: true, dataSources: {} };
const router = { resolveGroupBinding: async () => ({ tenant, binding: { status: '啟用' } }) };
const platform = {
  attachmentArchive: {
    contract: 'synthetic', health: () => ({}), setTransportResolver() {},
    capture: async events => { passed.archive.push(...events); return []; },
  },
};
const secret = 'synthetic-signature-secret';
const sign = raw => crypto.createHmac('sha256', secret).update(raw).digest('base64');
const dependencies = {
  'node:http': { default: { createServer(fn) { handler = fn; return { listen() {} }; } } },
  'node:crypto': { default: crypto },
  './core/bootstrap.js': { bootstrap: async () => ({
    tenants: [tenant], line: { configured: true, isValidSignature: (raw, signature) => signature === sign(raw), replyLineMessage: forbidden },
    router, dispatcher: { collectRoutes: () => [], dispatchMessage: async ({ event }) => passed.dispatch.push(event) },
    portal: {}, modules: new Map(), platform, llm: { available: false, backends: [] }, logger,
  }) },
  './core/line-io/index.js': { createLineIo: async () => ({
    enabled: false, owns: () => false, handle: async () => false, capture: async events => passed.io.push(...events),
  }), readLineIoBody: async req => req.rawBody },
  './core/bank-line-reply-intake.js': { createBankLineReplyIntake: () => ({
    receive: async event => { passed.bank.push(event); return false; }, drain: async () => {},
  }) },
  './core/attachment-retrieval.js': { createAttachmentRetrieval: () => ({
    contract: 'synthetic', handle: async event => { passed.retrieval.push(event); return false; },
  }), parseAttachmentRequest: () => null },
  './core/direct-line.js': directLine,
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
assert.equal((await webhook([...privateEvents, group, room])).status, 200);
for (const events of Object.values(passed)) assert.deepEqual(JSON.parse(JSON.stringify(events)), [group, room]);
const health = {};
await handler({ method: 'GET', url: '/health' }, health);
assert.equal(health.body.personalAssistant.enabled, false);
assert.equal(health.body.personalAssistant.contract, 'private-assistant-pause-v1');
console.log('Private assistant pause verified: signed private events acknowledged without intake, lookup, dispatch or reply; mixed group/room events retained; live health exposes pause.');

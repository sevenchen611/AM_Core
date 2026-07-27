import { bootstrap } from '../../core/bootstrap.js';
import { __test as meetingTest } from '../../modules/meetings/index.js';

const pushed = [];
const replied = [];

const m4a = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, ...new Array(20).fill(0)]);
const genericIsom = Uint8Array.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x6d, 0x70, 0x34, 0x31, ...new Array(20).fill(0)]);
const pdf = Uint8Array.from([...'%PDF-1.7'].map((c) => c.charCodeAt(0)).concat(new Array(20).fill(0)));

let content = m4a;
let contentType = 'application/octet-stream';
let failNextLinePush = false;

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
  headers: { get: () => 'application/json' },
});

globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.host === 'api-data.line.me') {
    if (opts.headers?.Range) {
      const head = content.slice(0, 64);
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => head.buffer,
        text: async () => '',
        headers: { get: (name) => name?.toLowerCase() === 'content-type' ? contentType : 'application/json' },
        body: { cancel: async () => {} },
      };
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => content.buffer,
      text: async () => '',
      headers: { get: (name) => name?.toLowerCase() === 'content-type' ? contentType : 'application/json' },
    };
  }
  if (url.host === 'api.line.me' && url.pathname.includes('/member/')) return jsonResponse({ displayName: 'Seven' });
  if (url.host === 'api.line.me' && url.pathname.endsWith('/message/reply')) {
    const body = JSON.parse(opts.body);
    replied.push(body.messages?.[0]?.text || '');
    return jsonResponse({});
  }
  if (url.host === 'api.line.me' && url.pathname.endsWith('/message/push')) {
    if (failNextLinePush) {
      failNextLinePush = false;
      return jsonResponse({ message: 'simulated push failure' }, false, 500);
    }
    const body = JSON.parse(opts.body);
    pushed.push(body.messages?.[0]?.text || '');
    return jsonResponse({});
  }
  return jsonResponse({});
};

const tenants = [{
  key: 'eng',
  displayName: 'Engineering',
  envPrefix: 'ENG',
  modules: ['meetings'],
  parentPageId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
  dataSources: {
    messages: 'e0000000000000000000000000000001',
    groupBindings: 'e0000000000000000000000000000002',
    meetings: 'e0000000000000000000000000000003',
    tasks: 'e0000000000000000000000000000004',
  },
  driveRootFolderId: '',
  driveConfigured: false,
  notionConfigured: true,
  config: { meetings: { types: ['General'], defaultType: 'General' } },
}];

const env = {
  NOTION_TOKEN: 'test',
  LINE_CHANNEL_ACCESS_TOKEN: 'test',
  LINE_CHANNEL_SECRET: 'test',
  ASSEMBLYAI_API_KEY: 'assembly-test',
};

const { dispatcher, modules } = await bootstrap(env, { tenants, logger: { ...console, log: () => {} } });
const event = (id, fileName, type = 'file') => ({
  type: 'message',
  replyToken: `reply-${id}`,
  message: { id, type, ...(fileName ? { fileName } : {}) },
  source: { type: 'group', groupId: 'Ceng', userId: 'U1' },
  timestamp: 1,
});
const binding = { projectPageId: 'proj1', role: 'member' };
const resetMessages = () => { pushed.length = 0; replied.length = 0; };
const rosterSent = () => pushed.length + replied.length > 0;
const results = [];
const check = (name, ok) => results.push([ok, name]);

content = m4a; contentType = 'application/octet-stream'; resetMessages();
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('m1', 'recording') });
check('extensionless M4A header triggers meeting prompt', rosterSent());
check('roster prompt uses LINE reply when replyToken is available', replied.length === 1 && pushed.length === 0);

content = genericIsom; contentType = 'audio/x-m4a'; resetMessages();
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('m1b', 'generic-isom-audio') });
check('generic ftypisom with audio/x-m4a content type triggers meeting prompt', rosterSent());

content = pdf; contentType = 'application/pdf'; resetMessages();
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('m2', 'document') });
check('extensionless PDF does not trigger meeting prompt', !rosterSent());

content = m4a; contentType = 'application/octet-stream'; resetMessages();
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('m3', 'weekly.m4a') });
check('.m4a filename triggers meeting prompt', rosterSent());

let downstreamMessages = 0;
modules.set('_after-meetings-test', { name: '_after-meetings-test', onMessage: async () => { downstreamMessages += 1; return true; } });
tenants[0].modules.push('_after-meetings-test');

content = m4a; contentType = 'application/octet-stream'; resetMessages(); downstreamMessages = 0;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('v1', '', 'video') });
check('native LINE video does not trigger meeting prompt', !rosterSent());
check('native LINE video continues to downstream modules', downstreamMessages === 1);
check('native video MIME is normalized without overwriting existing video MIME',
  meetingTest.normalizeMeetingContentType('application/octet-stream', 'video-v1.mp4', true) === 'video/mp4'
  && meetingTest.normalizeMeetingContentType('video/quicktime', 'video-v2.mov', true) === 'video/quicktime');

content = m4a; contentType = 'application/octet-stream'; resetMessages(); downstreamMessages = 0; failNextLinePush = true;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('v2', '', 'video') });
check('video still continues downstream when unrelated push failure is queued', downstreamMessages === 1);

content = m4a; contentType = 'application/octet-stream'; resetMessages(); downstreamMessages = 0;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: event('v3', 'demo.mp4', 'file') });
check('.mp4 file does not trigger meeting prompt', !rosterSent());

let pass = 0;
for (const [ok, name] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) pass += 1;
}
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);

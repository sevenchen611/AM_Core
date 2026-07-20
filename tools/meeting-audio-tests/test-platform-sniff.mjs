import assert from 'node:assert';
import { bootstrap } from 'file:///D:/Codex_project/AM_Core/core/bootstrap.js';
import { __test as meetingTest } from 'file:///D:/Codex_project/AM_Core/modules/meetings/index.js';

const pushed = [];
const m4a = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, ...new Array(20).fill(0)]);
const pdf = Uint8Array.from([...'%PDF-1.7'].map((c) => c.charCodeAt(0)).concat(new Array(20).fill(0)));
let content = m4a;
let failNextLinePush = false;

const J = (o, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(o), json: async () => o, headers: { get: () => 'application/json' } });
globalThis.fetch = async (input, opts = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  if (u.host === 'api-data.line.me') {
    if (opts.headers?.Range) { const head = content.slice(0, 64); return { ok: true, status: 206, arrayBuffer: async () => head.buffer, text: async () => '', headers: { get: () => 'application/octet-stream' }, body: { cancel: async () => {} } }; }
    return { ok: true, status: 200, arrayBuffer: async () => content.buffer, text: async () => '', headers: { get: () => 'application/octet-stream' } };
  }
  if (u.host === 'api.line.me' && u.pathname.includes('/member/')) return J({ displayName: 'Seven' });
  if (u.host === 'api.line.me' && u.pathname.endsWith('/message/push')) {
    if (failNextLinePush) { failNextLinePush = false; return J({ message: 'simulated push failure' }, false, 500); }
    const b = JSON.parse(opts.body); pushed.push(b.messages?.[0]?.text || ''); return J({});
  }
  return J({});
};

const tenants = [{
  key: 'eng', displayName: '工程', envPrefix: 'ENG', modules: ['meetings'],
  parentPageId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
  dataSources: { messages: 'e0000000000000000000000000000001', groupBindings: 'e0000000000000000000000000000002', meetings: 'e0000000000000000000000000000003', tasks: 'e0000000000000000000000000000004' },
  driveRootFolderId: '', driveConfigured: false, notionConfigured: true,
  config: { meetings: { types: ['審圖', '交底', '工地檢討'], defaultType: '工地檢討' } },
}];
const env = { NOTION_TOKEN: 't', LINE_CHANNEL_ACCESS_TOKEN: 't', LINE_CHANNEL_SECRET: 't', ASSEMBLYAI_API_KEY: 'aai' };

const { dispatcher, modules } = await bootstrap(env, { tenants, logger: { ...console, log: () => {} } });
const evt = (id, fileName, type = 'file') => ({ type: 'message', message: { id, type, ...(fileName ? { fileName } : {}) }, source: { type: 'group', groupId: 'Ceng', userId: 'U1' }, timestamp: 1 });
const binding = { projectPageId: 'proj1', role: '內部' };
const rosterSent = () => pushed.some((t) => /收到會議錄音|參與者有誰/.test(t));
const rosterCount = () => pushed.filter((t) => /收到會議錄音|參與者有誰/.test(t)).length;

const results = [];
const check = (n, c) => results.push([c, n]);

content = m4a; pushed.length = 0;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: evt('m1', '會議錄音') });
check('無副檔名 m4a(octet-stream)→ 觸發會議反問', rosterSent());

content = pdf; pushed.length = 0;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: evt('m2', '合約文件') });
check('無副檔名 PDF → 不觸發會議', !rosterSent());

content = m4a; pushed.length = 0;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: evt('m3', '週會.m4a') });
check('.m4a 副檔名 → 快路觸發會議反問', rosterSent());

content = m4a; pushed.length = 0;
let downstreamMessages = 0;
modules.set('_after-meetings-test', { name: '_after-meetings-test', onMessage: async () => { downstreamMessages += 1; return true; } });
tenants[0].modules.push('_after-meetings-test');
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: evt('v1', '', 'video') });
check('LINE 原生 video → 觸發一次會議反問', rosterCount() === 1);
check('LINE 原生 video → 自動補 video-<id>.mp4 檔名', pushed.some((t) => t.includes('video-v1.mp4')));
check('Meeting 接收 video 後短路後續模組', downstreamMessages === 0);
check('原生 video MIME 補正且既有 video MIME 保留',
  meetingTest.normalizeMeetingContentType('application/octet-stream', 'video-v1.mp4', true) === 'video/mp4'
  && meetingTest.normalizeMeetingContentType('video/quicktime', 'video-v2.mov', true) === 'video/quicktime');

content = m4a; pushed.length = 0; downstreamMessages = 0; failNextLinePush = true;
await dispatcher.dispatchMessage({ tenant: tenants[0], binding, event: evt('v2', '', 'video') });
check('反問推播失敗時 Meeting 仍短路後續模組', downstreamMessages === 0);

let pass = 0;
for (const [ok, n] of results) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);

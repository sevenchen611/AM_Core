import assert from 'node:assert';
import meetings from 'file:///D:/Codex_project/AM_Core/modules/meetings/index.js';

let streamCalls = 0, downloadCalls = 0, uploadBodyWasStream = false;
const pushed = [];
const fakeStream = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])); c.close(); } });

// AssemblyAI 端點用 global fetch mock
globalThis.fetch = async (input, opts = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const J = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o), json: async () => o });
  if (url.includes('/v2/upload')) { if (opts.body && typeof opts.body.getReader === 'function') uploadBodyWasStream = true; return J({ upload_url: 'https://assembly/up/1' }); }
  if (url.includes('/v2/transcript/')) return J({ status: 'completed', utterances: [{ speaker: 'A', text: '大家好' }, { speaker: 'B', text: '收到' }], text: '大家好 收到' });
  if (url.includes('/v2/transcript')) return J({ id: 'tr1' });
  return J({});
};

const platform = {
  assemblyKey: 'aai', geminiKey: '', geminiModel: 'x',
  pushLineMessage: async (to, text) => { pushed.push(text); },
  streamLineContent: async () => { streamCalls++; return { stream: fakeStream(), contentType: 'audio/x-m4a' }; },
  downloadLineContent: async () => { downloadCalls++; throw new Error('downloadLineContent 不該被呼叫(應全程串流)'); },
  notionRequest: async (p, opts = {}) => {
    if (p === '/v1/pages' && opts.method === 'POST') return { id: 'page1', url: 'https://notion.so/page1' };
    if (p.includes('/query')) return { results: [] };
    return { id: 'blk', results: [] };
  },
  driveConfigured: false,
  llm: {
    available: true,
    completeJson: async ({ schema }) => {
      const props = schema?.properties || {};
      if (props.speakers) return { kind: 'work', topic: '測試主題', speakers: [{ order: 1, name: 'A', role: '' }, { order: 2, name: 'B', role: '' }], keyterms: [] };
      return { title: '測試主題', type: '工地檢討', minutes: [{ heading: '區段', points: ['要點一'] }], highlights: ['重點一'], conclusions: ['結論一'], todos: [{ content: '待辦一', owner: 'A', due: '' }], nextMeeting: '' };
    },
  },
  publicBaseUrl: 'https://plat.example.com', publicLinkSecret: 'sec',
};
meetings.init(platform);

const tenant = { key: 'eng', dataSources: { meetings: 'dsM', tasks: 'dsT', projects: 'dsP' }, config: { meetings: { types: ['審圖', '交底', '工地檢討'], defaultType: '工地檢討' } } };
const groupId = 'Ceng';
const binding = { projectPageId: '', role: '內部' };

const results = [];
const check = (n, c) => results.push([c, n]);

// 1) 串流路徑 onAudio:立刻發反問,且「不下載」
await meetings.onAudio({ tenant, audioMessageId: 'mid99', filename: 'audio-mid99.m4a', binding, senderName: 'Seven', groupId, ackSent: false });
check('onAudio 立刻送出反問(收到會議錄音)', pushed.some((t) => /收到會議錄音|參與者有誰/.test(t)));
check('onAudio 階段「沒有」下載整檔', downloadCalls === 0);
check('onAudio 階段「還沒」串流(等回覆才轉寫)', streamCalls === 0);
check('此(租戶,群)進入待補狀態', meetings.hasPending(tenant, groupId) === true);

// 2) 回覆與會資訊 → 轉寫(應走串流上傳,全程不整包下載)
pushed.length = 0;
await meetings.onMessage({ tenant, groupId, text: '與會者:①A ②B。主題:測試主題', senderName: 'Seven' });
check('轉寫用「串流」上傳 AssemblyAI', streamCalls >= 1);
check('AssemblyAI upload 的 body 是串流(ReadableStream)', uploadBodyWasStream === true);
check('全程「沒有」整包下載(downloadLineContent 未被呼叫)', downloadCalls === 0);
check('產出並發布會議記錄到 LINE', pushed.some((t) => /會議記錄|重點|待辦/.test(t)));

let pass = 0;
for (const [ok, n] of results) { console.log(`${ok ? '✅' : '❌'} ${n}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);

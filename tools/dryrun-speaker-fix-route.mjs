// modules/meetings 的 /m 公開唯讀路由 — 離線驗證(不打真 API)。
// 執行:node tools/dryrun-speaker-fix-route.mjs
//
// 與 dryrun-speaker-fix.mjs 互補:那支只測內部改寫引擎,這支測公開路由閘門——
//   · GET 公開頁永遠唯讀,不顯示 PIN 或改寫工具
//   · POST 無論 PIN 正誤都拒絕,且一個 block 都不改
//   · 壞簽章的 POST → 404,不進任何寫入流程

import crypto from 'node:crypto';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mod = (await import(`file://${path.join(HERE, '../modules/meetings/index.js').replace(/\\/g, '/')}`)).default;

const SECRET = 'test-secret';
const PAGE = '39a51c686dac819b816dea4a562c4b9f';
const sig = crypto.createHmac('sha256', SECRET).update(`meeting:${PAGE}`).digest('hex').slice(0, 16);
const PATH = `/m/${PAGE}-${sig}`;
const LEGEND = '【講者對照】講者A=Seven(負責人)  講者B=其勳(現場工務主任)';
const rt = (s) => [{ type: 'text', text: { content: s }, plain_text: s }];

function makePlatform({ pinConfigured = true, pin = '1234' } = {}) {
  const patched = { blocks: {}, props: {} };
  const page = { id: PAGE, url: 'https://notion/x', properties: { '會議': { title: rt('D區檢討') }, '日期': { date: { start: '2026-07-11' } }, '參與者': { type: 'rich_text', rich_text: rt('Seven(負責人)、其勳(現場工務主任)') }, '類型': { select: { name: '審圖' } } } };
  const top = [
    { id: 'lg', type: 'paragraph', has_children: false, paragraph: { rich_text: rt(LEGEND) } },
    { id: 'sumTog', type: 'heading_2', has_children: true, heading_2: { rich_text: rt('📄 摘要(會議記錄)'), is_toggleable: true } },
    { id: 'trTog', type: 'heading_2', has_children: true, heading_2: { rich_text: rt('🎧 逐字稿(署名)'), is_toggleable: true } },
  ];
  const kids = {
    sumTog: [{ id: 's1', type: 'bulleted_list_item', has_children: false, bulleted_list_item: { rich_text: rt('Seven確認做法,其勳提議') } },
             { id: 'todoH', type: 'heading_2', has_children: false, heading_2: { rich_text: rt('📅 待辦') } },
             { id: 't1', type: 'to_do', has_children: false, to_do: { rich_text: rt('確認進入點(其勳)'), checked: false } }],
    trTog: [{ id: 'tr1', type: 'paragraph', has_children: false, paragraph: { rich_text: rt('Seven(負責人):好。其勳(現場工務主任):嗯。') } }],
  };
  const readText = (a) => (a || []).map((x) => x.plain_text || x.text?.content || '').join('');
  const notionRequest = async (p, o = {}) => {
    const m = o.method || 'GET';
    if (p.includes('/children')) { const id = decodeURIComponent(p.split('/v1/blocks/')[1].split('/children')[0]); return { results: id === PAGE ? top : (kids[id] || []), has_more: false }; }
    if (p.startsWith('/v1/pages/') && m === 'GET') return page;
    if (p.startsWith('/v1/pages/') && m === 'PATCH') { patched.props = o.body.properties; return {}; }
    if (p.startsWith('/v1/blocks/') && m === 'PATCH') { patched.blocks[decodeURIComponent(p.split('/v1/blocks/')[1])] = readText(Object.values(o.body)[0].rich_text); return {}; }
    if (p.includes('/query')) return { results: [] };
    throw new Error('notion? ' + m + ' ' + p);
  };
  return { platform: { notionRequest, publicBaseUrl: 'https://plat', publicLinkSecret: SECRET, portal: { checkPin: (x) => Boolean(pin) && x === pin, pinConfigured } }, patched };
}

const mockRes = () => { const r = { status: 0, body: '' }; return { writeHead: (s) => { r.status = s; }, end: (b) => { r.body = b || ''; }, _r: r }; };
function mockReq(method, bodyObj) {
  const req = { method, headers: {}, on(ev, cb) { this['_' + ev] = cb; return this; }, destroy() {} };
  process.nextTick(() => { if (bodyObj !== undefined) req._data?.(Buffer.from(JSON.stringify(bodyObj))); req._end?.(); });
  return req;
}

const SWAP = [{ label: 'A', full: '其勳(現場工務主任)' }, { label: 'B', full: 'Seven(負責人)' }];
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

check('GET:有效簽章可讀,但不含 PIN 或改寫工具', async () => {
  const { platform } = makePlatform(); mod.init(platform);
  const res = mockRes();
  assert.equal(await mod.handlePublicRequest(mockReq('GET'), res, PATH), true);
  assert.equal(res._r.status, 200);
  assert.ok(res._r.body.includes('Seven(負責人)') && res._r.body.includes('其勳(現場工務主任)'), '公開內容缺漏');
  assert.ok(!res._r.body.includes('修正講者'), '公開頁不應顯示改寫工具');
  assert.ok(!res._r.body.includes('data-label="A"') && !res._r.body.includes('name="pin"'), '公開頁不應含編輯欄位');
});

check('GET:PIN 是否設定都不改變唯讀狀態', async () => {
  const { platform } = makePlatform({ pinConfigured: false }); mod.init(platform);
  const res = mockRes();
  await mod.handlePublicRequest(mockReq('GET'), res, PATH);
  assert.equal(res._r.status, 200);
  assert.ok(!res._r.body.includes('修正講者'), '不該顯示改寫工具');
});

check('POST 錯 PIN → 403,不改寫', async () => {
  const { platform, patched } = makePlatform(); mod.init(platform);
  const res = mockRes();
  await mod.handlePublicRequest(mockReq('POST', { fixes: SWAP, pin: 'WRONG' }), res, PATH);
  assert.equal(res._r.status, 403);
  assert.equal(Object.keys(patched.blocks).length, 0);
});

check('POST 對 PIN → 仍為 403,不改寫', async () => {
  const { platform, patched } = makePlatform(); mod.init(platform);
  const res = mockRes();
  await mod.handlePublicRequest(mockReq('POST', { fixes: SWAP, pin: '1234' }), res, PATH);
  assert.equal(res._r.status, 403);
  assert.equal(Object.keys(patched.blocks).length, 0);
  assert.equal(Object.keys(patched.props).length, 0);
});

check('POST 壞簽章 → 404,不進 save', async () => {
  const { platform, patched } = makePlatform(); mod.init(platform);
  const res = mockRes();
  await mod.handlePublicRequest(mockReq('POST', { fixes: SWAP, pin: '1234' }), res, `/m/${PAGE}-0000000000000000`);
  assert.equal(res._r.status, 404);
  assert.equal(Object.keys(patched.blocks).length, 0);
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name}\n     ${e.message}`); }
}
console.log(`\n${pass}/${tests.length} checks passed.`);
process.exit(pass === tests.length ? 0 : 1);

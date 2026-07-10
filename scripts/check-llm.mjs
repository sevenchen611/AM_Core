// core/llm.js 的檢查
//   node scripts/check-llm.mjs           離線(假 fetch,不花錢)+ 線上(真金鑰,會計費)
//   node scripts/check-llm.mjs --offline 只跑離線,零成本零外部相依(CI 可用)
//
// 為什麼要有離線那半:completeText 曾經在 MiniMax 把 max_tokens 燒光在 <think> 裡時
// 靜默回傳空字串 —— 不拋錯、不落備援、不留 log。唯一症狀是「Notion 上多出一頁空白
// 會議記錄」,要人去看才會發現。沒有測試盯著,它回歸時一樣沒有人會知道。
//
// 為什麼要有線上那半:「後端宣告 supportsImages: true」與「callRaw 真的把圖送出去」
// 是兩件事,型別系統與註解都連不起來,只有真的送一張圖才連得起來。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createLlm } from '../core/llm.js';

const OFFLINE_ONLY = process.argv.includes('--offline');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, warn() {} };
const noSleep = async () => {};

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(46)}${detail}`);
  if (!ok) failed += 1;
};

// ═══════════════════════════════════════════════════════════
// 離線:假 fetch。不花錢、不需金鑰、不碰網路。
// ═══════════════════════════════════════════════════════════
const realFetch = globalThis.fetch;

// 假環境:四家後端都「有金鑰」,才測得到鏈序與備援。
const FAKE_ENV = {
  MINIMAX_API_KEY: 'k', MINIMAX_MODEL: 'MiniMax-M3', MINIMAX_API_BASE_URL: 'https://api.minimax.io/v1',
  GEMINI_API_KEY: 'k', ASSEMBLYAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k',
};
const fakeLlm = (extraEnv = {}) => createLlm({ env: { ...FAKE_ENV, ...extraEnv }, logger: quiet, sleep: noSleep });

const R = (body, status = 200) => new Response(JSON.stringify(body), { status });
const MINIMAX_THINK_ONLY = { choices: [{ finish_reason: 'length', message: { content: '<think>想到預算用盡</think>' } }] };
const GEMINI_OK = { candidates: [{ content: { parts: [{ text: '{"title":"OK"}' }] } }] };
const GATEWAY_OK = { choices: [{ message: { content: '{"title":"GATEWAY"}' } }] };

// route: 依 url 決定回什麼。hits 記錄各後端被打幾次。
function fakeFetch(hits, route) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const who = u.includes('llm-gateway.assemblyai.com') ? 'assemblyai'
      : u.includes('minimax') ? 'minimax'
        : u.includes('api.anthropic.com') ? 'anthropic' : 'gemini';
    hits[who] = (hits[who] || 0) + 1;
    return route(who, init, hits[who]);
  };
}

console.log('══ 離線(假 fetch,不花錢)══\n');

// ── 靜默空回應:completeText 必須落備援,不可回 '' ──
console.log('── 空回應(<think> 吃光 max_tokens)──');
{
  const hits = {};
  fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  const out = await fakeLlm().completeText({ system: 's', userContent: 'u' });
  check(out === '{"title":"OK"}' && hits.minimax === 2 && hits.gemini === 1,
    'completeText 落備援(不再靜默回空字串)', JSON.stringify(hits));
}
{
  const hits = {};
  fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  const out = await fakeLlm().completeJson({ system: 's', userContent: 'u', schema: { type: 'object' } });
  check(out?.title === 'OK' && hits.minimax === 2 && hits.gemini === 1,
    'completeJson 行為不變', JSON.stringify(hits));
}

// ── 重試分類:三種失敗的處置必須不同 ──
console.log('\n── 重試分類(transient / parse / fatal)──');
{
  // 429 → 暫時性:同一後端試 3 次,退避 8s + 16s
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R({ error: 'rate limited' }, 429) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  const out = await llm.completeText({ system: 's', userContent: 'u' });
  check(out === '{"title":"OK"}' && hits.minimax === 3 && delays.join(',') === '8000,16000',
    '429 → 退避 8s,16s 後換人', `hits=${JSON.stringify(hits)} delays=[${delays}]`);
}
{
  // 500 → 暫時性
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R({}, 500) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  await llm.completeText({ system: 's', userContent: 'u' });
  check(hits.minimax === 3 && delays.length === 2, '5xx → 退避重試 3 次', `hits=${JSON.stringify(hits)}`);
}
{
  // 401 → 確定性:0 次重試,立刻換人,絕不 sleep
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R({ error: 'bad key' }, 401) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  const out = await llm.completeText({ system: 's', userContent: 'u' });
  check(out === '{"title":"OK"}' && hits.minimax === 1 && delays.length === 0,
    '401 → 不重試不 sleep,立刻換人', `hits=${JSON.stringify(hits)} delays=[${delays}]`);
}
{
  // 400 → 確定性
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R({ error: 'no such model' }, 400) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  await llm.completeText({ system: 's', userContent: 'u' });
  check(hits.minimax === 1 && delays.length === 0, '400 → 不重試不 sleep', `hits=${JSON.stringify(hits)}`);
}
{
  // 空回應是 parse 類:重試 2 次,但「不」sleep(sleep 是純浪費)
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  await llm.completeText({ system: 's', userContent: 'u' });
  check(hits.minimax === 2 && delays.length === 0, '空回應 → 立刻重試 2 次,不 sleep', `delays=[${delays}]`);
}
{
  // 無法解析的 JSON 也是 parse 類
  const hits = {}; const delays = [];
  fakeFetch(hits, (who) => (who === 'minimax' ? R({ choices: [{ message: { content: '這不是 JSON' } }] }) : R(GEMINI_OK)));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  const out = await llm.completeJson({ system: 's', userContent: 'u', schema: { type: 'object', required: ['title'] } });
  check(out?.title === 'OK' && hits.minimax === 2 && delays.length === 0,
    '壞 JSON → 立刻重試 2 次,不 sleep', `hits=${JSON.stringify(hits)}`);
}
{
  // 網路例外(fetch 自己丟)→ 當暫時性
  const hits = {}; const delays = [];
  globalThis.fetch = async (url) => {
    const who = String(url).includes('minimax') ? 'minimax' : 'gemini';
    hits[who] = (hits[who] || 0) + 1;
    if (who === 'minimax') throw new TypeError('fetch failed');
    return R(GEMINI_OK);
  };
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  const out = await llm.completeText({ system: 's', userContent: 'u' });
  check(out === '{"title":"OK"}' && hits.minimax === 3 && delays.length === 2,
    '網路例外 → 當暫時性,退避重試', `hits=${JSON.stringify(hits)}`);
}

// ── gateway / profile / 鏈序 ──
console.log('\n── AssemblyAI Gateway 與 profile ──');
{
  const llm = fakeLlm();
  const names = llm.backends.map((b) => b.name);
  check(names[0] === 'minimax' && !names.includes('assemblyai'),
    'DEFAULT_CHAIN 未被動到(預設不燒 gateway 的錢)', names.join(' → '));
  check(llm.allBackends.some((b) => b.name === 'assemblyai'), 'assemblyai 可被 profile 指名');
  check(llm.allBackends.find((b) => b.name === 'assemblyai')?.supportsImages === false,
    'assemblyai supportsImages=false');
}
{
  let seenAuth = null;
  globalThis.fetch = async (url, init) => { seenAuth = init.headers.authorization; return R(GATEWAY_OK); };
  await fakeLlm().completeText({ system: 's', userContent: 'u', chain: 'assemblyai' });
  check(seenAuth === 'k', 'gateway auth 是原始金鑰,不加 Bearer', `authorization=${JSON.stringify(seenAuth)}`);
}
{
  const hits = {}; fakeFetch(hits, () => R(GATEWAY_OK));
  await fakeLlm().completeText({ system: 's', userContent: 'u', profile: 'quality' });
  check(hits.assemblyai === 1 && !hits.minimax, "profile:'quality' 第一個打 gateway", JSON.stringify(hits));
}
{
  const hits = {}; fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  await fakeLlm().completeText({ system: 's', userContent: 'u' });
  check(hits.minimax >= 1 && !hits.assemblyai, '不給 profile 時第一個打 minimax', JSON.stringify(hits));
}
{
  const hits = {}; fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  const out = await fakeLlm().completeText({ system: 's', userContent: 'u', profile: 'nonexistent' });
  check(out === '{"title":"OK"}' && hits.minimax === 2, '未知 profile → 退回預設鏈,不空鏈', JSON.stringify(hits));
}
{
  const hits = {}; fakeFetch(hits, (who) => (who === 'minimax' ? R(MINIMAX_THINK_ONLY) : R(GEMINI_OK)));
  const out = await fakeLlm().completeText({ system: 's', userContent: 'u', chain: 'nosuch,alsonope' });
  check(out === '{"title":"OK"}' && hits.minimax === 2, '未知 chain 名 → 退回預設鏈', JSON.stringify(hits));
}
{
  // 韌性鐵律:gateway 掛掉時,接手的必須是「直連 gemini(自己的金鑰)」,
  // 不是 gateway 裡轉售的 gemini —— 否則 AssemblyAI 一掛,轉寫與摘要同時陣亡。
  const hits = {};
  fakeFetch(hits, (who) => (who === 'assemblyai' ? R({}, 503) : who === 'minimax' ? R({}, 500) : R({ candidates: [{ content: { parts: [{ text: 'RESCUED' }] } }] })));
  const out = await fakeLlm().completeText({ system: 's', userContent: 'u', profile: 'quality' });
  check(out === 'RESCUED' && hits.assemblyai === 3 && hits.gemini === 1,
    'gateway 掛掉 → 直連 gemini 接手', JSON.stringify(hits));
}
{
  // 全鏈皆敗 → 必須拋錯,錯誤訊息要帶上每一家的失敗類別
  const hits = {}; fakeFetch(hits, () => R({ error: 'bad key' }, 401));
  try {
    await fakeLlm().completeText({ system: 's', userContent: 'u' });
    check(false, '全鏈皆敗 → 拋錯', '竟然沒拋');
  } catch (e) {
    check(/所有 LLM 後端都失敗/.test(e.message) && /minimax\/fatal/.test(e.message),
      '全鏈皆敗 → 拋錯並帶失敗類別', e.message.slice(0, 60) + '…');
  }
}
{
  // 沒有金鑰 → available=false,呼叫要明確拒絕
  const none = createLlm({ env: {}, logger: quiet, sleep: noSleep });
  check(none.available === false, '無金鑰 → available=false');
  try { await none.completeText({ system: 's', userContent: 'u' }); check(false, '無金鑰 → 拒絕'); }
  catch (e) { check(/沒有可用的 LLM 後端/.test(e.message), '無金鑰 → 明確拒絕'); }
}

// ── 圖片後端過濾 ──
console.log('\n── 圖片能力過濾 ──');
{
  // quality 鏈頭 assemblyai 看不見圖 → 要圖時必須被濾掉,絕不能讓它瞎掰
  const hits = {}; fakeFetch(hits, () => R(GEMINI_OK));
  const img = path.join(os.tmpdir(), `am-llm-filter-${process.pid}.png`);
  fs.writeFileSync(img, quadrantPng());
  await fakeLlm().completeText({ system: 's', userContent: 'u', profile: 'quality', imagePaths: [img] });
  check(!hits.assemblyai && hits.gemini === 1, 'imagePaths 時 assemblyai 被濾掉', JSON.stringify(hits));
  fs.unlinkSync(img);
}
{
  // 讀不到圖是確定性錯誤:不可退避重試三次
  const hits = {}; const delays = [];
  fakeFetch(hits, () => R(GEMINI_OK));
  const llm = createLlm({ env: FAKE_ENV, logger: quiet, sleep: async (ms) => delays.push(ms) });
  try { await llm.completeText({ system: 's', userContent: 'u', chain: 'gemini', imagePaths: ['C:/does-not-exist.png'] }); }
  catch { /* 預期失敗 */ }
  check(delays.length === 0 && !hits.gemini, '讀不到圖 → fatal,不重試不 sleep', `delays=[${delays}]`);
}
{
  const one = createLlm({ env: { ...FAKE_ENV, MINIMAX_MODEL: 'MiniMax-M2', AMCORE_LLM_CHAIN: 'minimax' }, logger: quiet, sleep: noSleep });
  const img = path.join(os.tmpdir(), `am-llm-blind-${process.pid}.png`);
  fs.writeFileSync(img, quadrantPng());
  try {
    await one.completeText({ system: 's', userContent: 'u', imagePaths: [img] });
    check(false, '只給看不見圖的後端 → 拒絕', '竟然沒擋下來');
  } catch (e) {
    check(/沒有支援圖片/.test(e.message), '只給 M2(瞎子)卻要看圖 → 明確拒絕');
  }
  fs.unlinkSync(img);
}

globalThis.fetch = realFetch;

// ═══════════════════════════════════════════════════════════
// 線上:真金鑰、真 API、會計費。--offline 可跳過。
// ═══════════════════════════════════════════════════════════
if (OFFLINE_ONLY) {
  console.log('\n⏭  --offline:跳過線上檢查');
} else {
  const env = { ...process.env };
  try {
    for (const ln of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = ln.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch { /* Render 上沒有 .env,環境變數已在 process.env */ }

  const llm = createLlm({ env, logger: quiet });
  console.log('\n══ 線上(真金鑰,會計費)══\n');
  console.log('預設鏈  :', llm.backends.map((b) => `${b.name}(${b.model}${b.supportsImages ? ',👁' : ''})`).join(' → '));
  console.log('可指名  :', llm.allBackends.map((b) => b.name).join(', '));
  console.log('profiles:', JSON.stringify(llm.profiles), '\n');

  if (!llm.available) {
    check(false, '沒有任何可用後端', '檢查 .env 金鑰');
  } else {
    for (const b of llm.backends) {
      const one = createLlm({ env: { ...env, AMCORE_LLM_CHAIN: b.name }, logger: quiet });
      const r = await one.selfTest();
      check(r.ok, `${b.name} 文字`, r.ok ? `backend=${r.backend}` : r.error.slice(0, 80));
    }

    // 視覺:宣告看得見圖的後端,都得真的看得見。
    // 「宣告 supportsImages」與「callRaw 真的把圖送出去」是兩件事,只有真的送才連得起來。
    const img = path.join(os.tmpdir(), `am-llm-vision-${process.pid}.png`);
    fs.writeFileSync(img, quadrantPng());
    try {
      for (const b of llm.backends.filter((x) => x.supportsImages)) {
        const one = createLlm({ env: { ...env, AMCORE_LLM_CHAIN: b.name }, logger: quiet });
        try {
          const t = await one.completeText({
            system: '你是影像辨識器。',
            userContent: '這張圖被切成四個象限,每個象限一個純色。照「左上、右上、左下、右下」的順序,只回答四個顏色名稱,用頓號分隔。',
            maxTokens: 2000, imagePaths: [img],
          });
          const at = ['紅', '綠', '藍', '黃'].map((c) => t.indexOf(c));
          const saw = at.every((i) => i >= 0) && at.every((v, i, a) => i === 0 || a[i - 1] < v);
          check(saw, `${b.name} 看得到圖`, `「${t.slice(0, 30)}」`);
        } catch (e) {
          check(false, `${b.name} 看得到圖`, e.message.slice(0, 80));
        }
      }
    } finally {
      try { fs.unlinkSync(img); } catch {}
    }

    // gateway 走真 API 打一次(極短 prompt,成本可忽略)
    const q = await llm.complete({
      system: '你是自我測試器。', userContent: '回覆 {"pong": true}',
      schema: { type: 'object', required: ['pong'] }, maxTokens: 2000, profile: 'quality',
    }).catch((e) => ({ error: e.message }));
    check(q?.data?.pong === true && q.backend === 'assemblyai',
      "profile:'quality' 真實呼叫 gateway", q?.error ? q.error.slice(0, 80) : `backend=${q.backend}`);
  }
}

console.log(failed ? `\n❌ ${failed} 項失敗` : '\n✅ 全部通過');
process.exit(failed ? 1 : 0);

// ── 造一張四象限彩圖(左上紅 右上綠 左下藍 右下黃),不引入任何套件 ──
function quadrantPng(size = 128) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const q = (x, y) => (y < size / 2
    ? (x < size / 2 ? [255, 0, 0] : [0, 255, 0])
    : (x < size / 2 ? [0, 0, 255] : [255, 255, 0]));
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) { const [r, g, b] = q(x, y); raw[p++] = r; raw[p++] = g; raw[p++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

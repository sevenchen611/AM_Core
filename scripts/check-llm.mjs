// core/llm.js 的實測檢查(需要真金鑰,會實際呼叫 API)
//   node scripts/check-llm.mjs
//
// 為什麼需要這支:「後端宣告 supportsImages: true」與「callRaw 真的把圖送出去」
// 是兩件事。曾經發生過 minimax 後端宣告不支援圖片、實作也默默丟掉 imagePaths;
// 一旦有人把旗標翻過來,模型看不到圖卻照樣掰出答案,而且不會報錯。
// 這支對每個「宣告看得見圖」的後端送一張自製的四象限彩圖,答不出來就當場失敗。
// 換 LLM 型號、加新後端之後請跑一次。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createLlm } from '../core/llm.js';

// ── 讀 .env(不印任何金鑰)────────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
try {
  for (const ln of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = ln.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
} catch { /* Render 上沒有 .env 檔,環境變數已在 process.env */ }

// ── 造一張四象限彩圖(左上紅 右上綠 左下藍 右下黃)──────────────
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
function quadrantPng(size = 128) {
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

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const EXPECT = ['紅', '綠', '藍', '黃'];
// 四色皆出現、且順序正確。亂猜幾乎不可能,所以答對＝真的看到圖了。
const sawImage = (t) => {
  const at = EXPECT.map((c) => t.indexOf(c));
  return at.every((i) => i >= 0) && at.every((v, i, a) => i === 0 || a[i - 1] < v);
};

let failed = 0;
const report = (ok, label, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(38)} ${detail}`);
  if (!ok) failed += 1;
};

const llm = createLlm({ env, logger: quiet });
console.log('鏈序:', llm.backends.map((b) => `${b.name}(${b.model}${b.supportsImages ? ',👁' : ''})`).join(' → '), '\n');
if (!llm.available) { console.error('❌ 沒有任何可用後端 —— 檢查 .env 的金鑰。'); process.exit(1); }

// 1) 文字:每家單獨呼叫
console.log('── 文字 ──');
for (const b of llm.backends) {
  const one = createLlm({ env: { ...env, AMCORE_LLM_CHAIN: b.name }, logger: quiet });
  const r = await one.selfTest();
  report(r.ok, `${b.name} 文字`, r.ok ? `backend=${r.backend}` : r.error.slice(0, 90));
}

// 2) 備援:把鏈首弄壞,下一個必須接手
console.log('\n── 備援 ──');
if (llm.backends.length >= 2) {
  const [first, second] = llm.backends;
  const broken = { ...env, AMCORE_LLM_CHAIN: `${first.name},${second.name}` };
  const KEY_OF = { minimax: 'MINIMAX_API_KEY', gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
  broken[KEY_OF[first.name]] = 'deliberately-invalid-key';
  const r = await createLlm({ env: broken, logger: quiet }).selfTest();
  report(r.ok && r.backend === second.name, `${first.name} 壞掉 → ${second.name} 接手`, r.ok ? `backend=${r.backend}` : r.error.slice(0, 90));
} else {
  console.log('⏭  只有一個後端,跳過(補上第二把金鑰才有備援)');
}

// 3) 視覺:凡宣告看得見圖的後端,都得真的看得見
console.log('\n── 視覺(宣告 supportsImages 者逐一實測)──');
const imgPath = path.join(os.tmpdir(), `am-llm-vision-${process.pid}.png`);
fs.writeFileSync(imgPath, quadrantPng());
try {
  const visionBackends = llm.backends.filter((b) => b.supportsImages);
  if (!visionBackends.length) console.log('⏭  沒有宣告支援圖片的後端');
  for (const b of visionBackends) {
    const one = createLlm({ env: { ...env, AMCORE_LLM_CHAIN: b.name }, logger: quiet });
    try {
      const t = await one.completeText({
        system: '你是影像辨識器。',
        userContent: '這張圖被切成四個象限,每個象限一個純色。照「左上、右上、左下、右下」的順序,只回答四個顏色名稱,用頓號分隔。',
        maxTokens: 2000,
        imagePaths: [imgPath],
      });
      report(sawImage(t), `${b.name} 看得到圖`, `「${t.slice(0, 40)}」`);
    } catch (e) {
      report(false, `${b.name} 看得到圖`, e.message.slice(0, 90));
    }
  }

  // 4) 沒有視覺後端時,必須明確拒絕,不可讓瞎子作答
  const blindOnly = llm.backends.find((b) => !b.supportsImages);
  if (blindOnly) {
    const one = createLlm({ env: { ...env, AMCORE_LLM_CHAIN: blindOnly.name }, logger: quiet });
    try {
      await one.completeText({ system: 'x', userContent: 'y', imagePaths: [imgPath] });
      report(false, `只給 ${blindOnly.name} 卻要看圖`, '竟然沒擋下來');
    } catch (e) {
      report(/沒有支援圖片/.test(e.message), `只給 ${blindOnly.name} 卻要看圖`, '正確拒絕');
    }
  }
} finally {
  try { fs.unlinkSync(imgPath); } catch {}
}

console.log(failed ? `\n❌ ${failed} 項失敗` : '\n✅ 全部通過');
process.exit(failed ? 1 : 0);

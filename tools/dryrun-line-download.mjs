// dryrun: core/line.js downloadLineContent —— LINE 媒體內容「未就緒(202/空 body)」重試邏輯。
// 起因(2026-07-11):forest 會議錄音抓太快拿到空 buffer,AssemblyAI upload 422 / Gemini
// upload 400「No file found」全滅。此測用 mock fetch 釘住:未就緒會重試、就緒即回、
// 持續空會誠實丟錯、真正的非 2xx 直接丟錯。
import assert from 'node:assert';
import { createLine } from '../core/line.js';

const silent = { warn() {}, log() {}, error() {} };
const line = createLine({ channelAccessToken: 'test-token', channelSecret: 'x', logger: silent });

// 依序回傳預先排好的 responses;記錄呼叫次數。
function mockFetch(sequence) {
  let i = 0;
  const calls = { n: 0 };
  globalThis.fetch = async () => {
    calls.n += 1;
    const spec = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    const bytes = spec.bytes || 0;
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? (spec.contentType || 'audio/mp4') : null) },
      text: async () => spec.body || '',
      arrayBuffer: async () => new ArrayBuffer(bytes),
    };
  };
  return calls;
}

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`  ✓ ${name}`); }
  catch (e) { fail += 1; console.log(`  ✗ ${name} — ${e.message}`); }
}

const opts = { tries: 5, baseDelay: 1 }; // baseDelay 1ms:測試不真的等

await check('202 轉檔中 → 空 body → 就緒(有 bytes):重試後成功,共 3 次', async () => {
  const calls = mockFetch([{ status: 202 }, { status: 200, bytes: 0 }, { status: 200, bytes: 1024 }]);
  const res = await line.downloadLineContent('m1', opts);
  assert.strictEqual(res.buffer.byteLength, 1024, 'buffer 應有 1024 bytes');
  assert.strictEqual(res.contentType, 'audio/mp4');
  assert.strictEqual(calls.n, 3, `應重試到第 3 次,實際 ${calls.n}`);
});

await check('第一次就有 bytes:立即回,不重試', async () => {
  const calls = mockFetch([{ status: 200, bytes: 2048 }]);
  const res = await line.downloadLineContent('m2', opts);
  assert.strictEqual(res.buffer.byteLength, 2048);
  assert.strictEqual(calls.n, 1, `應只呼叫 1 次,實際 ${calls.n}`);
});

await check('持續 2xx 空 body:重試耗盡後誠實丟錯(訊息含「尚未就緒」)', async () => {
  const calls = mockFetch([{ status: 200, bytes: 0 }]);
  await assert.rejects(
    () => line.downloadLineContent('m3', opts),
    (e) => /尚未就緒/.test(e.message),
    '應丟出「尚未就緒」錯誤',
  );
  assert.strictEqual(calls.n, opts.tries, `應試滿 ${opts.tries} 次,實際 ${calls.n}`);
});

await check('持續 202:同樣重試耗盡後丟錯', async () => {
  mockFetch([{ status: 202 }]);
  await assert.rejects(() => line.downloadLineContent('m4', opts), (e) => /尚未就緒/.test(e.message));
});

await check('403 等真正的非 2xx:立即丟錯,不重試', async () => {
  const calls = mockFetch([{ status: 403, body: 'forbidden' }]);
  await assert.rejects(
    () => line.downloadLineContent('m5', opts),
    (e) => /LINE content download failed: 403/.test(e.message),
  );
  assert.strictEqual(calls.n, 1, `403 應只呼叫 1 次(不重試),實際 ${calls.n}`);
});

await check('500 → 就緒:非 202 的可重試性(目前設計 5xx 不重試,立即丟)', async () => {
  // 釘住現行設計:只有 202/空 body 會重試;5xx 視為真失敗立即丟(下載走 webhook 背景,
  // 由 LINE 端最終一致性 + 使用者重傳兜底)。若日後要對 5xx 重試,改這裡。
  const calls = mockFetch([{ status: 500, body: 'err' }]);
  await assert.rejects(() => line.downloadLineContent('m6', opts), (e) => /failed: 500/.test(e.message));
  assert.strictEqual(calls.n, 1);
});

console.log(`\nline-download: ${pass}/${pass + fail} pass`);
if (fail) process.exit(1);

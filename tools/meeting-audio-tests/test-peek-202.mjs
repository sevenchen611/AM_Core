import assert from 'node:assert';
import { createLine } from 'file:///D:/Codex_project/AM_Core/core/line.js';

const m4aHead = Uint8Array.from([0,0,0,0x20,0x66,0x74,0x79,0x70,0x4d,0x34,0x41,0x20,0,0,0,0]);
let calls = 0;
// 前兩次回 202(轉檔中),第三次才 206
globalThis.fetch = async (url, opts) => {
  calls++;
  const range = opts?.headers?.Range;
  if (calls <= 2) return { ok:false, status:202, arrayBuffer:async()=>new ArrayBuffer(0), text:async()=>'', headers:{get:()=>null}, body:{cancel:async()=>{}} };
  return { ok:true, status:206, arrayBuffer:async()=>m4aHead.slice(0,64).buffer, text:async()=>'', headers:{get:()=>'audio/x-m4a'}, body:{cancel:async()=>{}} };
};

const line = createLine({ channelAccessToken:'t', channelSecret:'s' });
// 縮短延遲以便測試快速跑完
const head = await line.peekLineContent('mid', 64, { tries:5, baseDelay:50 });
const b = Buffer.from(head);
assert.equal(calls, 3, `應在第 3 次(202,202,206)成功,實際打了 ${calls} 次`);
assert.equal(b.slice(4,8).toString('latin1'), 'ftyp', '應拿到 m4a 檔頭');
console.log(`✅ peek 對 202 有耐心:重試 ${calls} 次後拿到檔頭 ftyp`);

// 全程 202 → 回空(不誤判)
calls = 0;
globalThis.fetch = async () => ({ ok:false, status:202, arrayBuffer:async()=>new ArrayBuffer(0), text:async()=>'', headers:{get:()=>null}, body:{cancel:async()=>{}} });
const empty = await line.peekLineContent('mid2', 64, { tries:3, baseDelay:50 });
assert.equal(empty.byteLength, 0, '全程 202 應回空 ArrayBuffer');
console.log('✅ 全程 202 → 回空(交呼叫端退路,不誤判)');
console.log('\n2/2 通過');

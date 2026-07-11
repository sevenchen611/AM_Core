// dryrun: modules/media —— 事件關聯解析器 resolveEvent(階段 1:時間鄰近 + LINE 回覆)。
// 釘住:回覆綁定最強、真事件優先於閒聊、時間窗外或分數過低 → 孤兒。
import assert from 'node:assert';
import { __test } from '../modules/media/index.js';

const { resolveEvent, MEDIA_CFG } = __test;
const W = MEDIA_CFG.windowMs;         // 600000 (10 分)
const T = 1_700_000_000_000;          // 固定基準時間(ms),測試確定性
const at = (min) => T + min * 60_000; // T + N 分

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`); }
  catch (e) { fail += 1; console.log(`  ✗ ${name} — ${e.message}`); }
}

check('LINE 回覆:引用某訊息 → 直接鎖定,不看時間(即使 9 分遠、非事件)', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: 'Lreply' },
    candidates: [
      { messagePageId: 'p-near', lineMessageId: 'Lx', time: at(1), eventful: false },
      { messagePageId: 'p-reply', lineMessageId: 'Lreply', time: at(9), eventful: false },
    ],
  });
  assert.strictEqual(r?.eventMessageId, 'p-reply');
  assert.strictEqual(r.reason, 'reply');
});

check('真事件(5分)贏過較近的閒聊(1分)——eventfulness 加權', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: '' },
    candidates: [
      { messagePageId: 'p-event', lineMessageId: '', time: at(-5), eventful: true },  // 0.6*0.5+0.4*1 = 0.70
      { messagePageId: 'p-chat', lineMessageId: '', time: at(1), eventful: false },   // 0.6*0.9+0.4*0.3 = 0.66
    ],
  });
  assert.strictEqual(r?.eventMessageId, 'p-event', `應選真事件,實得 ${r?.eventMessageId}`);
});

check('都是閒聊時,選最近的(且分數過門檻)', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: '' },
    candidates: [
      { messagePageId: 'p-1min', lineMessageId: '', time: at(1), eventful: false },   // 0.66
      { messagePageId: 'p-8min', lineMessageId: '', time: at(-8), eventful: false },  // 0.6*0.2+0.12 = 0.24
    ],
  });
  assert.strictEqual(r?.eventMessageId, 'p-1min');
});

check('時間窗外(15分)→ 無候選 → 孤兒(null)', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: '' },
    candidates: [{ messagePageId: 'p-far', lineMessageId: '', time: at(15), eventful: true }],
  });
  assert.strictEqual(r, null);
});

check('只有很遠的閒聊(9分,分數 0.18 < 0.4)→ 孤兒(null)', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: '' },
    candidates: [{ messagePageId: 'p-9min', lineMessageId: '', time: at(9), eventful: false }],
  });
  assert.strictEqual(r, null);
});

check('完全無候選 → 孤兒(null)', () => {
  assert.strictEqual(resolveEvent({ photo: { time: T }, candidates: [] }), null);
});

check('回覆的 quotedMessageId 對不到候選 → 退回時間鄰近', () => {
  const r = resolveEvent({
    photo: { time: T, quotedMessageId: 'Lghost' },
    candidates: [{ messagePageId: 'p-near', lineMessageId: 'Lx', time: at(1), eventful: true }], // 0.6*0.9+0.4 = 0.94
  });
  assert.strictEqual(r?.eventMessageId, 'p-near');
  assert.strictEqual(r.reason, 'time+eventful');
});

console.log(`\nmedia: ${pass}/${pass + fail} pass`);
if (fail) process.exit(1);

// dryrun: media 的純函式(resolveEvent / semanticSim)+ construction 的 matchPhotoToContext。
// 事件關聯:回覆綁定最強、時間×eventfulness×語意、孤兒判定;語意可讓對題的遠事件贏過較近的閒聊。
import assert from 'node:assert';
import { __test as media } from '../modules/media/index.js';
import { __test as con } from '../modules/construction/classify.js';

const { resolveEvent, semanticSim, MEDIA_CFG } = media;
const { matchPhotoToContext } = con;
const W = MEDIA_CFG.windowMs;
const T = 1_700_000_000_000;
const at = (min) => T + min * 60_000;

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`); }
  catch (e) { fail += 1; console.log(`  ✗ ${name} — ${e.message}`); }
}

// ── semanticSim ──
check('semanticSim:2 詞命中 1 → 0.5', () => assert.strictEqual(semanticSim(['漏水', '磁磚'], '301房漏水'), 0.5));
check('semanticSim:空詞或空文字 → 0', () => {
  assert.strictEqual(semanticSim([], 'x'), 0);
  assert.strictEqual(semanticSim(['a'], ''), 0);
});

// ── resolveEvent ──
check('LINE 回覆 → 直接鎖定(不看時間)', () => {
  const r = resolveEvent({ photo: { time: T, quotedMessageId: 'Lr' }, candidates: [
    { messagePageId: 'p-near', lineMessageId: 'Lx', time: at(1), eventful: false, text: '' },
    { messagePageId: 'p-reply', lineMessageId: 'Lr', time: at(9), eventful: false, text: '' },
  ] });
  assert.strictEqual(r?.eventMessageId, 'p-reply');
  assert.strictEqual(r.reason, 'reply');
});

check('真事件(5分)贏過較近的閒聊(1分)', () => {
  const r = resolveEvent({ photo: { time: T, quotedMessageId: '' }, candidates: [
    { messagePageId: 'p-event', lineMessageId: '', time: at(-5), eventful: true, text: '' },  // 0.4*0.5+0.3 = 0.50
    { messagePageId: 'p-chat', lineMessageId: '', time: at(1), eventful: false, text: '' },    // 0.4*0.9+0.09 = 0.45
  ] });
  assert.strictEqual(r?.eventMessageId, 'p-event');
});

check('語意對題的遠事件(8分)贏過較近的閒聊(1分)——視覺標籤消歧義', () => {
  const r = resolveEvent({ photo: { time: T, quotedMessageId: '', topic: '漏水', tags: ['漏水', '磁磚'] }, candidates: [
    { messagePageId: 'p-leak', lineMessageId: '', time: at(-8), eventful: true, text: '301房浴室漏水' }, // 0.08+0.3+0.3*0.667=0.58
    { messagePageId: 'p-chat', lineMessageId: '', time: at(1), eventful: false, text: '好喔' },          // 0.45
  ] });
  assert.strictEqual(r?.eventMessageId, 'p-leak');
  assert.strictEqual(r.reason, 'time+semantic');
});

check('都是閒聊 → 選最近的(過門檻)', () => {
  const r = resolveEvent({ photo: { time: T }, candidates: [
    { messagePageId: 'p-1', lineMessageId: '', time: at(1), eventful: false, text: '' },
    { messagePageId: 'p-8', lineMessageId: '', time: at(-8), eventful: false, text: '' },
  ] });
  assert.strictEqual(r?.eventMessageId, 'p-1');
});

check('時間窗外(15分)→ 孤兒(null)', () => {
  assert.strictEqual(resolveEvent({ photo: { time: T }, candidates: [{ messagePageId: 'p', lineMessageId: '', time: at(15), eventful: true, text: '' }] }), null);
});
check('只有很遠的閒聊(9分,分數 0.13)→ 孤兒(null)', () => {
  assert.strictEqual(resolveEvent({ photo: { time: T }, candidates: [{ messagePageId: 'p', lineMessageId: '', time: at(9), eventful: false, text: '' }] }), null);
});
check('無候選 → 孤兒(null)', () => assert.strictEqual(resolveEvent({ photo: { time: T }, candidates: [] }), null));

// ── construction.matchPhotoToContext ──
const CTX = {
  spaces: [{ id: 's1', name: '301房', alias: '3F-01' }, { id: 's2', name: '浴室' }],
  workItems: [{ id: 'w1', name: '防水' }],
};
check('照片標籤命中空間名 → 對到空間', () => {
  const r = matchPhotoToContext({ topic: '漏水', caption: '301房浴室滲水', tags: ['漏水'] }, CTX);
  assert.strictEqual(r.space?.id, 's1');
});
check('照片命中空間別名 → 對到空間', () => {
  const r = matchPhotoToContext({ caption: '3F-01 現場照', tags: [] }, CTX);
  assert.strictEqual(r.space?.id, 's1');
});
check('命中工項名 → 對到工項', () => {
  const r = matchPhotoToContext({ topic: '防水施作', tags: ['防水'] }, CTX);
  assert.strictEqual(r.work_item?.id, 'w1');
});
check('無關照片 → 空間/工項皆 null', () => {
  const r = matchPhotoToContext({ topic: '貓', tags: ['寵物'] }, CTX);
  assert.strictEqual(r.space, null);
  assert.strictEqual(r.work_item, null);
});

console.log(`\nmedia: ${pass}/${pass + fail} pass`);
if (fail) process.exit(1);

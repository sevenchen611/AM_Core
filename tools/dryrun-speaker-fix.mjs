// modules/meetings/speaker-fix — 離線驗證(不打真 API)。
// 執行:node tools/dryrun-speaker-fix.mjs
//
// 盯著最容易錯的地方:
//   · A↔B 對調不得塌陷成同一人(單次同步置換)
//   · 三方輪換 A→B→C→A
//   · 合併(兩講者填同名)
//   · 改成全新名字(未命名的「講者C」→ 真名)
//   · 全名(其勳(現場工務主任))與裸名(其勳)兩種寫法都要換
//   · 講者對照表用結構重建:槽位標籤「講者A/B/C」不可被當人名換掉
//   · 假 Notion 跑完整改寫:參與者/對照/摘要/筆記/逐字稿/待辦文字 + 待辦庫負責人

import assert from 'node:assert';
import {
  splitNameRole, buildFull, parseLegend, planReplacements, applyReplacements, rebuildLegend,
  rewriteMeetingSpeakers,
} from '../modules/meetings/speaker-fix.js';

// async-aware:同步與非同步測試都要能真的抓到失敗(否則 async 斷言會變 unhandled rejection、假綠燈)
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

const LEGEND = '【講者對照】講者A=Seven(負責人)  講者B=其勳(現場工務主任)  講者C=講者C';

check('splitNameRole:全名/裸名/無角色', () => {
  assert.deepEqual(splitNameRole('其勳(現場工務主任)'), { name: '其勳', role: '現場工務主任' });
  assert.deepEqual(splitNameRole('講者C'), { name: '講者C', role: '' });
  assert.equal(buildFull('小明', '木工'), '小明(木工)');
  assert.equal(buildFull('講者C', ''), '講者C');
});

check('parseLegend:三位講者(含未命名 C)', () => {
  const { speakers } = parseLegend(LEGEND);
  assert.equal(speakers.length, 3);
  assert.deepEqual(speakers[0], { label: 'A', name: 'Seven', role: '負責人', full: 'Seven(負責人)' });
  assert.equal(speakers[2].full, '講者C');
});

// ── A↔B 對調:最關鍵的塌陷測試 ──
check('對調 A↔B:單次置換不塌陷', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs } = planReplacements(speakers, [
    { label: 'A', full: '其勳(現場工務主任)' },
    { label: 'B', full: 'Seven(負責人)' },
  ]);
  const t = 'Seven(負責人)確認做法;其勳(現場工務主任)提議改管。Seven說沒問題,其勳補充。';
  const out = applyReplacements(t, pairs);
  assert.equal(out, '其勳(現場工務主任)確認做法;Seven(負責人)提議改管。其勳說沒問題,Seven補充。', out);
});

check('對調後再套一次不會累積錯誤(冪等性由使用者重存保證,但單次必須正確)', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs } = planReplacements(speakers, [{ label: 'A', full: '其勳(現場工務主任)' }, { label: 'B', full: 'Seven(負責人)' }]);
  assert.equal(applyReplacements('其勳:好', pairs), 'Seven:好'); // 裸名前綴也換
});

// ── 三方輪換 A→B→C→A ──
check('三方輪換 A→B→C→A', () => {
  const spk = parseLegend('【講者對照】講者A=甲(工)  講者B=乙(電)  講者C=丙(水)').speakers;
  const { pairs } = planReplacements(spk, [
    { label: 'A', full: '丙(水)' }, // A 槽現在是丙
    { label: 'B', full: '甲(工)' }, // B 槽現在是甲
    { label: 'C', full: '乙(電)' }, // C 槽現在是乙
  ]);
  assert.equal(applyReplacements('甲(工)和乙(電)還有丙(水)', pairs), '丙(水)和甲(工)還有乙(電)');
  assert.equal(applyReplacements('甲、乙、丙', pairs), '丙、甲、乙'); // 裸名同步輪換
});

// ── 合併:兩講者填同名 ──
check('合併:B 併入 A(AssemblyAI 過度切分)', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs, newSpeakers } = planReplacements(speakers, [{ label: 'B', full: 'Seven(負責人)' }]);
  const out = applyReplacements('Seven(負責人)開場,其勳(現場工務主任)其實也是Seven。其勳說。', pairs);
  assert.equal(out, 'Seven(負責人)開場,Seven(負責人)其實也是Seven。Seven說。', out);
  assert.equal(newSpeakers[1].full, 'Seven(負責人)');
});

// ── 改成全新名字 ──
check('未命名 講者C → 真名', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs } = planReplacements(speakers, [{ label: 'C', full: '小明(木工)' }]);
  assert.equal(applyReplacements('講者C:謝謝', pairs), '小明(木工):謝謝');
});

// ── 對照表結構重建:槽位標籤不可被換掉 ──
check('rebuildLegend:保留槽位標籤,不把「講者C」當人名換', () => {
  const { speakers } = parseLegend(LEGEND);
  const { newSpeakers } = planReplacements(speakers, [{ label: 'C', full: '小明(木工)' }]);
  const rebuilt = rebuildLegend('【講者對照】', newSpeakers);
  assert.equal(rebuilt, '【講者對照】講者A=Seven(負責人)  講者B=其勳(現場工務主任)  講者C=小明(木工)', rebuilt);
  // 反例:若誤用自由置換,「講者C=講者C」會變「小明(木工)=小明(木工)」→ 這正是要避免的
});

// ── 全名先於裸名(避免內層裸名被拆) ──
check('全名優先:其勳(現場工務主任)整段吃掉,不會先中裸名', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs } = planReplacements(speakers, [{ label: 'B', full: '阿明(師傅)' }]);
  assert.equal(applyReplacements('其勳(現場工務主任)', pairs), '阿明(師傅)');
});

// ── no-op:沒改就沒有 pairs ──
check('沒有變更 → pairs 為空', () => {
  const { speakers } = parseLegend(LEGEND);
  const { pairs } = planReplacements(speakers, [{ label: 'A', full: 'Seven(負責人)' }]);
  assert.equal(pairs.length, 0);
});

// ══ 假 Notion:完整改寫一頁 ══
function fakeNotion() {
  // 一頁:參與者屬性 + 對照段落 + 摘要 bullet + 逐字稿 + 待辦;外加一個待辦庫
  const page = { id: 'PG', properties: { '參與者': { type: 'rich_text', rich_text: rt('Seven(負責人)、其勳(現場工務主任)') } } };
  const mk = (id, type, txt, extra = {}) => ({ id, type, has_children: false, [type]: { rich_text: rt(txt), ...extra } });
  const blocks = [
    mk('b-legend', 'paragraph', LEGEND),
    mk('b-sum', 'bulleted_list_item', 'Seven確認D區做法;其勳說明冷水進來'),
    mk('b-tr', 'paragraph', 'Seven(負責人):好。其勳(現場工務主任):嗯。講者C:哎。'),
    mk('b-todo', 'to_do', '確認冷水進入點(其勳) 期限:2026-07-18', { checked: false }),
  ];
  const tasks = [
    { id: 't1', properties: { '內容': { title: rt('確認冷水進入點') }, '負責人': { rich_text: rt('其勳') } } },
  ];
  const patched = { props: {}, blocks: {}, tasks: {} };
  function rt(s) { return [{ type: 'text', text: { content: s }, plain_text: s }]; }
  const readText = (arr) => (arr || []).map((x) => x.plain_text || x.text?.content || '').join('');

  const notionRequest = async (path, opts = {}) => {
    const m = opts.method || 'GET';
    if (path.startsWith('/v1/blocks/') && path.includes('/children')) {
      if (path.includes('PG')) return { results: blocks, has_more: false };
      return { results: [], has_more: false };
    }
    if (path.startsWith('/v1/pages/PG') && m === 'GET') return page;
    if (path.startsWith('/v1/pages/PG') && m === 'PATCH') { patched.props = opts.body.properties; return {}; }
    if (path.startsWith('/v1/blocks/') && m === 'PATCH') {
      const id = decodeURIComponent(path.split('/v1/blocks/')[1]);
      patched.blocks[id] = readText(Object.values(opts.body)[0].rich_text);
      return {};
    }
    if (path.includes('/query')) {
      // 關聯查詢 → 空(模擬 per-group);內容比對 → 依 title
      const f = opts.body?.filter;
      if (f?.relation) return { results: [] };
      if (f?.title?.equals) return { results: tasks.filter((t) => readText(t.properties['內容'].title) === f.title.equals) };
      return { results: [] };
    }
    if (path.startsWith('/v1/pages/t') && m === 'PATCH') { patched.tasks[path.split('/v1/pages/')[1].replace(/\?.*/, '')] = readText(opts.body.properties['負責人'].rich_text); return {}; }
    throw new Error(`unexpected: ${m} ${path}`);
  };
  return { notionRequest, patched };
}

check('完整改寫:A↔B 對調,全頁一致 + 待辦庫負責人同步', async () => {
  const { notionRequest, patched } = fakeNotion();
  const stats = await rewriteMeetingSpeakers({
    notionRequest, pageId: 'PG',
    fixes: [{ label: 'A', full: '其勳(現場工務主任)' }, { label: 'B', full: 'Seven(負責人)' }],
    tasksDataSourceId: 'TDS',
  });
  // 參與者:全名對調
  assert.equal(readTextOf(patched.props['參與者'].rich_text), '其勳(現場工務主任)、Seven(負責人)');
  // 對照:結構重建,槽位保留
  assert.equal(patched.blocks['b-legend'], '【講者對照】講者A=其勳(現場工務主任)  講者B=Seven(負責人)  講者C=講者C');
  // 摘要:裸名對調
  assert.equal(patched.blocks['b-sum'], '其勳確認D區做法;Seven說明冷水進來');
  // 逐字稿:全名前綴對調,講者C 不動
  assert.equal(patched.blocks['b-tr'], '其勳(現場工務主任):好。Seven(負責人):嗯。講者C:哎。');
  // 待辦文字:括號內負責人對調
  assert.equal(patched.blocks['b-todo'], '確認冷水進入點(Seven) 期限:2026-07-18');
  // 待辦庫負責人:其勳 → Seven(靠內容比對,因 per-group 無關聯)
  assert.equal(patched.tasks['t1'], 'Seven');
  assert.equal(stats.blocksChanged, 4);
  assert.equal(stats.tasksChanged, 1);
  function readTextOf(arr) { return (arr || []).map((x) => x.text?.content || x.plain_text || '').join(''); }
});

check('完整改寫:沒改 → noop,不動任何 block', async () => {
  const { notionRequest, patched } = fakeNotion();
  const stats = await rewriteMeetingSpeakers({
    notionRequest, pageId: 'PG',
    fixes: [{ label: 'A', full: 'Seven(負責人)' }, { label: 'B', full: '其勳(現場工務主任)' }, { label: 'C', full: '講者C' }],
    tasksDataSourceId: 'TDS',
  });
  assert.equal(stats.noop, true);
  assert.equal(Object.keys(patched.blocks).length, 0);
});

// ── 依序執行(await 每個,sync/async 都能真的抓到失敗)──
let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name}\n     ${e.message}`); }
}
console.log(`\n${pass}/${tests.length} checks passed.`);
process.exit(pass === tests.length ? 0 : 1);

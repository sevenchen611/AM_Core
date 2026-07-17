// modules/meetings — 本地乾跑驗證(不需真憑證、不打真 API、不碰 BuildAM)
// 用假 fetch 模擬 AssemblyAI/Gemini/MiniMax/Notion/LINE,配「真的」core/llm.js,
// 把 onAudio → consumeRoster → publishMeeting 與 processRecording 兩條路徑整條跑通。
//
// 執行:node tools/dryrun-meetings.mjs   (全過 = meetings 管線 OK)
//
// 盯著三件事:
//   1. 鏈序與換後端(摘要走 quality、名單走預設鏈;鏈頭掛掉要有人接手)
//   2. 行業味只來自 tenant.config.meetings —— 沒設定的租戶絕不退回工程味
//   3. 🚨 模型把答案裹進 {"result":{…}} 時,絕不可產出一頁空白會議記錄
//      (extractFirstJsonObject 抓第一個 '{' = 那層包裝 → 每個欄位都消失 → 靜默空白)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLlm } from '../core/llm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = (await import(`file://${path.join(HERE, '../modules/meetings/index.js').replace(/\\/g, '/')}`)).default;
const cfgOf = (n) => JSON.parse(fs.readFileSync(path.join(HERE, `../tenants/${n}.json`), 'utf8')).config;
const ENG_CFG = cfgOf('engineering');
const FOREST_CFG = cfgOf('forest');

const results = [];
const check = (name, ok, extra = '') => results.push([Boolean(ok), name, ok ? '' : extra]);

// ── 假回應 ────────────────────────────────────────────────
const GOOD = { title: '週會', type: '審圖', minutes: [{ heading: '區段', points: ['要點'] }], highlights: ['重點'], conclusions: ['結論'], todos: [{ content: '待辦', owner: '', due: '' }], nextMeeting: '' };
const ROSTER = { kind: 'work', topic: '', project: '', speakers: [{ order: 1, name: 'Seven', role: '', gender: '男' }], keyterms: ['Seven'] };
const wrap = (o) => JSON.stringify({ result: o });   // 模型多包一層

const ok200 = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const dead = (s = 401) => ({ ok: false, status: s, json: async () => ({ error: 'boom' }), text: async () => '{"error":"boom"}' });
const isRoster = (p) => p.includes('請抽取成 JSON');

// llmBackends[name] : false=掛掉 | 'wrapped'=包一層 | 預設=正常
// geminiAudio      : true | false=掛掉 | 'wrapped'=包一層
function build({ llmBackends = {}, geminiAudio = true, driveConfigured = false, tenantCfg = ENG_CFG, tenantKey = 'engineering' } = {}) {
  const hits = [], line = [], notionPages = [];
  const sent = { keyterms: null, assemblyPrompt: '', summaryPrompt: '' };

  const llmReply = (name, prompt, shell) => {
    hits.push(name);
    const mode = llmBackends[name];
    if (mode === false) return dead();
    const payload = isRoster(prompt) ? ROSTER : GOOD;
    return shell(mode === 'wrapped' && !isRoster(prompt) ? wrap(payload) : JSON.stringify(payload));
  };
  const asChat = (t) => ok200({ choices: [{ message: { content: t } }] });
  const asGem = (t) => ok200({ candidates: [{ content: { parts: [{ text: t }] } }] });

  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;

    // AssemblyAI 轉寫(不是 LLM,永遠成功)
    if (u.includes('api.assemblyai.com/v2/upload')) return ok200({ upload_url: 'https://cdn/x' });
    if (u.endsWith('api.assemblyai.com/v2/transcript')) { sent.keyterms = body.keyterms_prompt || []; sent.assemblyPrompt = body.prompt || ''; return ok200({ id: 'tid' }); }
    if (u.includes('api.assemblyai.com/v2/transcript/')) return ok200({ status: 'completed', text: 't', utterances: [{ speaker: 'A', text: '大家好' }] });

    // Gemini 直讀音檔(Files API)
    if (u.includes('upload/v1beta/files')) return geminiAudio === false ? dead() : ok200({ file: { name: 'files/1', uri: 'u', state: 'ACTIVE' } });

    // LLM 後端
    if (u.includes('llm-gateway.assemblyai.com')) { const p = body.messages[0].content; if (!isRoster(p)) sent.summaryPrompt = p; return llmReply('assemblyai', p, asChat); }
    if (u.includes('api.minimax.io')) return llmReply('minimax', body.messages[0].content, asChat);
    if (u.includes('generativelanguage.googleapis.com/v1beta/models')) {
      const parts = body.contents[0].parts;
      if (parts.some((p) => p.file_data)) {                       // 直讀音檔的產生呼叫
        if (geminiAudio === false) return dead();
        return asGem(geminiAudio === 'wrapped' ? wrap(GOOD) : JSON.stringify(GOOD));
      }
      const p = parts.map((x) => x.text || '').join('');
      if (!isRoster(p)) sent.summaryPrompt = p;
      return llmReply('gemini', p, asGem);
    }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const llm = createLlm({
    env: { ASSEMBLYAI_API_KEY: 'A', GEMINI_API_KEY: 'G', MINIMAX_API_KEY: 'M' },
    logger: { log() {}, warn() {}, error() {} },
    sleep: async () => {},   // 不要真的睡過退避
  });

  MOD.init({
    llm,
    notionRequest: async (p, o = {}) => {
      if (o.method === 'POST' && p === '/v1/pages') { notionPages.push(o.body.properties); return { id: 'pg', url: 'https://n/pg' }; }
      if (o.method === 'PATCH' && p.startsWith('/v1/blocks/')) return { results: [{ id: 'b' }] };
      if (p.startsWith('/v1/pages/')) return { id: 'pg', url: 'https://n/pg', public_url: null };
      if (p.includes('/query')) return { results: [] };
      throw new Error(`unexpected notion: ${p}`);
    },
    pushLineMessage: async (_g, t) => { line.push(t); },
    assemblyKey: 'A', geminiKey: 'G', geminiModel: 'gemini-2.5-flash',
    ensureDriveFolder: async () => 'f',
    uploadToDrive: async () => ({ webViewLink: driveConfigured ? 'https://drive/rec' : '' }),
    publicBaseUrl: '', publicLinkSecret: '',
  });

  const tenant = { key: tenantKey, config: tenantCfg, dataSources: { meetings: 'M', tasks: 'T', projects: 'P' }, driveConfigured, driveRootFolderId: 'root' };
  return { hits, line, notionPages, sent, tenant, count: (n) => hits.filter((h) => h === n).length };
}

const audio = { buffer: Buffer.from('a'), filename: 'a.m4a', contentType: 'audio/mp4', senderName: 'Seven', groupId: 'G' };
async function assemblyPath(h) {
  await MOD.onAudio({ tenant: h.tenant, ...audio, binding: { projectPageId: 'proj', pageId: 'bind' }, ackSent: true });
  await MOD.consumeRoster({ tenant: h.tenant, groupId: 'G', text: '1.Seven 男', senderName: 'Seven' });
}
const geminiPath = (h) => MOD.processRecording({ tenant: h.tenant, ...audio, binding: { projectPageId: 'proj', pageId: 'bind' } });

const title = (h) => h.notionPages[0]['會議'].title[0].text.content;
const mtype = (h) => h.notionPages[0]['類型'].select.name;
const lineHas = (h, s) => h.line.some((t) => t.includes(s));
const ENG_TERMS = /茲心園|草悟道|葉綠宿|泥作|矽酸鈣板|工地檢討|審圖|交底|室內裝修|工程/;

// ══ 1. 鏈序 ══════════════════════════════════════════════
{
  const h = build(); await assemblyPath(h);
  check('名單解析走預設鏈(minimax 當頭)', h.hits[0] === 'minimax', `實得 ${h.hits[0]}`);
  check("摘要 profile:'quality'(assemblyai gateway 當頭)", h.hits[1] === 'assemblyai', `實得 ${h.hits[1]}`);
  check('沒有多餘的後端呼叫', h.hits.length === 2, JSON.stringify(h.hits));
}

// ══ 2. 鏈頭掛掉 → 換後端 ══════════════════════════════════
{
  const h = build({ llmBackends: { assemblyai: false } }); await assemblyPath(h);
  check('gateway 掛掉 → 直連 gemini 接手', h.hits.slice(1).join(',') === 'assemblyai,gemini', JSON.stringify(h.hits));
  check('轉寫沒被摘要拖下水,會議記錄仍產出', h.notionPages.length > 0);
  check('LINE 仍收到完整會議記錄', lineHas(h, '📋 會議記錄'));
  check('沒有誤報「整理失敗」', !lineHas(h, '整理失敗'));
}

// ══ 3. 全鏈皆掛 → 誠實的失敗訊息 ══════════════════════════
{
  const allDead = { assemblyai: false, gemini: false, minimax: false };
  const a = build({ llmBackends: allDead, geminiAudio: false, driveConfigured: false }); await assemblyPath(a);
  const m1 = a.line.find((t) => t.includes('整理失敗')) || '';
  check('全鏈皆掛仍發出「整理失敗」', Boolean(m1));
  check('沒留底時誠實說「沒有」留底', m1.includes('沒有') && m1.includes('留底'), m1);
  check('沒留底時不謊稱「已存 Drive」', !m1.includes('已存 Drive'), m1);
  check('全鏈皆掛時不寫任何 Notion 頁', a.notionPages.length === 0, `寫了 ${a.notionPages.length} 頁`);

  const b = build({ llmBackends: allDead, geminiAudio: false, driveConfigured: true }); await assemblyPath(b);
  const m2 = b.line.find((t) => t.includes('整理失敗')) || '';
  check('有留底時才說「已存 Drive」', m2.includes('已存 Drive'), m2);
}

// ══ 4. 完整流程 ══════════════════════════════════════════
{
  const h = build(); await assemblyPath(h);
  check('會議頁標題正確', /^\d{4}-\d{2}-\d{2} 週會$/.test(title(h)), title(h));
  check('類型來自 LLM 且守白名單', mtype(h) === '審圖', mtype(h));
  check('建了會議頁 + 1 筆待辦', h.notionPages.length === 2, `${h.notionPages.length} 頁`);
  check('待辦內容正確', h.notionPages[1]['內容'].title[0].text.content === '待辦');
  check('AssemblyAI 會議待辦保留負責群組', h.notionPages[1]['負責群組']?.relation?.[0]?.id === 'bind');
  check('有回「收到與會資訊」', lineHas(h, '✅ 收到與會資訊'));
  check('LINE 會議記錄含 Notion 連結', lineHas(h, '📄 Notion 完整記錄'));

  const g = build(); await geminiPath(g);
  check('Gemini 直轉路徑也產出會議頁', g.notionPages.length === 2);
  check('Gemini 會議待辦保留負責群組', g.notionPages[1]['負責群組']?.relation?.[0]?.id === 'bind');
  check('Gemini 直轉路徑推 LINE', g.line.some((t) => t.includes('📋 會議記錄')));
}

// ══ 5. 行業味只來自 tenant.config ═════════════════════════
{
  const e = build(); await assemblyPath(e);
  check('engineering 帶工程詞庫進 AssemblyAI', e.sent.keyterms.includes('矽酸鈣板') && e.sent.keyterms.includes('茲心園'));
  check('engineering 摘要 prompt 是工程領域', /室內裝修工程會議/.test(e.sent.summaryPrompt));

  const f = build({ tenantCfg: FOREST_CFG, tenantKey: 'forest' }); await assemblyPath(f);
  check('forest keyterms 無工程術語', !f.sent.keyterms.some((t) => ENG_TERMS.test(t)), JSON.stringify(f.sent.keyterms));
  check('forest AssemblyAI prompt 中性', !ENG_TERMS.test(f.sent.assemblyPrompt), f.sent.assemblyPrompt);
  check('forest 摘要 prompt 無工程字眼', !ENG_TERMS.test(f.sent.summaryPrompt), f.sent.summaryPrompt.match(ENG_TERMS)?.[0]);
  check('forest 類型 = 一般會議(LLM 回「審圖」也被擋)', mtype(f) === '一般會議', mtype(f));

  // ⚠ 必須傳 null:undefined 會觸發 build() 的預設參數把 ENG_CFG 補回去,就測不到無 config 路徑。
  const n = build({ tenantCfg: null, tenantKey: 'mystery' }); await assemblyPath(n);
  check('無 config 租戶 keyterms 中性', !n.sent.keyterms.some((t) => ENG_TERMS.test(t)), JSON.stringify(n.sent.keyterms));
  check('無 config 租戶摘要 prompt 中性', !ENG_TERMS.test(n.sent.summaryPrompt), n.sent.summaryPrompt.match(ENG_TERMS)?.[0]);
  check('無 config 租戶無白名單 → 採用 AI 類型', mtype(n) === '審圖', mtype(n));

  // 手誤的 config:每個欄位型別都錯。應靜默退回通用預設,而不是拋錯或漏出工程味。
  // (types 退回空陣列 = 沒有白名單 = 信任 AI 給的類型,與「無 config」同一條路,故不斷言類型。)
  const j = build({ tenantCfg: { meetings: { keyterms: 'not-an-array', types: 'nope', projectCodes: [] } }, tenantKey: 'junk' });
  let junkThrew = null;
  await assemblyPath(j).catch((e) => { junkThrew = e; });
  check('手誤的 config 不拋錯', !junkThrew, junkThrew?.message);
  check('手誤的 config 仍產出會議記錄', j.notionPages.length === 2, `${j.notionPages.length} 頁`);
  check('手誤的 config 不漏工程味', !j.sent.keyterms.some((t) => ENG_TERMS.test(t)) && !ENG_TERMS.test(j.sent.summaryPrompt));
}

// ══ 6. 🚨 模型把答案裹進 {"result":{…}} ═══════════════════
// 這是 required:['title','minutes'] 存在的唯一理由。拿掉它,下面每一條都會紅。
{
  // 6a. 鏈頭包一層 → 解析失敗 → 重試 → 換後端 → 拿到真內容
  const h = build({ llmBackends: { assemblyai: 'wrapped' } }); await assemblyPath(h);
  check('包一層的鏈頭 → 換後端接手', h.count('gemini') === 1, JSON.stringify(h.hits));
  check('包一層的鏈頭 → 同後端先重試一次', h.count('assemblyai') === 2, JSON.stringify(h.hits));
  check('包一層 → 絕不產出空白會議記錄', /週會$/.test(title(h)), title(h));
  check('包一層 → 待辦仍寫入', h.notionPages.length === 2, `${h.notionPages.length} 頁`);

  // 6b. 三家全包一層 + Gemini 直讀也包一層 → 誠實失敗,不寫空白頁
  const all = build({ llmBackends: { assemblyai: 'wrapped', gemini: 'wrapped', minimax: 'wrapped' }, geminiAudio: 'wrapped' });
  await assemblyPath(all);
  check('全都包一層 → 發出「整理失敗」', all.line.some((t) => t.includes('整理失敗')));
  check('全都包一層 → 一頁空白記錄都不准寫進 Notion', all.notionPages.length === 0, `寫了 ${all.notionPages.length} 頁`);

  // 6c. Gemini 直讀路徑(不經 llm.js,沒有 schema 保護)也要擋
  const g = build({ geminiAudio: 'wrapped' });
  let threw = null;
  await geminiPath(g).catch((e) => { threw = e; });
  check('Gemini 直讀包一層 → 拋錯而非靜默空白', Boolean(threw), '沒有拋錯');
  check('Gemini 直讀包一層 → 不寫 Notion 頁', g.notionPages.length === 0, `寫了 ${g.notionPages.length} 頁`);
}

// ══ 報告 ══
let pass = 0;
for (const [ok, name, extra] of results) { console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     ${extra}`}`); if (ok) pass++; }
console.log(`\n${pass}/${results.length} checks passed.`);
process.exit(pass === results.length ? 0 : 1);

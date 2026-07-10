// AM Platform 模組:meetings
// ─────────────────────────────────────────────────────────────────────────
// 會議錄音 → 反問「與會者(含發言順序)/主題」→ AssemblyAI 轉寫+講者分離
//   → 依發言順序對齊真名 → platform.llm 收斂署名摘要 → 建會議記錄(三分頁)+待辦 → 發布。
//   AssemblyAI(上傳/轉寫)失敗會自動改用 Gemini 直讀音檔備援(無署名逐字稿,但摘要/筆記/待辦照樣產出);
//   完全無 ASSEMBLYAI key 時走 Gemini 直轉。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入「共用能力」(所有租戶相同):notionRequest / pushLineMessage / llm / drive 助手 / 金鑰。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」:自己的 Notion 資料源(meetings/tasks/projects)、Drive 根資料夾。
//   - 「行業味」(會議類型、術語表、prompt 領域描述)一律來自 ctx.tenant.config.meetings,不寫在本檔。
//   - 模組狀態(會議待補 pending)一律以「(租戶, 群組)」為鍵,不同租戶不互相污染。
//
// 文字整理(摘要、與會名單)走 platform.llm 的統一備援鏈;只有「讀音檔」還自己打 Gemini,
// 因為 llm.js 不吃音訊。

import crypto from 'node:crypto';

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具(無外部相依)──────────────────────────────────────
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const todayStr = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const text = (c) => ({ type: 'text', text: { content: String(c).slice(0, 1900) } });
const para = (c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [text(c)] } });
const heading = (c) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: [text(c)] } });
const heading2 = (c) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [text(c)] } });
const bullet = (c) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [text(c)] } });
const todoBlock = (t) => ({ object: 'block', type: 'to_do', to_do: { rich_text: [text(`${t.content}${t.owner ? `(${t.owner})` : ''}${t.due ? ` 期限:${t.due}` : ''}`)], checked: false } });

const AUDIO_EXT = /\.(m4a|mp3|aac|wav|amr|ogg|mp4)$/i;
function isAudio(message) {
  if (message.type === 'audio') return true;
  return message.type === 'file' && AUDIO_EXT.test(message.fileName || '');
}

// Tab 1「摘要」:重點摘要 + 結論/收穫 + 待辦(checkbox)。標題依會議樣式(工作/分享)微調。
function summaryTabBlocks(parsed, kind = 'work') {
  const share = kind === 'share';
  const b = [];
  const highlights = (parsed.highlights || []).slice(0, 10);
  if (highlights.length) { b.push(heading2('💡 重點摘要')); highlights.forEach((h) => b.push(bullet(h))); }
  const conclusions = (parsed.conclusions || []).slice(0, 15);
  if (conclusions.length) { b.push(heading2(share ? '✅ 收穫與共識' : '✅ 主議題結論')); conclusions.forEach((c) => b.push(bullet(c))); }
  const todos = (parsed.todos || []).slice(0, 30);
  b.push(heading2(share ? '📅 後續行動/延伸(checkbox,已同步待辦任務資料庫)' : '📅 待辦(checkbox 即任務,已同步待辦任務資料庫)'));
  if (todos.length) todos.forEach((t) => b.push(todoBlock(t))); else b.push(para(share ? '(無後續行動)' : '(無待辦事項)'));
  return b;
}

// Tab 2「筆記」:依主題/空間分區的逐條詳細紀錄
function notesTabBlocks(parsed) {
  const minutes = (parsed.minutes || []).slice(0, 15);
  if (!minutes.length) return [para('(無分區筆記)')];
  const b = [];
  for (const sec of minutes) {
    b.push(heading(sec.heading || ''));
    (sec.points || []).slice(0, 30).forEach((p) => b.push(bullet(p)));
  }
  return b;
}

// 在頁面上加一個「可展開的標題區段」(toggle heading)當作一個 tab
async function appendToggleSection(pageId, title, blocks) {
  const res = await platform.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
    method: 'PATCH',
    body: { children: [{ object: 'block', type: 'heading_2', heading_2: { rich_text: [text(title)], is_toggleable: true } }] },
  });
  const toggleId = res.results?.[0]?.id;
  if (toggleId && blocks && blocks.length) await appendChildren(toggleId, blocks);
  return toggleId;
}

// 分批 append(Notion 單次 children 上限 100)
async function appendChildren(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 90) {
    await platform.notionRequest(`/v1/blocks/${encodeURIComponent(pageId)}/children`, {
      method: 'PATCH',
      body: { children: blocks.slice(i, i + 90) },
    });
  }
}

// AI 若已在待辦提到下次會議就不重複;否則把「約定的下次會議/回報時間」補成一條提醒待辦
function withNextMeetingTodo(parsed) {
  const nm = String(parsed.nextMeeting || '').trim();
  if (!nm) return parsed.todos || [];
  const todos = [...(parsed.todos || [])];
  const already = todos.some((t) => /提醒|下次|下週|下周/.test(String(t.content || '')));
  if (!already) {
    const due = (nm.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '';
    todos.push({ content: `在群組發送下次會議提醒(${nm})`, owner: '', due });
  }
  return todos;
}

// LINE 版會議記錄:只放「重點摘要 + 主議題結論 + 待辦」(不含分區筆記與逐字稿)
function meetingLineText({ parsed, legendLine, date, type, url, publicUrl, defaultTitle = '會議' }) {
  const L = [`📋 會議記錄|${date} ${parsed.title || defaultTitle}(${type})`];
  if (legendLine) L.push(`講者:${legendLine}`);
  const hi = parsed.highlights || [];
  if (hi.length) L.push(`\n💡 重點摘要\n${hi.map((h) => `・${h}`).join('\n')}`);
  const con = parsed.conclusions || [];
  if (con.length) L.push(`\n✅ 主議題結論\n${con.map((c) => `・${c}`).join('\n')}`);
  const todos = parsed.todos || [];
  L.push(`\n📅 待辦 ${todos.length} 項${todos.length ? '\n' + todos.map((t, n) => `${n + 1}. ${t.content}${t.owner ? `(${t.owner})` : ''}${t.due ? ` 期限${t.due}` : ''}`).join('\n') : ':(無)'}`);
  if (parsed.nextMeeting) L.push(`\n🔔 下次會議:${parsed.nextMeeting}`);
  if (publicUrl) L.push(`\n🌐 完整記錄(免帳號,可轉傳):${publicUrl}`);
  L.push(`${publicUrl ? '' : '\n'}📄 Notion 完整記錄(需帳號):${url}`);
  return L.join('\n');
}

// 依 LINE 單則上限分段(在換行處切,盡量不切斷句子);單行超長才硬切
function chunkText(str, max = 4800) {
  const chunks = [];
  let cur = '';
  for (const ln of str.split('\n')) {
    if (cur && cur.length + ln.length + 1 > max) { chunks.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${ln}` : ln;
    while (cur.length > max) { chunks.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// 把完整會議記錄(不含逐字稿)發到 LINE;過長自動分多則
async function sendMeetingToLine(groupId, parsed, c) {
  const parts = chunkText(meetingLineText({ parsed, ...c }));
  for (let i = 0; i < parts.length; i++) {
    const tag = parts.length > 1 ? `【會議記錄 ${i + 1}/${parts.length}】\n` : '';
    await platform.pushLineMessage(groupId, tag + parts[i]);
  }
}

// ── 行業味設定(tenants/<key>.json 的 config.meetings)────────
// 原則:程式通用,行業味進設定。此處的預設「不帶任何行業色彩」——沒設定的租戶
// 會拿到一份中性的會議格式,絕不可退回工程味(否則森在的營運晨會會被標成「工地檢討」)。
const GENERIC_MEETINGS_CONFIG = {
  domain: '會議',                    // 完整名詞片語,直接接在「這是一場」之後
  transcriptionHint: '繁體中文為主的會議錄音。', // 餵 AssemblyAI 的 prompt 開頭(語言/領域提示)
  keyterms: [],                      // 餵 AssemblyAI 的詞彙表:案場、術語等易聽錯的專有名詞
  types: [],                         // 允許的會議類型;空陣列 = 不限制,直接採用 AI 判定的類型
  defaultType: '一般會議',           // AI 給的類型不在 types 內(或沒給)時的退路
  defaultTitle: '會議',              // AI 沒給標題時的退路
  sectionBy: '主題',                 // 筆記如何分區
  sectionExample: '',                // 分區小標題的例子;空字串則 prompt 不寫例子
  detailFocus: '關鍵事實、數字、決定與負責人,以及每位與會者的主張與理由',
  workKindHint: '一般工作會議',      // 分辨 work/share 時,拿來當「work」的例子
  projectCodes: {},                  // { 代碼: [觸發詞…] };空 = 此租戶不做專案歸屬判斷
};

// 合併租戶設定與通用預設。型別不對的欄位一律退回預設,免得一個手誤的 json 讓整條路徑爆掉。
function meetingsCfg(tenant) {
  const c = (tenant && tenant.config && tenant.config.meetings) || {};
  return {
    ...GENERIC_MEETINGS_CONFIG,
    ...c,
    keyterms: Array.isArray(c.keyterms) ? c.keyterms.map(String) : GENERIC_MEETINGS_CONFIG.keyterms,
    types: Array.isArray(c.types) ? c.types.map(String).filter(Boolean) : GENERIC_MEETINGS_CONFIG.types,
    projectCodes: (c.projectCodes && typeof c.projectCodes === 'object' && !Array.isArray(c.projectCodes)) ? c.projectCodes : {},
  };
}

// 把允許的類型寫成 prompt 裡的一句指示。三種類型→「A|B|C 三選一」,一種→就那一種,沒設→讓 AI 自由命名。
const CN_NUM = ['', '', '二', '三', '四', '五', '六', '七', '八', '九'];
function typeInstruction(types) {
  if (!types.length) return '會議類型(15字內短詞)';
  if (types.length === 1) return types[0];
  const n = CN_NUM[types.length];
  return `${types.join('|')} ${n ? `${n}選一` : '擇一'}`;
}

// 工作型會議的最終類型:有白名單就守白名單,沒白名單就信任 AI,兩者皆空才用預設。
function workType(aiType, cfg) {
  const t = String(aiType || '').trim();
  if (cfg.types.length) return cfg.types.includes(t) ? t : cfg.defaultType;
  return t || cfg.defaultType;
}

// ── 待補資訊的會議(記憶體暫存,鍵=（租戶,群組）)──────────────
// 錄音已即時存 Drive 留底;若伺服器於等待中重啟,原檔仍在 Drive,重傳即可再觸發。
const pending = new Map();
const ROSTER_TIMEOUT_MS = 30 * 60 * 1000;
const pkey = (tenant, groupId) => `${(tenant && tenant.key) || 'default'}::${groupId}`;

function hasPending(tenant, groupId) {
  return Boolean(groupId && pending.has(pkey(tenant, groupId)));
}

function clearPending(key) {
  const e = pending.get(key);
  if (e?.timer) clearTimeout(e.timer);
  pending.delete(key);
}

// 收到會議錄音的反問文字(可在下載音檔「之前」先送,避免大檔處理中斷=全程無回應)
function rosterPrompt(filename) {
  return [
    `🎙 收到會議錄音「${filename}」,已收到並開始處理。為了把會議記錄做準,麻煩回覆兩件事:`,
    '',
    '1️⃣ 參與者有誰?請含性別、角色/職務,以及「發言順序」',
    '　　例:①昱晴 女 設計師 ②其勳 男 工地主任 ③阿明 男 木工師傅',
    '2️⃣ 這次會議的主題是什麼?',
    '　　(若是讀書會/分享會/座談等「分享型」聚會,主題註明即可,我會改用分享格式整理)',
    '',
    '(兩題可打在同一則訊息。若 30 分鐘內沒回覆,我會先用「講者A/B/C」直接整理,事後再補。)',
  ].join('\n');
}

// 綁定群收到音檔:存 Drive 留底 → 反問與會者/主題;無 AssemblyAI key 則走舊 Gemini 直轉。
// ctx: { tenant, buffer, filename, contentType, binding, senderName, groupId, ackSent }
// ackSent=true 表示外層已先送過反問訊息(大檔先回覆再處理),這裡就不重送。
async function onAudio(ctx) {
  const { tenant, buffer, filename, binding, senderName, groupId, ackSent } = ctx;
  let contentType = ctx.contentType;
  if (!platform.assemblyKey) {
    return processRecording({ tenant, buffer, filename, contentType, binding, senderName, groupId });
  }
  if (/x-m4a|m4a/i.test(contentType) || /\.(m4a|mp4)$/i.test(filename)) contentType = 'audio/mp4';

  let audioDriveUrl = '';
  try { audioDriveUrl = await archiveAudio(buffer, filename, contentType, tenant); }
  catch (e) { console.warn(`Meeting audio Drive backup failed: ${e.message}`); }

  const key = pkey(tenant, groupId);
  clearPending(key); // 同(租戶,群)若有上一份待補會議,以新錄音取代
  const entry = { tenant, buffer, filename, contentType, binding, senderName, groupId, audioDriveUrl, createdAt: Date.now() };
  entry.timer = setTimeout(() => {
    finalizeMeeting(key, '').catch((e) => console.warn(`meeting auto-finalize failed: ${e.message}`));
  }, ROSTER_TIMEOUT_MS);
  pending.set(key, entry);

  if (!ackSent) await platform.pushLineMessage(groupId, rosterPrompt(filename));
  console.log(`Meeting audio staged, awaiting roster (tenant=${tenant?.key || 'default'}, group=${groupId}).`);
}

// 群組下一則文字 = 與會資訊答覆 → 收斂成會議記錄
// ctx: { tenant, groupId, text, senderName }
async function consumeRoster(ctx) {
  const { tenant, groupId, senderName } = ctx;
  const answer = ctx.text;
  const key = pkey(tenant, groupId);
  if (!pending.has(key)) return;
  await platform.pushLineMessage(groupId, '✅ 收到與會資訊,葉小蝸開始整理(約 3-8 分鐘),完成後在此發布。');
  await finalizeMeeting(key, answer || '', senderName);
}

// 每則訊息(帶租戶脈絡):此(租戶,群)正在等會議與會資訊,且是文字 → 當作答覆收斂。回傳 true=已處理。
async function onMessage(ctx) {
  const { tenant, groupId, senderName } = ctx;
  const t = ctx.text;
  if (t && t.trim() && hasPending(tenant, groupId)) {
    await consumeRoster({ tenant, groupId, text: t, senderName });
    return true;
  }
  return false;
}

async function finalizeMeeting(key, rosterAnswer, answeredBy) {
  const entry = pending.get(key);
  if (!entry) return;
  clearPending(key);
  const { tenant, buffer, filename, contentType, binding, senderName, audioDriveUrl, groupId } = entry;
  const cfg = meetingsCfg(tenant);
  try {
    // 1. 解析與會資訊(主題/與會者/發言順序/專有詞/所屬專案)
    const roster = await parseRoster(rosterAnswer, cfg);
    // 專案歸屬:預設綁定專案,與會回覆若指名 ZS/HZ/SYS 則改掛
    let projectPageId = binding?.projectPageId || '';
    if (roster.projectCode) {
      const pid = await resolveProjectByCode(roster.projectCode, tenant);
      if (pid) projectPageId = pid;
    }
    // 2-4. 優先 AssemblyAI 轉寫+講者分離 → Gemini 署名整理;失敗則自動改 Gemini 直讀備援
    let parsed, diarized = '', legend = new Map();
    try {
      const tr = await transcribeWithAssembly({ buffer, filename, contentType, roster, cfg });
      legend = buildSpeakerLegend(tr.utterances, roster.speakers);
      diarized = renderDiarized(tr, legend);
      parsed = await summarize({ diarized, roster, legend, cfg });
    } catch (assemblyErr) {
      console.warn(`AssemblyAI path failed, fallback to Gemini-direct: ${assemblyErr.message}`);
      await platform.pushLineMessage(groupId, '⚠ 逐字轉寫服務忙線,改用備援方式整理(這次不附署名逐字稿),稍候發布。').catch(() => {});
      parsed = await geminiTranscribeParsed({ buffer, filename, contentType, roster, cfg });
    }
    if (roster.topic) parsed.title = roster.topic; // 使用者主題優先
    // 5. 落地 + 發布
    await publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, answeredBy, filename, audioDriveUrl, tenant, binding });
  } catch (error) {
    console.warn(`Meeting finalize failed (key=${key}): ${error.message}`);
    // 只有真的備份成功才敢說「已存 Drive」——沒留底時要明講,否則使用者會以為原檔還在而刪掉手機裡的錄音。
    const note = audioDriveUrl
      ? '錄音原檔已存 Drive,可重傳再試或聯絡 Seven。'
      : '⚠ 這次錄音「沒有」留底(此租戶未啟用 Drive 備份或備份失敗),請保留手機原檔並重新上傳。';
    await platform.pushLineMessage(groupId, `⚠ 會議記錄整理失敗(${error.message.slice(0, 90)})。${note}`).catch(() => {});
  }
}

// 會議樣式:分享型關鍵字(讀書會/心得分享等)→ 用「分享」格式;其餘一律「工作」。
const SHARE_HINT = /讀書會|分享會|分享型|心得|座談|沙龍|工作坊|讀經|讀書/;
const kindFromText = (s) => (SHARE_HINT.test(String(s || '')) ? 'share' : '');

// ── 與會資訊解析 ───────────────────────────────────────────
const ROSTER_SCHEMA = (codes) => ({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['work', 'share'] },
    topic: { type: 'string' },
    ...(codes.length ? { project: { type: 'string', enum: [...codes, ''] } } : {}),
    speakers: { type: 'array', items: { type: 'object', properties: { order: { type: 'number' }, name: { type: 'string' }, role: { type: 'string' }, gender: { type: 'string' } } } },
    keyterms: { type: 'array', items: { type: 'string' } },
  },
});

async function parseRoster(answer, cfg = GENERIC_MEETINGS_CONFIG) {
  const empty = { topic: '', speakers: [], keyterms: [], projectCode: '', kind: 'work' };
  if (!answer || !answer.trim()) return empty;
  const fallbackKind = kindFromText(answer) || 'work';
  if (!platform.llm?.available) return { topic: answer.trim().slice(0, 40), speakers: [], keyterms: [], projectCode: '', kind: fallbackKind };
  // 專案代碼是租戶特有的(工程租戶有 ZS/HZ/SYS 館別;森在沒有)→ 沒設定就整條規則不出現。
  const codes = Object.keys(cfg.projectCodes);
  const projectField = codes.length ? `"project":"${codes.join('|')} 或空字串",` : '';
  const projectRule = codes.length
    ? `\n- project:${codes.map((c, i) => `${i ? '' : '若'}提到${(cfg.projectCodes[c] || []).map((t) => `「${t}」`).join('或')}填 ${c}`).join(';')};沒提到就空字串。`
    : '';
  try {
    // 與會名單是短 prompt,走預設鏈就好(不指名 profile),別為了一行名單去燒 gateway 的錢。
    const j = await platform.llm.completeJson({
      system: `以下是使用者提供的一場會議/聚會的與會資訊。請抽取成 JSON:
{"kind":"work|share","topic":"主題(15字內)",${projectField}"speakers":[{"order":1,"name":"姓名","role":"職務/角色","gender":"男|女|"}],"keyterms":["需要被正確辨識的人名或專有名詞",...]}
規則:
- kind:${cfg.workKindHint}填 "work";讀書會、心得分享、座談、分享會等「分享/討論型」聚會填 "share";不確定填 "work"。${projectRule}
- speakers 依「發言順序」由小到大排列。
- keyterms 放所有人名與可能被聽錯的術語、案場名。`,
      userContent: answer.trim().slice(0, 1000),
      schema: ROSTER_SCHEMA(codes),
    });
    const code = String(j.project || '').trim().toUpperCase();
    return {
      topic: String(j.topic || '').trim(),
      projectCode: codes.includes(code) ? code : '',
      kind: (['work', 'share'].includes(j.kind) ? j.kind : '') || fallbackKind,
      speakers: Array.isArray(j.speakers) ? j.speakers.filter((s) => s && s.name).map((s, i) => ({
        order: Number(s.order) || i + 1, name: String(s.name).trim(), role: String(s.role || '').trim(), gender: String(s.gender || '').trim(),
      })).sort((a, b) => a.order - b.order) : [],
      keyterms: Array.isArray(j.keyterms) ? j.keyterms.map((k) => String(k).trim()).filter(Boolean) : [],
    };
  } catch (e) {
    console.warn(`parseRoster failed: ${e.message}`);
    return { topic: answer.trim().slice(0, 40), speakers: [], keyterms: [], projectCode: '', kind: fallbackKind };
  }
}

// 依館別代碼(ZS/HZ/SYS)找專案頁 id(總管群會議可指定歸屬專案)
async function resolveProjectByCode(code, tenant) {
  if (!code || !tenant?.dataSources?.projects) return '';
  try {
    const r = await platform.notionRequest(`/v1/data_sources/${encodeURIComponent(tenant.dataSources.projects)}/query`, {
      method: 'POST',
      body: { filter: { property: '館別代碼', rich_text: { equals: code } }, page_size: 1 },
    });
    return r.results?.[0]?.id || '';
  } catch (e) {
    console.warn(`resolveProjectByCode failed: ${e.message}`);
    return '';
  }
}

// 帶重試的 fetch:對暫時性失敗(網路例外、429、5xx、以及 AssemblyAI 上傳偶發的 422)自動重試
async function fetchRetry(url, opts, { tries = 3, label = 'request', baseDelay = 2000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    let retryable = true; // 網路例外預設可重試
    try {
      const r = await fetch(url, opts);
      if (r.ok) return r;
      last = new Error(`${label} ${r.status}: ${(await r.text()).slice(0, 160)}`);
      // 只有暫時性狀態才重試;其餘 4xx(如 401 金鑰錯)立即拋出
      retryable = r.status === 429 || r.status === 422 || r.status >= 500;
    } catch (e) { last = e; retryable = true; }
    if (!retryable) throw last;
    if (i < tries - 1) { console.warn(`${label} 第 ${i + 1} 次失敗,重試中: ${last.message}`); await new Promise((res) => setTimeout(res, baseDelay * (i + 1))); }
  }
  throw last;
}

// ── AssemblyAI 轉寫(預錄音,universal-3-5-pro + 講者分離)───────
async function transcribeWithAssembly({ buffer, filename, contentType, roster, cfg = GENERIC_MEETINGS_CONFIG }) {
  const auth = { Authorization: platform.assemblyKey }; // 原始 key,不加 Bearer

  // 1. 上傳原始位元組(非 multipart);上傳偶發 422/5xx 會自動重試
  const up = await fetchRetry('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: auth, body: buffer }, { tries: 4, label: 'AssemblyAI upload' });
  const uploadUrl = JSON.parse(await up.text()).upload_url;

  // 2. 提交(keyterms=人名+該租戶的專有名詞;prompt=領域提示+主題+與會者;省略 language_code 讓中英夾雜原生切換)
  const names = roster.speakers.map((s) => s.name);
  const keyterms = [...new Set([...names, ...roster.keyterms, ...cfg.keyterms])]
    .filter((t) => t && t.length <= 24).slice(0, 100);
  const who = roster.speakers.map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、');
  const promptText = [
    cfg.transcriptionHint,
    roster.topic ? `會議主題:${roster.topic}。` : '',
    who ? `與會者:${who}。` : '',
  ].join('').slice(0, 1400);

  const submit = await fetchRetry('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speech_models: ['universal-3-5-pro', 'universal-2'],
      speaker_labels: true,
      ...(keyterms.length ? { keyterms_prompt: keyterms } : {}),
      ...(promptText ? { prompt: promptText } : {}),
    }),
  }, { tries: 3, label: 'AssemblyAI submit' });
  const id = JSON.parse(await submit.text()).id;

  // 3. 輪詢(每 5 秒,上限 25 分鐘;長會議錄音需要較久)
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: auth });
    const res = await poll.json();
    if (res.status === 'completed') return res;
    if (res.status === 'error') throw new Error(`AssemblyAI transcript error: ${String(res.error).slice(0, 200)}`);
  }
  throw new Error('AssemblyAI 轉寫逾時(>25 分鐘)');
}

// 依「首次發言順序」把 Speaker A/B/C… 對齊使用者提供的與會者順序
function buildSpeakerLegend(utterances, speakers) {
  const legend = new Map();
  const order = [];
  for (const u of utterances || []) {
    const s = u.speaker;
    if (s != null && !order.includes(s)) order.push(s);
  }
  order.forEach((label, i) => {
    const person = speakers[i];
    legend.set(label, person ? `${person.name}${person.role ? `(${person.role})` : ''}` : `講者${label}`);
  });
  return legend;
}

function renderDiarized(tr, legend) {
  const us = tr.utterances || [];
  if (!us.length) return String(tr.text || '').slice(0, 60000);
  const lines = us.map((u) => `${legend.get(u.speaker) || `講者${u.speaker}`}:${String(u.text || '').trim()}`);
  return lines.join('\n').slice(0, 60000);
}

// ── 收斂逐字稿(署名摘要/決議/待辦)──────────────────────────
// schema 只描述形狀、不列 required:少一個 nextMeeting 就整場失敗,遠比一份少一欄的會議記錄糟。
// normalizeParsed 本來就容得下缺欄位。schema 的真正價值在 llm.js 那邊——它會把 schema 塞進
// prompt、寬鬆解析 JSON、解析失敗自動重試並換後端,這正是手寫 extractJson 做不到的。
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: { type: 'string' },
    minutes: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } } } },
    highlights: { type: 'array', items: { type: 'string' } },
    conclusions: { type: 'array', items: { type: 'string' } },
    todos: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } } } },
    nextMeeting: { type: 'string' },
  },
};

// profile:'quality' → assemblyai gateway 領銜、直連 gemini 接手。實測 27,000 字逐字稿:
// gateway 三模型 9/9 成功、輸出上看 12,718 tokens(故 maxTokens 不得低於 16000);
// MiniMax-M3 直連只有 1/3~2/3 吐得出 JSON。
async function summarize({ diarized, roster, legend, cfg = GENERIC_MEETINGS_CONFIG }) {
  const who = [...legend.values()].join('、');
  const j = await platform.llm.completeJson({
    system: meetingPrompt({ who, topic: roster.topic, today: todayStr(), kind: roster.kind, cfg }),
    userContent: `逐字稿:\n${diarized}`,
    schema: SUMMARY_SCHEMA,
    profile: 'quality',
    maxTokens: 16000,
  });
  return normalizeParsed(j);
}

// 會議記錄整理指示(AssemblyAI 逐字稿路徑與 Gemini 直轉路徑共用)。
// kind='work' → 工作/工程會議格式(定案、待辦);kind='share' → 分享/討論型格式(讀書會、心得分享)。
function meetingPrompt({ who, topic, today, kind = 'work', cfg = GENERIC_MEETINGS_CONFIG }) {
  const dateNote = `今天是 ${today}(西元年-月-日,台灣時間)。凡「下週三、明天、下個月」等相對日期,一律依今天換算成西元 YYYY-MM-DD,年份用今天的年份,不要用過去年份。`;
  if (kind === 'share') {
    return `這是一場「分享/討論型」聚會${who ? `(已標註講者的逐字稿)。與會/分享者:${who}` : '的錄音'}(例:讀書會、心得分享、座談)。${topic ? `主題:${topic}。` : ''}(繁體中文)
${dateNote}

請仔細聽/讀完整場,整理成適合「分享會」的記錄。要求:
- 依「分享者」或「主題」分段,逐條記錄每個人分享的重點、觀點、舉的例子/故事、引用的書或金句。一律用真名。
- 忠實保留每個人的個人觀點與差異,不要把大家的話合併成單一結論。寧可詳盡,不要過度濃縮。
- highlights:整場最有價值、最打動人的精華觀點(3-6 條)。
- conclusions:寫「共同收穫 / 共識 / 值得延伸的觀點」(分享會不一定有硬性定案,沒有就寫收穫)。
- todos:分享會通常較少;只有「後續行動、延伸閱讀、下次主題、個人承諾」才列,沒有就空陣列。
- 若約定了下次聚會時間,務必在 nextMeeting 寫出,並在 todos 補一條「在群組發送下次聚會提醒」。

只輸出 JSON,不要任何說明文字:
{
 "title":"主題(15字內)",
 "type":"讀書會|分享會|座談|討論會 擇一(或最貼切的短詞)",
 "minutes":[{"heading":"分享者或主題","points":["該人/該段的分享重點、例子、金句(含真名)","..."]}],
 "highlights":["整場精華觀點(3-6條)"],
 "conclusions":["共同收穫/共識/值得延伸的觀點"],
 "todos":[{"content":"後續行動/延伸閱讀/下次主題","owner":"承諾者真名或空字串","due":"YYYY-MM-DD 或空字串"}],
 "nextMeeting":"下次聚會時間(有約定才寫,否則空字串)"
}`;
  }
  return `這是一場${cfg.domain}${who ? `(已標註講者的逐字稿)。與會者:${who}` : '的錄音'}。${topic ? `會議主題:${topic}。` : ''}(繁體中文)
${dateNote}

請仔細聽/讀完整場,整理成結構化、可追蹤的會議記錄。要求:
- 逐條記錄討論脈絡與「具體細節」:${cfg.detailFocus}。寧可詳盡,不要過度濃縮。
- 依${cfg.sectionBy}分區段${cfg.sectionExample ? `(例:${cfg.sectionExample})` : ''},每區段一個小標題。
- 提到誰決定/負責/主張時,一律用真名。
- 每個主議題給出明確結論(定案內容)。
- 待辦事項要具體可追蹤,盡量指出負責人與期限。
- 若會議中約定了下次會議或回報時間,務必在 nextMeeting 寫出,並在 todos 補一條「在群組發送下次會議提醒」。

只輸出 JSON,不要任何說明文字:
{
 "title":"會議主題(15字內)",
 "type":"${typeInstruction(cfg.types)}",
 "minutes":[{"heading":"區段小標題","points":["逐條要點(含細節與真名)","..."]}],
 "highlights":["重點摘要(整場核心,3-6條)"],
 "conclusions":["主議題結論(每個主議題一條,含定案內容)"],
 "todos":[{"content":"待辦內容","owner":"負責人真名或空字串","due":"YYYY-MM-DD 或空字串"}],
 "nextMeeting":"下次會議/回報時間(有約定才寫,否則空字串)"
}`;
}

function normalizeParsed(j) {
  return {
    title: String(j.title || '').trim(),
    type: String(j.type || '').trim(),
    minutes: Array.isArray(j.minutes)
      ? j.minutes.filter((s) => s && s.heading).map((s) => ({
          heading: String(s.heading).trim(),
          points: Array.isArray(s.points) ? s.points.map((p) => String(p)).filter(Boolean) : [],
        }))
      : [],
    highlights: Array.isArray(j.highlights) ? j.highlights.map((h) => String(h)).filter(Boolean) : [],
    conclusions: Array.isArray(j.conclusions) ? j.conclusions.map((c) => String(c)).filter(Boolean) : [],
    todos: Array.isArray(j.todos) ? j.todos : [],
    nextMeeting: String(j.nextMeeting || '').trim(),
  };
}

// ── 每群一個獨立會議庫(真隔離)──────────────────────────────
// 讀 Notion property 純文字(title 或 rich_text)
const plainRich = (prop) => (prop?.rich_text || prop?.title || []).map((x) => x.plain_text || '').join('').trim();

// 新會議庫的欄位模板(與現行會議庫一致);有 projects 才加「專案」關聯
function meetingsDbProperties(tenant) {
  const cfg = meetingsCfg(tenant);
  const types = cfg.types.length ? cfg.types : [cfg.defaultType];
  return {
    '會議': { title: {} },
    '類型': { select: { options: types.map((name) => ({ name })) } },
    '日期': { date: {} },
    '參與者': { rich_text: {} },
    ...(tenant?.dataSources?.projects ? { '專案': { relation: { data_source_id: tenant.dataSources.projects, single_property: {} } } } : {}),
  };
}

// 在母頁下自動建一個「該群專屬」會議庫,回傳 data_source id
async function provisionMeetingsDb(tenant, groupName) {
  const created = await platform.notionRequest('/v1/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: tenant.meetingsParentPageId },
      title: [{ type: 'text', text: { content: `會議記錄 · ${groupName || '群組'}` } }],
      initial_data_source: { properties: meetingsDbProperties(tenant) },
    },
  });
  const dsId = created.data_sources?.[0]?.id;
  if (!dsId) throw new Error('provision meetings db: no data source id');
  console.log(`Provisioned per-group meetings DB「${groupName}」→ ${dsId}`);
  return dsId;
}

// 決定這則會議寫進哪個會議庫:
//  per-group 模式(tenant.meetingsParentPageId 有值 + 有 binding.pageId):每群一個獨立庫,第一次開會自動建、id 記回綁定頁「會議資料庫」欄。
//  否則:租戶預設庫(現行行為;未設 meetingsParentPageId 的租戶=BuildAM 現況,完全不受影響)。
async function resolveMeetingsTarget(tenant, binding) {
  const fallback = { dbId: tenant?.dataSources?.meetings, perGroup: false };
  if (!tenant?.meetingsParentPageId || !binding?.pageId) return fallback;
  try {
    const page = await platform.notionRequest(`/v1/pages/${encodeURIComponent(binding.pageId)}`, { method: 'GET' });
    const existing = plainRich(page.properties?.['會議資料庫']);
    if (existing) return { dbId: existing, perGroup: true };
    const groupName = plainRich(page.properties?.['群組名稱']);
    const dbId = await provisionMeetingsDb(tenant, groupName);
    try {
      await platform.notionRequest(`/v1/pages/${encodeURIComponent(binding.pageId)}`, {
        method: 'PATCH',
        body: { properties: { '會議資料庫': { rich_text: [text(dbId)] } } },
      });
    } catch (e) { console.warn(`⚠ 會議庫 id 未能寫回綁定頁(下次可能重建,請確認綁定庫有「會議資料庫」欄):${e.message}`); }
    return { dbId, perGroup: true };
  } catch (e) {
    console.warn(`resolveMeetingsTarget failed, fall back to default: ${e.message}`);
    return fallback;
  }
}

// 取 Notion 連結:若該頁已在 Notion 手動發佈到網頁,用其 public_url;否則用內部連結(需帳號)。
// (Notion API 無法發佈頁面——public_url 唯讀;真正的免帳號分享走下方「公開會議頁」。)
async function shareableUrl(pageId, fallbackUrl) {
  try {
    const p = await platform.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
    return p.public_url || fallbackUrl;
  } catch (e) {
    console.warn(`read public_url failed: ${e.message}`);
    return fallbackUrl;
  }
}

// ══ 公開會議頁(自架,免 Notion 帳號,連結可轉傳)══════════════
// 連結形如 /m/<32碼頁id>-<16碼簽章>。簽章用 platform.publicLinkSecret,
// 確保只有「我們發出的會議連結」能開,無法用別的 Notion 頁 id 亂猜/亂讀。
const normId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
function meetingSig(pageId) {
  return crypto.createHmac('sha256', platform.publicLinkSecret || '').update(`meeting:${normId(pageId)}`).digest('hex').slice(0, 16);
}
function publicMeetingUrl(pageId) {
  if (!platform.publicBaseUrl || !platform.publicLinkSecret) return '';
  return `${String(platform.publicBaseUrl).replace(/\/+$/, '')}/m/${normId(pageId)}-${meetingSig(pageId)}`;
}

async function readChildren(blockId) {
  let cursor, out = [];
  do {
    const r = await platform.notionRequest(`/v1/blocks/${encodeURIComponent(blockId)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, { method: 'GET' });
    out.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return out;
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const richText = (rt) => (rt || []).map((r) => r.plain_text || '').join('');

// Notion 區塊 → HTML(標題/條列/checkbox/段落)
function blocksToHtml(blocks) {
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const b of blocks) {
    const t = b[b.type];
    const txt = esc(richText(t?.rich_text));
    if (b.type === 'bulleted_list_item') { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${txt}</li>`; continue; }
    closeList();
    if (b.type === 'heading_2') html += `<h2>${txt}</h2>`;
    else if (b.type === 'heading_3') html += `<h3>${txt}</h3>`;
    else if (b.type === 'to_do') html += `<div class="todo"><input type="checkbox" disabled${t?.checked ? ' checked' : ''}><span>${txt}</span></div>`;
    else if (b.type === 'paragraph' && txt) html += `<p>${txt}</p>`;
  }
  closeList();
  return html;
}

// 讀會議頁的三個可展開區段,並把「摘要」內的待辦切出來 → 摘要/筆記/待辦/逐字稿 四段
async function buildPublicSections(pageId) {
  const top = await readChildren(pageId);
  const legend = top.filter((b) => b.type === 'paragraph')
    .map((b) => richText(b.paragraph?.rich_text)).find((s) => s.includes('【講者對照】')) || '';
  const sections = [];
  for (const tg of top.filter((b) => b.type === 'heading_2' && b.heading_2?.is_toggleable)) {
    const title = richText(tg.heading_2.rich_text);
    const kids = await readChildren(tg.id);
    if (title.includes('摘要')) {
      const i = kids.findIndex((b) => b.type === 'heading_2' && richText(b.heading_2?.rich_text).includes('待辦'));
      sections.push({ key: 'summary', title: '📄 摘要', blocks: i >= 0 ? kids.slice(0, i) : kids });
      if (i >= 0) sections.push({ key: 'todo', title: '📅 待辦事項', blocks: kids.slice(i + 1) });
    } else if (title.includes('筆記')) sections.push({ key: 'notes', title: '📝 筆記', blocks: kids });
    else if (title.includes('逐字稿')) sections.push({ key: 'transcript', title: '🎧 逐字稿', blocks: kids });
    else sections.push({ key: 'other', title, blocks: kids });
  }
  const order = { summary: 1, notes: 2, todo: 3, transcript: 4, other: 5 };
  sections.sort((a, b) => (order[a.key] || 9) - (order[b.key] || 9));
  return { legend, sections };
}

async function renderPublicMeetingHtml(pageId) {
  const page = await platform.notionRequest(`/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  const title = richText(page.properties?.['會議']?.title);
  if (!title) throw new Error('not a meeting page'); // 只服務會議頁,避免被拿去讀別的 Notion 頁
  const date = (page.properties?.['日期']?.date?.start || '').slice(0, 10);
  const who = richText(page.properties?.['參與者']?.rich_text);
  const type = page.properties?.['類型']?.select?.name || '';
  const { legend, sections } = await buildPublicSections(pageId);
  const body = sections.map((s) => `<details${s.key === 'summary' ? ' open' : ''}><summary>${esc(s.title)}</summary>`
    + `<div class="sec">${blocksToHtml(s.blocks) || '<p class="dim">(無內容)</p>'}</div></details>`).join('');
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
 :root{--bg:#f5f7f6;--card:#fff;--line:#e0e6e3;--green:#2e7d52;--ink:#22302a;--dim:#6b7a72}
 @media(prefers-color-scheme:dark){:root{--bg:#161a18;--card:#1e2422;--line:#2f3a35;--ink:#e6ece9;--dim:#9aa8a1}}
 *{box-sizing:border-box;margin:0}
 body{font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;background:var(--bg);color:var(--ink);line-height:1.65;padding:16px 14px 48px}
 .wrap{max-width:760px;margin:0 auto}
 header{border-bottom:2px solid var(--green);padding-bottom:12px;margin-bottom:16px}
 h1{font-size:20px;color:var(--green);line-height:1.35}
 .meta{font-size:13px;color:var(--dim);margin-top:6px}
 details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
 summary{cursor:pointer;padding:13px 14px;font-weight:700;font-size:15px;list-style:revert}
 summary::marker{color:var(--green)}
 .sec{padding:2px 16px 14px;border-top:1px solid var(--line)}
 .sec h2{font-size:15px;color:var(--green);margin:14px 0 6px}
 .sec h3{font-size:14px;margin:12px 0 4px}
 .sec p{font-size:14px;margin:8px 0;white-space:pre-wrap;word-break:break-word}
 .sec ul{margin:6px 0 6px 18px}
 .sec li{font-size:14px;margin:4px 0}
 .todo{display:flex;gap:8px;align-items:flex-start;font-size:14px;margin:6px 0}
 .todo input{margin-top:5px}
 .dim{color:var(--dim)}
 footer{margin-top:20px;font-size:13px;color:var(--dim);text-align:center}
 footer a{color:var(--green)}
</style></head><body><div class="wrap">
<header><h1>${esc(title)}</h1>
<div class="meta">${[date, type, who && `與會:${who}`].filter(Boolean).map(esc).join(' ・ ')}</div>
${legend ? `<div class="meta">${esc(legend)}</div>` : ''}
</header>
${body || '<p class="dim">(此會議尚無內容)</p>'}
<footer>🐌 葉小蝸自動整理 ・ <a href="${esc(page.url)}" target="_blank" rel="noopener">在 Notion 開啟(需帳號)</a></footer>
</div></body></html>`;
}

// GET /m/<32碼id>-<16碼簽章> → 公開會議頁。回傳 true=已處理。
async function handlePublicRequest(req, res, pathname) {
  const m = String(pathname).match(/^\/m\/([0-9a-f]{32})-([0-9a-f]{16})$/i);
  if (!m) return false;
  const [, id, sig] = m;
  const deny = () => { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset="utf-8"><p style="font-family:system-ui;padding:40px;text-align:center">找不到這份會議記錄(連結可能失效)。</p>'); };
  if (!platform.publicLinkSecret || meetingSig(id) !== sig.toLowerCase()) { deny(); return true; }
  try {
    const html = await renderPublicMeetingHtml(id);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html);
  } catch (e) {
    console.warn(`public meeting page failed: ${e.message}`);
    deny();
  }
  return true;
}

// ── 落地 + 發布 ────────────────────────────────────────────
async function publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, answeredBy, filename, audioDriveUrl, tenant, binding }) {
  const today = todayStr();
  const cfg = meetingsCfg(tenant);
  const { dbId: meetingsDb, perGroup } = await resolveMeetingsTarget(tenant, binding);
  const kind = roster?.kind === 'share' ? 'share' : 'work';
  // 工作型:守該租戶允許的類型(見 workType);分享型:用 AI 給的型別(讀書會/分享會…,Notion select 自動建選項),預設分享會
  const meetingType = kind === 'share' ? (parsed.type || '分享會') : workType(parsed.type, cfg);
  const defaultTitle = kind === 'share' ? '分享會' : cfg.defaultTitle;
  const legendLine = [...legend.entries()].map(([k, v]) => `講者${k}=${v}`).join('  ');
  const participantsText = roster.speakers.length
    ? roster.speakers.map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、')
    : (legendLine || `錄音提供:${senderName}`);
  parsed.todos = withNextMeetingTodo(parsed);

  const sourceBlocks = [
    para(`[來源] ${stamp()} 錄音「${filename}」由 ${senderName} 上傳;AssemblyAI 轉寫+講者分離,${answeredBy ? `${answeredBy} 提供與會資訊` : '未補與會資訊(逾時自動整理)'}`),
    ...(audioDriveUrl ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '🎙 錄音原檔(爭議時回放):' } }, { type: 'text', text: { content: filename, link: { url: audioDriveUrl } } }] } }] : []),
    ...(legendLine ? [para(`【講者對照】${legendLine}`)] : []),
    para('本會議分三段(點標題展開):📄 摘要、📝 筆記(分區詳細)、🎧 逐字稿(署名)。'),
  ];

  const meeting = await platform.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: meetingsDb },
      properties: {
        '會議': { title: [text(`${today} ${parsed.title || defaultTitle}`)] },
        '類型': { select: { name: meetingType } },
        '日期': { date: { start: today } },
        ...(projectPageId ? { '專案': { relation: [{ id: projectPageId }] } } : {}),
        '參與者': { rich_text: [text(participantsText)] },
      },
    },
  });
  // 同一頁三個可展開區段(tab):摘要 → 筆記 → 逐字稿
  await appendChildren(meeting.id, sourceBlocks);
  await appendToggleSection(meeting.id, '📄 摘要(會議記錄)', summaryTabBlocks(parsed, kind));
  await appendToggleSection(meeting.id, '📝 筆記(分區詳細記錄)', notesTabBlocks(parsed));
  const transcriptBlocks = [];
  for (let i = 0; i < diarized.length && transcriptBlocks.length < 90; i += 1900) {
    transcriptBlocks.push(para(diarized.slice(i, i + 1900)));
  }
  if (transcriptBlocks.length) {
    try { await appendToggleSection(meeting.id, '🎧 逐字稿(署名)', transcriptBlocks); }
    catch (e) { console.warn(`transcript section failed: ${e.message}`); }
  }

  // 待辦展開進待辦任務
  const todos = (parsed.todos || []).slice(0, 30);
  for (const t of todos) {
    await platform.notionRequest('/v1/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: tenant.dataSources.tasks },
        properties: {
          '內容': { title: [text(t.content)] },
          ...(projectPageId ? { '專案': { relation: [{ id: projectPageId }] } } : {}),
          '負責人': { rich_text: t.owner ? [text(t.owner)] : [] },
          '期限': /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? { date: { start: t.due } } : { date: null },
          '來源': { select: { name: '會議' } },
          '狀態': { select: { name: '待辦' } },
          // 待辦庫的「會議記錄」關聯指向預設會議庫;per-group 庫的會議頁不在其目標庫內,故略過關聯
          ...(perGroup ? {} : { '會議記錄': { relation: [{ id: meeting.id }] } }),
        },
      },
    }).catch((e) => console.warn(`todo create failed: ${e.message}`));
  }

  // LINE 推完整會議記錄(不含逐字稿),過長自動分段;附「自架公開頁(免帳號)」+「Notion 連結」
  const url = await shareableUrl(meeting.id, meeting.url);
  await sendMeetingToLine(groupId, parsed, { legendLine, date: today, type: meetingType, url, publicUrl: publicMeetingUrl(meeting.id), defaultTitle });
  console.log(`Meeting published (AssemblyAI): ${parsed.title}, ${todos.length} todos.`);
}

// 錄音原檔存 Drive「會議錄音/日期/」
async function archiveAudio(buffer, filename, contentType, tenant) {
  if (!tenant?.driveConfigured) return '';
  const folder = await platform.ensureDriveFolder('會議錄音', tenant.driveRootFolderId);
  const dayFolder = await platform.ensureDriveFolder(todayStr(), folder);
  const uploaded = await platform.uploadToDrive(buffer, filename, contentType, dayFolder);
  return uploaded.webViewLink || '';
}

// ── Gemini 直讀音檔(唯一還沒被 platform.llm 取代的路徑)──────
// llm.js 不吃音訊,所以這條備援仍自己打 Gemini Files API,也自己解析 JSON。
// Gemini 免費配額是「每分鐘」限流,故三個呼叫都必須帶 fetchRetry。
//
// Gemini 直接讀音檔 → 整理成 parsed(供「無 AssemblyAI key」與「AssemblyAI 失敗備援」共用)。
// 走 Google 網路(從雲端主機穩定),但無講者分離,故不產署名逐字稿。
async function geminiTranscribeParsed({ buffer, filename, contentType, roster, cfg = GENERIC_MEETINGS_CONFIG }) {
  if (/x-m4a|m4a/i.test(contentType) || /\.(m4a|mp4)$/i.test(filename)) contentType = 'audio/mp4';
  const boundary = `mtg${Date.now()}`;
  const meta = JSON.stringify({ file: { display_name: filename } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.from(buffer),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  // 這是「備援的備援」(AssemblyAI 全掛時的唯一活路),三個呼叫都必須耐得住暫時性失敗。
  const up = await fetchRetry('https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart', {
    method: 'POST', headers: { 'x-goog-api-key': platform.geminiKey, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  }, { tries: 3, label: 'Gemini upload', baseDelay: 5000 });
  let file = JSON.parse(await up.text()).file;
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    // 輪詢也要過 fetchRetry:否則一次 429 會讓 file.state 變 undefined、直接跳出迴圈當成失敗。
    const poll = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
      headers: { 'x-goog-api-key': platform.geminiKey },
    }, { tries: 3, label: 'Gemini file state' });
    file = await poll.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Gemini file state: ${file.state}`);
  const who = (roster?.speakers || []).map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、');
  const prompt = meetingPrompt({ who: '', topic: roster?.topic || '', today: todayStr(), kind: roster?.kind, cfg })
    + (who ? `\n與會者(供人名辨識,依發言順序):${who}` : '');
  const gen = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${platform.geminiModel}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': platform.geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: contentType, file_uri: file.uri } }, { text: prompt }] }] }),
  }, { tries: 5, label: 'Gemini generate', baseDelay: 6000 });
  const genJson = await gen.json();
  const raw = (genJson.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return normalizeParsed(JSON.parse((raw.replace(/```(json)?/gi, '').match(/\{[\s\S]*\}/) || ['{}'])[0]));
}

// ══ 後備:Gemini 直轉流程(無 AssemblyAI key 時使用)══
// ctx: { tenant, buffer, filename, contentType, binding, senderName, groupId }
async function processRecording({ tenant, buffer, filename, contentType, binding, senderName, groupId }) {
  if (/x-m4a|m4a/i.test(contentType) || /\.(m4a|mp4)$/i.test(filename)) contentType = 'audio/mp4';
  const cfg = meetingsCfg(tenant);
  const minutes = Math.round(buffer.byteLength / 1024 / 1024);
  await platform.pushLineMessage(groupId, `🎙 收到會議錄音「${filename}」,葉小蝸整理中(${minutes > 60 ? '較長錄音約 5-10 分鐘' : '約 3-5 分鐘'}),完成後在此發布。`);

  const parsed = await geminiTranscribeParsed({ buffer, filename, contentType, roster: {}, cfg });
  const today = todayStr();
  let audioDriveUrl = '';
  if (tenant?.driveConfigured) {
    try { audioDriveUrl = await archiveAudio(buffer, filename, contentType, tenant); }
    catch (error) { console.warn(`Meeting audio Drive upload failed: ${error.message}`); }
  }

  parsed.todos = withNextMeetingTodo(parsed);
  const meetingType = workType(parsed.type, cfg);
  const sourceBlocks = [
    para(`[來源] ${stamp()} 錄音「${filename}」由 ${senderName} 上傳,Gemini 轉寫提煉`),
    ...(audioDriveUrl ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '🎙 錄音原檔(爭議時回放):' } }, { type: 'text', text: { content: filename, link: { url: audioDriveUrl } } }] } }] : []),
    para('本會議分兩段(點標題展開):📄 摘要、📝 筆記(分區詳細)。此模式無署名逐字稿。'),
  ];
  const { dbId: meetingsDb, perGroup } = await resolveMeetingsTarget(tenant, binding);
  const meeting = await platform.notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: meetingsDb },
      properties: {
        '會議': { title: [text(`${today} ${parsed.title || cfg.defaultTitle}`)] },
        '類型': { select: { name: meetingType } },
        '日期': { date: { start: today } },
        ...(binding?.projectPageId ? { '專案': { relation: [{ id: binding.projectPageId }] } } : {}),
        '參與者': { rich_text: [text(`錄音提供:${senderName}`)] },
      },
    },
  });
  await appendChildren(meeting.id, sourceBlocks);
  await appendToggleSection(meeting.id, '📄 摘要(會議記錄)', summaryTabBlocks(parsed));
  await appendToggleSection(meeting.id, '📝 筆記(分區詳細記錄)', notesTabBlocks(parsed));

  const todos = (parsed.todos || []).slice(0, 30);
  for (const t of todos) {
    await platform.notionRequest('/v1/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: tenant.dataSources.tasks },
        properties: {
          '內容': { title: [text(t.content)] },
          ...(binding?.projectPageId ? { '專案': { relation: [{ id: binding.projectPageId }] } } : {}),
          '負責人': { rich_text: t.owner ? [text(t.owner)] : [] },
          '期限': /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? { date: { start: t.due } } : { date: null },
          '來源': { select: { name: '會議' } },
          '狀態': { select: { name: '待辦' } },
          ...(perGroup ? {} : { '會議記錄': { relation: [{ id: meeting.id }] } }),
        },
      },
    }).catch((e) => console.warn(`todo create failed: ${e.message}`));
  }

  const url = await shareableUrl(meeting.id, meeting.url);
  await sendMeetingToLine(groupId, parsed, { legendLine: '', date: today, type: meetingType, url, publicUrl: publicMeetingUrl(meeting.id), defaultTitle: cfg.defaultTitle });
  console.log(`Meeting processed (Gemini fallback): ${parsed.title}, ${todos.length} todos.`);
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'meetings',
  init,
  isAudio,             // (message) → bool:此訊息是否為會議音檔
  rosterPrompt,        // (filename) → string:反問與會者/主題的文字
  hasPending,          // (tenant, groupId) → bool
  onAudio,             // (ctx) 綁定群收到音檔 → 反問並暫存
  onMessage,           // (ctx) 每則訊息;若在等與會資訊則收斂,回傳 true=已處理
  provisionMeetingsDb, // (tenant, groupName) 手動預建某群的會議庫(選用)
  publicMeetingUrl,    // (pageId) → 自架公開頁連結(需 publicBaseUrl + publicLinkSecret)
  handlePublicRequest, // (req,res,pathname) GET /m/<id>-<sig> 公開會議頁;回 true=已處理
  consumeRoster,       // (ctx) 直接以與會資訊收斂發布(外層已判定 pending 時用)
  processRecording,    // (ctx) 無 AssemblyAI 時的 Gemini 直轉
};

// 測試用內部匯出(不影響正式流程)
export const __test = { meetingPrompt, normalizeParsed, withNextMeetingTodo, summarize, summaryTabBlocks, notesTabBlocks, publishMeeting, resolveMeetingsTarget, provisionMeetingsDb };

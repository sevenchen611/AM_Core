// AM Platform 模組:meetings
// 工程 AM 已直接使用本平台模組；不再維護正式下游 vendored 複製品（見 VENDORED.md）。
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
import { parseLegend, speakerWidgetHtml, handleSpeakerSave } from './speaker-fix.js';
import { createMeetingAdmin } from './admin.js';
import {
  MEETING_POLICY_VERSION,
  MEETING_ROLLOUT_MODES,
  normalizeMeetingMode,
  resolveMeetingRolloutPolicy,
} from './policy.js';

let platform = null;
let meetingAdminHandler = null;
function init(injected) {
  platform = injected;
  meetingAdminHandler = createMeetingAdmin(() => platform);
}
const aiForTenant = (tenant) => platform?.aiForTenant?.(tenant) || {
  assemblyKey: platform?.assemblyKey || '',
  geminiKey: platform?.geminiKey || '',
  meetingModel: platform?.geminiModel || 'gemini-2.5-flash',
};
const llmForTenant = (tenant) => platform?.llmForTenant?.(tenant) || platform?.llm;

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
  if (message.type === 'audio' || message.type === 'video') return true;
  return message.type === 'file' && AUDIO_EXT.test(message.fileName || '');
}

// LINE 原生 video 沒有 fileName，串流分派時也不會預先下載取得 MIME；
// 明確補成 video/mp4。若下載後已拿到 video/*，則必須保留，不能因副檔名 .mp4
// 被誤改成 audio/mp4（AssemblyAI 可抽音軌，Gemini 備援則需要正確 MIME）。
function normalizeMeetingContentType(contentType, filename, sourceIsVideo = false) {
  const current = String(contentType || '').trim();
  if (sourceIsVideo) return /^video\//i.test(current) ? current : 'video/mp4';
  if (/^video\//i.test(current)) return current;
  if (/x-m4a|m4a/i.test(current) || /\.(m4a|mp4)$/i.test(filename || '')) return 'audio/mp4';
  return current;
}

// Tab 1「摘要」:重點摘要 + 結論/收穫 + 待辦(checkbox)。標題依會議樣式(工作/分享)微調。
function formalTasksEnabled(tenant, binding = {}) {
  return resolveMeetingRolloutPolicy({ tenant, binding }).createFormalTasks;
}

function meetingRolloutPolicy(tenant, binding = {}, requestedMode) {
  return resolveMeetingRolloutPolicy({
    tenant,
    binding,
    ...(requestedMode === undefined ? {} : { requestedMode }),
  });
}

// A review session snapshots the effective mode at meeting creation time. This
// keeps an in-flight confirmation deterministic even if an administrator later
// changes the group's rollout setting. Old persisted sessions have no snapshot;
// they use the legacy-compatible tenant/binding policy (engineering=true stays
// full, formalTasksEnabled=false stays record-only).
function sessionMeetingMode(session) {
  const snapshot = normalizeMeetingMode(session?.meetingMode);
  if (snapshot) return snapshot;
  const legacyFormal = session?.tenant?.config?.meetings?.formalTasksEnabled;
  // A persisted/in-memory review session could only have existed in the old
  // flow after review was enabled. If a partial legacy payload omitted the
  // boolean, allow confirmation but fail closed on task creation.
  if (session?.status && legacyFormal === undefined) return MEETING_ROLLOUT_MODES.REVIEW_ONLY;
  return meetingRolloutPolicy(session?.tenant, session?.binding || {}).effectiveMode;
}

function sessionCanReview(session) {
  return [MEETING_ROLLOUT_MODES.REVIEW_ONLY, MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE]
    .includes(sessionMeetingMode(session));
}

function sessionCreatesFormalTasks(session) {
  return sessionMeetingMode(session) === MEETING_ROLLOUT_MODES.REVIEW_AND_CREATE;
}

function summaryTabBlocks(parsed, kind = 'work', { formalTasks = true } = {}) {
  const share = kind === 'share';
  const b = [];
  const highlights = (parsed.highlights || []).slice(0, 10);
  if (highlights.length) { b.push(heading2('💡 重點摘要')); highlights.forEach((h) => b.push(bullet(h))); }
  const conclusions = (parsed.conclusions || []).slice(0, 15);
  if (conclusions.length) { b.push(heading2(share ? '✅ 收穫與共識' : '✅ 主議題結論')); conclusions.forEach((c) => b.push(bullet(c))); }
  const todos = (parsed.todos || []).slice(0, 30);
  b.push(heading2(formalTasks
    ? (share ? '📅 後續行動/延伸(checkbox,已同步待辦任務資料庫)' : '📅 待辦(checkbox 即任務,已同步待辦任務資料庫)')
    : (share ? '📅 後續行動/延伸（候選，尚未建立正式待辦）' : '📅 待辦候選（尚未建立正式待辦）')));
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
  const L = [`📋 會議記錄|${date} ${parsed.title || defaultTitle}`];
  if (legendLine) L.push(`講者:${legendLine}`);
  const hi = parsed.highlights || [];
  if (hi.length) L.push(`\n💡 重點摘要\n${hi.map((h) => `・${h}`).join('\n')}`);
  const con = parsed.conclusions || [];
  if (con.length) L.push(`\n✅ 主議題結論\n${con.map((c) => `・${c}`).join('\n')}`);
  const todos = parsed.todos || [];
  L.push(`\n📅 待辦 ${todos.length} 項${todos.length ? '\n' + todos.map((t, n) => `${n + 1}. ${t.content}${t.owner ? `(${t.owner})` : ''}${t.due ? ` 期限${t.due}` : ''}`).join('\n') : ':(無)'}`);
  if (parsed.nextMeeting) L.push(`\n🔔 下次會議:${parsed.nextMeeting}`);
  if (publicUrl) L.push(`\n🌐 完整記錄(免帳號,可轉傳):${publicUrl}`);
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
const reviewSessions = new Map();
const reviewGroupMemberCache = new Map();
const ROSTER_TIMEOUT_MS = 30 * 60 * 1000;
const REVIEW_DECISION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const REVIEW_SESSION_MARKER = '[AM_MEETING_REVIEW_SESSION]';
const REVIEW_GROUP_MEMBER_CACHE_MS = 60 * 1000;
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
  const { tenant, buffer, audioMessageId, filename, binding, senderName, groupId, ackSent } = ctx;
  const rollout = meetingRolloutPolicy(tenant, binding || {});
  if (!rollout.enabled) {
    console.log(`Meeting audio ignored by rollout policy (tenant=${tenant?.key || 'default'}, group=${groupId}, mode=${rollout.effectiveMode}).`);
    return false;
  }
  const senderUserId = ctx.event?.source?.userId || '';
  const sourceIsVideo = ctx.message?.type === 'video';
  let contentType = normalizeMeetingContentType(ctx.contentType, filename, sourceIsVideo);
  // 無 AssemblyAI 金鑰 → Gemini 直讀備援(需要 buffer;串流路徑未帶 buffer 就下載一次)。
  if (!aiForTenant(tenant).assemblyKey) {
    let buf = buffer;
    if (!buf && audioMessageId) {
      const downloaded = await platform.downloadLineContent(audioMessageId);
      buf = downloaded.buffer;
      contentType = normalizeMeetingContentType(downloaded.contentType || contentType, filename, sourceIsVideo);
    }
    await processRecording({ tenant, buffer: buf, filename, contentType, binding, senderName, groupId, senderUserId, sourceIsVideo, meetingMode: rollout.effectiveMode });
    return true;
  }
  contentType = normalizeMeetingContentType(contentType, filename, sourceIsVideo);

  // 串流路徑(平台,大檔友善):先發反問、只存 messageId,轉寫時才「邊下載邊上傳」;
  //   Drive 留底改為「背景串流上傳」——收到錄音當下就開始備份,不擋反問、整檔不進記憶體。
  // buffer 路徑(相容):有 buffer(舊呼叫)維持原地存 Drive。
  let audioDriveUrl = '';
  if (buffer) {
    try { audioDriveUrl = await archiveAudio(buffer, filename, contentType, tenant); }
    catch (e) { console.warn(`Meeting audio Drive backup failed: ${e.message}`); }
  }

  const key = pkey(tenant, groupId);
  clearPending(key); // 同(租戶,群)若有上一份待補會議,以新錄音取代
  const entry = { tenant, buffer, audioMessageId, filename, contentType, sourceIsVideo, binding, senderName, senderUserId, groupId, audioDriveUrl, meetingMode: rollout.effectiveMode, policyVersion: MEETING_POLICY_VERSION, createdAt: Date.now() };
  if (!buffer && audioMessageId) {
    // 背景留底:即刻開始(不等與會回覆——就算沒人回、或伺服器中途重啟,原檔已在 Drive)。
    // 結果掛在 entry 上,finalize 發布前再收割;.catch 確保這個 promise 永不 reject。
    entry.drivePromise = streamArchiveAudio(tenant, audioMessageId, filename)
      .catch((e) => { console.warn(`Meeting audio Drive backup (stream) failed: ${e.message}`); return ''; });
  }
  entry.timer = setTimeout(() => {
    finalizeMeeting(key, '').catch((e) => console.warn(`meeting auto-finalize failed: ${e.message}`));
  }, ROSTER_TIMEOUT_MS);
  pending.set(key, entry);

  if (!ackSent) {
    try { await platform.pushLineMessage(groupId, rosterPrompt(filename)); }
    catch (error) { console.warn(`Meeting roster prompt push failed (group=${groupId}): ${error.message}`); }
  }
  console.log(`Meeting audio staged, awaiting roster (tenant=${tenant?.key || 'default'}, group=${groupId}, mode=${buffer ? 'buffer' : 'stream'}).`);
  return true;
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
  const { tenant, buffer, audioMessageId, filename, sourceIsVideo, binding, senderName, senderUserId, groupId, meetingMode } = entry;
  let contentType = entry.contentType;
  // Drive 留底:buffer 路徑在 onAudio 就存好;串流路徑在背景跑,發布/回報前限時收割。
  let audioDriveUrl = entry.audioDriveUrl || '';
  const cfg = meetingsCfg(tenant);
  try {
    // 1. 解析與會資訊(主題/與會者/發言順序/專有詞/所屬專案)
    const roster = await parseRoster(rosterAnswer, cfg, tenant);
    // 專案歸屬:預設綁定專案,與會回覆若指名 ZS/HZ/SYS 則改掛
    let projectPageId = binding?.projectPageId || '';
    if (roster.projectCode) {
      const pid = await resolveProjectByCode(roster.projectCode, tenant);
      if (pid) projectPageId = pid;
    }
    // 2-4. 優先 AssemblyAI 轉寫+講者分離 → Gemini 署名整理;失敗則自動改 Gemini 直讀備援
    let parsed, diarized = '', legend = new Map();
    try {
      const tr = await transcribeWithAssembly({ tenant, buffer, audioMessageId, filename, contentType, roster, cfg });
      legend = buildSpeakerLegend(tr.utterances, roster.speakers);
      diarized = renderDiarized(tr, legend);
      parsed = await summarize({ tenant, diarized, roster, legend, cfg });
    } catch (assemblyErr) {
      console.warn(`AssemblyAI path failed, fallback to Gemini-direct: ${assemblyErr.message}`);
      await platform.pushLineMessage(groupId, '⚠ 逐字轉寫服務忙線,改用備援方式整理(這次不附署名逐字稿),稍候發布。').catch(() => {});
      // 備援需要完整 buffer;串流路徑此時才下載一次(僅在 AssemblyAI 失敗的少見情況)。
      let buf = buffer;
      if (!buf && audioMessageId) {
        const downloaded = await platform.downloadLineContent(audioMessageId);
        buf = downloaded.buffer;
        contentType = normalizeMeetingContentType(downloaded.contentType || contentType, filename, sourceIsVideo);
      }
      parsed = await geminiTranscribeParsed({ tenant, buffer: buf, filename, contentType, sourceIsVideo, roster, cfg });
    }
    if (roster.topic) parsed.title = roster.topic; // 使用者主題優先
    // 5. 落地 + 發布(轉寫已花了幾分鐘,背景 Drive 備份通常早就完成;最多再等 2 分鐘)
    if (!audioDriveUrl && entry.drivePromise) audioDriveUrl = await raceTimeout(entry.drivePromise, 120000, '');
    await publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, senderUserId, answeredBy, filename, audioDriveUrl, tenant, binding, meetingMode });
  } catch (error) {
    console.warn(`Meeting finalize failed (key=${key}): ${error.message}`);
    // 只有真的備份成功才敢說「已存 Drive」——沒留底時要明講,否則使用者會以為原檔還在而刪掉手機裡的錄音。
    if (!audioDriveUrl && entry.drivePromise) audioDriveUrl = await raceTimeout(entry.drivePromise, 10000, '');
    const note = audioDriveUrl
      ? '錄音原檔已存 Drive，可重傳再試或聯絡系統管理者。'
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

async function parseRoster(answer, cfg = GENERIC_MEETINGS_CONFIG, tenant = null) {
  const empty = { topic: '', speakers: [], keyterms: [], projectCode: '', kind: 'work' };
  if (!answer || !answer.trim()) return empty;
  const fallbackKind = kindFromText(answer) || 'work';
  const llm = llmForTenant(tenant);
  if (!llm?.available) return { topic: answer.trim().slice(0, 40), speakers: [], keyterms: [], projectCode: '', kind: fallbackKind };
  // 專案代碼是租戶特有的(工程租戶有 ZS/HZ/SYS 館別;森在沒有)→ 沒設定就整條規則不出現。
  const codes = Object.keys(cfg.projectCodes);
  const projectField = codes.length ? `"project":"${codes.join('|')} 或空字串",` : '';
  const projectRule = codes.length
    ? `\n- project:${codes.map((c, i) => `${i ? '' : '若'}提到${(cfg.projectCodes[c] || []).map((t) => `「${t}」`).join('或')}填 ${c}`).join(';')};沒提到就空字串。`
    : '';
  try {
    // 與會名單是短 prompt,走預設鏈就好(不指名 profile),別為了一行名單去燒 gateway 的錢。
    const j = await llm.completeJson({
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

// 上傳音檔到 AssemblyAI /v2/upload,回傳 upload_url。
// buffer 有值 → 整包上傳(可重試);否則 → 串流 LINE 內容直灌(整檔不進記憶體)。
// 串流 body 不可重放,失敗時重新開一條串流再試(最多 3 次)。
async function uploadToAssembly({ buffer, audioMessageId, auth }) {
  if (buffer) {
    const up = await fetchRetry('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: auth, body: buffer }, { tries: 4, label: 'AssemblyAI upload' });
    return JSON.parse(await up.text()).upload_url;
  }
  if (!audioMessageId || typeof platform.streamLineContent !== 'function') throw new Error('no audio source for AssemblyAI upload');
  let last;
  for (let i = 0; i < 3; i += 1) {
    try {
      const { stream } = await platform.streamLineContent(audioMessageId);
      const up = await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: auth, body: stream, duplex: 'half' });
      if (!up.ok) throw new Error(`AssemblyAI upload ${up.status}: ${(await up.text()).slice(0, 160)}`);
      return JSON.parse(await up.text()).upload_url;
    } catch (e) {
      last = e;
      console.warn(`AssemblyAI 串流上傳第 ${i + 1} 次失敗,重試: ${e.message}`);
      if (i < 2) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw last;
}

// ── AssemblyAI 轉寫(預錄音,universal-3-5-pro + 講者分離)───────
async function transcribeWithAssembly({ tenant, buffer, audioMessageId, filename, contentType, roster, cfg = GENERIC_MEETINGS_CONFIG }) {
  const auth = { Authorization: aiForTenant(tenant).assemblyKey }; // 原始 key,不加 Bearer

  // 1. 上傳原始位元組到 AssemblyAI /v2/upload。
  //    - buffer 路徑(相容):整包上傳,偶發 422/5xx 自動重試。
  //    - 串流路徑(大檔友善):streamLineContent 邊下載邊灌給 AssemblyAI,整檔不進記憶體。
  //      串流的 body 不可重放,失敗時重新開一條串流再試(最多 3 次)。
  const uploadUrl = await uploadToAssembly({ buffer, audioMessageId, auth });

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
// required 只放 title 與 minutes,不是因為它們「比較重要」,而是因為它們是
// 「模型有照契約做事」的最低證據。模型把整包答案裹進 {"result":{…}} 是常見行為,
// 而 extractFirstJsonObject 抓的是第一個 '{',也就是那層包裝:所有欄位一起消失,
// normalizeParsed 照樣把它正規化成一份空白會議記錄——無錯誤、無 log,直接寫進 Notion 又推到 LINE。
// 有了這道探針,解析失敗會重試並換後端(鏈上有三家),代價有界;實測 9/9 次成功回應這兩欄都在,
// 偽陽性≈0。nextMeeting / todos / conclusions 一律維持選填。回歸測試見 tools/dryrun-meetings.mjs。
const REQUIRED_SUMMARY_KEYS = ['title', 'minutes'];
const SUMMARY_SCHEMA = {
  type: 'object',
  required: REQUIRED_SUMMARY_KEYS,
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
async function summarize({ tenant, diarized, roster, legend, cfg = GENERIC_MEETINGS_CONFIG }) {
  const who = [...legend.values()].join('、');
  const j = await llmForTenant(tenant).completeJson({
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
  // 新建資料庫不是 .env 中的固定資料源；登記前先由 Core 驗證它仍在此租戶母頁下。
  await platform.registerTenantDataSource?.(tenant, dsId);
  console.log(`Provisioned per-group meetings DB「${groupName}」→ ${dsId}`);
  return dsId;
}

// 決定這則會議寫進哪個會議庫:
//  per-group 模式(tenant.meetingsParentPageId 有值 + 有 binding.pageId):每群一個獨立庫,第一次開會自動建、id 記回綁定頁「會議資料庫」欄。
//  否則:租戶預設庫(例如目前的 engineering 設定)。
async function resolveMeetingsTarget(tenant, binding) {
  const fallback = { dbId: tenant?.dataSources?.meetings, perGroup: false };
  if (!tenant?.meetingsParentPageId || !binding?.pageId) return fallback;
  try {
    const page = await platform.notionRequest(`/v1/pages/${encodeURIComponent(binding.pageId)}`, { method: 'GET' });
    const existing = plainRich(page.properties?.['會議資料庫']);
    if (existing) {
      await platform.registerTenantDataSource?.(tenant, existing);
      return { dbId: existing, perGroup: true };
    }
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
function publicMeetingUrl(pageId, tenant = null) {
  const baseUrl = platform.publicBaseUrlForTenant?.(tenant) || platform.publicBaseUrl;
  if (!baseUrl || !platform.publicLinkSecret) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}/m/${normId(pageId)}-${meetingSig(pageId)}`;
}
function reviewSig(sessionId) {
  return crypto.createHmac('sha256', platform.publicLinkSecret || '').update(`meeting-review:${sessionId}`).digest('hex').slice(0, 16);
}
function reviewPath(sessionId) {
  return `/meetings/review/${sessionId}-${reviewSig(sessionId)}`;
}
function reviewUrl(sessionId, tenant = null) {
  const liffId = String(tenant?.config?.meetings?.liffId || '').trim();
  if (liffId && platform.publicLinkSecret) {
    return `https://liff.line.me/${encodeURIComponent(liffId)}/${sessionId}-${reviewSig(sessionId)}`;
  }
  const baseUrl = platform.publicBaseUrlForTenant?.(tenant) || platform.publicBaseUrl;
  if (!baseUrl || !platform.publicLinkSecret) return '';
  return `${String(baseUrl).replace(/\/+$/, '')}${reviewPath(sessionId)}`;
}

async function pushMeetingReviewNotification(session, message, event, { attempts = 2, delayMs = 400, timeoutMs = 6000 } = {}) {
  let lastError = null;
  if (!session.notificationRetryKeys || typeof session.notificationRetryKeys !== 'object') session.notificationRetryKeys = {};
  const retryKey = session.notificationRetryKeys[event] || crypto.randomUUID();
  session.notificationRetryKeys[event] = retryKey;
  const groupHash = crypto.createHash('sha256').update(String(session.groupId || '')).digest('hex').slice(0, 10);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const receipt = await platform.pushLineMessage(session.groupId, message, undefined, { retryKey, timeoutMs });
      console.log(`Meeting review LINE push succeeded event=${event} session=${session.id.slice(0, 8)} groupHash=${groupHash} attempt=${attempt} status=${receipt?.status || '-'} requestId=${receipt?.requestId || receipt?.acceptedRequestId || '-'} messageIds=${receipt?.messageIds?.join(',') || '-'}`);
      return receipt || true;
    } catch (error) {
      lastError = error;
      console.warn(`Meeting review LINE push failed event=${event} session=${session.id.slice(0, 8)} attempt=${attempt}/${attempts}: ${error?.message || error}`);
      const lineStatus = Number(error?.lineStatus || 0);
      const retryable = error?.code === 'LINE_PUSH_TIMEOUT' || !lineStatus || lineStatus === 429 || lineStatus >= 500;
      if (!retryable) break;
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  const error = Object.assign(
    new Error('LINE 群組通知暫時送不出去，已保留「尚未開啟」狀態，請稍後再按一次。'),
    { statusCode: 502, cause: lastError },
  );
  throw error;
}

function reviewSessionRichText(session) {
  const payload = {
    version: 2,
    id: session.id,
    status: session.status,
    meetingMode: sessionMeetingMode(session),
    policyVersion: session.policyVersion || MEETING_POLICY_VERSION,
    tenantKey: session.tenant?.key || '',
    binding: {
      pageId: session.binding?.pageId || '',
      groupName: session.binding?.groupName || session.binding?.name || '',
      name: session.binding?.name || session.binding?.groupName || '',
      role: session.binding?.role || '',
      projectPageId: session.binding?.projectPageId || '',
      meetingMode: session.binding?.meetingMode || '',
      members: session.memberMap || session.binding?.members || {},
    },
    memberMap: session.memberMap || {},
    groupId: session.groupId || '',
    hostName: session.hostName || '',
    hostUserId: session.hostUserId || '',
    meetingId: session.meetingId || '',
    meetingUrl: session.meetingUrl || '',
    publicUrl: session.publicUrl || '',
    projectPageId: session.projectPageId || '',
    perGroup: Boolean(session.perGroup),
    createdAt: session.createdAt || Date.now(),
    todos: session.todos || [],
    taskPageIds: session.taskPageIds || [],
    notificationRetryKeys: session.notificationRetryKeys || {},
    finalizedBy: session.finalizedBy || '',
    finalizedAt: session.finalizedAt || '',
    retainedReason: session.retainedReason || '',
    confirmedTodosAppended: Boolean(session.confirmedTodosAppended),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const value = `${REVIEW_SESSION_MARKER}${encoded}`;
  const chunks = [];
  for (let i = 0; i < value.length; i += 1800) chunks.push(value.slice(i, i + 1800));
  return chunks.map((content) => ({ type: 'text', text: { content } }));
}

function parseReviewSessionMarker(value) {
  const raw = String(value || '');
  if (!raw.startsWith(REVIEW_SESSION_MARKER)) return null;
  try {
    const encoded = raw.slice(REVIEW_SESSION_MARKER.length).trim();
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (error) {
    console.warn(`meeting review session marker parse failed: ${error.message}`);
    return null;
  }
}

async function persistReviewSession(session) {
  if (!session?.meetingId) return;
  try {
    const children = await readChildren(session.meetingId);
    const markers = children.filter((block) => block.type === 'paragraph'
      && richText(block.paragraph?.rich_text).startsWith(REVIEW_SESSION_MARKER));
    const body = { paragraph: { rich_text: reviewSessionRichText(session) } };
    if (markers.length) {
      const latest = markers[markers.length - 1];
      await platform.notionRequest(`/v1/blocks/${encodeURIComponent(latest.id)}`, {
        method: 'PATCH',
        body,
      });
    } else {
      await appendChildren(session.meetingId, [{
        object: 'block',
        type: 'paragraph',
        paragraph: body.paragraph,
      }]);
    }
  } catch (error) {
    console.warn(`meeting review session persist failed: ${error.message}`);
  }
}

async function loadReviewSessionFromMeeting(sessionId, tenants = [], routeTenant = null) {
  if (!/^[0-9a-f]{32}$/i.test(String(sessionId || ''))) return null;
  try {
    const children = await readChildren(sessionId);
    const markers = children.filter((block) => block.type === 'paragraph'
      && richText(block.paragraph?.rich_text).startsWith(REVIEW_SESSION_MARKER));
    for (let i = markers.length - 1; i >= 0; i -= 1) {
      const payload = parseReviewSessionMarker(richText(markers[i].paragraph?.rich_text));
      if (!payload || payload.id !== sessionId) continue;
      const tenant = tenants.find((t) => t.key === payload.tenantKey) || routeTenant || null;
      if (!tenant) return null;
      const binding = payload.binding && typeof payload.binding === 'object' ? { ...payload.binding } : {};
      binding.members = payload.memberMap || binding.members || {};
      const session = {
        id: payload.id,
        status: payload.status || 'awaiting_host_choice',
        meetingMode: normalizeMeetingMode(payload.meetingMode)
          || meetingRolloutPolicy(tenant, binding).effectiveMode,
        policyVersion: payload.policyVersion || 'legacy',
        tenant,
        binding,
        memberMap: payload.memberMap || binding.members || {},
        groupId: payload.groupId || '',
        hostName: payload.hostName || '',
        hostUserId: payload.hostUserId || '',
        meetingId: payload.meetingId || payload.id,
        meetingUrl: payload.meetingUrl || '',
        publicUrl: payload.publicUrl || '',
        projectPageId: payload.projectPageId || binding.projectPageId || '',
        perGroup: Boolean(payload.perGroup),
        createdAt: Number(payload.createdAt || Date.now()),
        todos: (payload.todos || []).slice(0, 30).map(normalizeTodo),
        taskPageIds: Array.isArray(payload.taskPageIds) ? payload.taskPageIds : [],
        notificationRetryKeys: payload.notificationRetryKeys || {},
        finalizedBy: payload.finalizedBy || '',
        finalizedAt: payload.finalizedAt || '',
        retainedReason: payload.retainedReason || '',
        confirmedTodosAppended: Boolean(payload.confirmedTodosAppended),
        timer: null,
      };
      if (session.status === 'awaiting_host_choice') {
        const elapsed = Date.now() - session.createdAt;
        const remaining = Math.max(60_000, REVIEW_DECISION_TIMEOUT_MS - elapsed);
        session.timer = setTimeout(() => {
          autoCompleteReviewSession(session.id).catch((e) => console.warn(`meeting review auto-complete failed: ${e.message}`));
        }, remaining);
        session.timer.unref?.();
      }
      reviewSessions.set(session.id, session);
      return session;
    }
  } catch (error) {
    console.warn(`meeting review session restore failed session=${String(sessionId || '').slice(0, 8)}: ${error.message}`);
  }
  return null;
}

async function beginMeetingReview(session, options = {}) {
  if (!sessionCanReview(session)) {
    throw Object.assign(new Error('此會議模式不提供待辦確認。'), { statusCode: 409 });
  }
  if (!reviewLiffId(session) || !reviewUrl(session.id, session.tenant)) {
    throw Object.assign(new Error('此租戶尚未完成 LIFF 或安全確認連結設定，候選待辦已保留。'), { statusCode: 503 });
  }
  if (session.status !== 'awaiting_host_choice') {
    throw Object.assign(new Error('此會議已經選擇過確認流程。'), { statusCode: 409 });
  }
  session.status = 'opening_review';
  await persistReviewSession(session);
  try {
    await pushMeetingReviewNotification(
      session,
      `🧾 會議待辦確認已開啟。\n請各負責人進入頁面修正並確認自己的任務：${reviewUrl(session.id, session.tenant)}`,
      'review-opened',
      options,
    );
    session.status = 'reviewing';
    await persistReviewSession(session);
  } catch (error) {
    session.status = 'awaiting_host_choice';
    await persistReviewSession(session);
    throw error;
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req, limit = 1_000_000) {
  let out = '';
  for await (const chunk of req) {
    out += chunk;
    if (out.length > limit) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
  }
  return out;
}

function normalizeTodo(t, index = 0) {
  return {
    id: t.id || `todo-${index + 1}`,
    content: String(t.content || '').trim(),
    owner: String(t.owner || '').trim(),
    due: String(t.due || '').trim(),
    ownerConfirmed: Boolean(t.ownerConfirmed),
    ownerConfirmedBy: String(t.ownerConfirmedBy || ''),
    ownerConfirmedAt: String(t.ownerConfirmedAt || ''),
    version: Number(t.version || 1),
  };
}

function hasRequiredTodoFields(t) {
  return Boolean(String(t.content || '').trim() && String(t.owner || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(t.due || '').trim()));
}

function initialMemberMap(binding) {
  return binding?.members && typeof binding.members === 'object' ? { ...binding.members } : {};
}

function memberOptions(session) {
  const members = session?.memberMap && typeof session.memberMap === 'object' ? session.memberMap : initialMemberMap(session?.binding);
  return Object.keys(members).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function memberUserId(session, name) {
  const members = session?.memberMap && typeof session.memberMap === 'object' ? session.memberMap : initialMemberMap(session?.binding);
  return members?.[name] || '';
}

function reviewLiffId(session) {
  return String(session?.tenant?.config?.meetings?.liffId || '').trim();
}

function reviewRequiresLineLogin(session) {
  return Boolean(reviewLiffId(session));
}

function reviewLiffChannelId(session) {
  return reviewLiffId(session).split('-')[0] || '';
}

async function lineProfileFromAccessToken(accessToken, { timeoutMs = 6000, expectedClientId = '' } = {}) {
  const token = String(accessToken || '').trim();
  if (!token) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // LINE 官方建議：伺服器先驗 access token 的有效期與 client_id，再取得 profile。
    // 只呼叫 /v2/profile 無法確認 token 是否屬於這個 LIFF channel。
    const verify = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    });
    if (!verify.ok) throw Object.assign(new Error('LINE 登入驗證失敗，請重新開啟頁面。'), { statusCode: 401 });
    const tokenInfo = await verify.json();
    const clientId = String(tokenInfo.client_id || '').trim();
    if (expectedClientId && clientId !== String(expectedClientId)) {
      throw Object.assign(new Error('LINE 登入頻道不符合此會議，請由原群組連結重新開啟。'), { statusCode: 401 });
    }
    if (Number(tokenInfo.expires_in || 0) <= 0) {
      throw Object.assign(new Error('LINE 登入已逾期，請重新開啟頁面。'), { statusCode: 401 });
    }
    const response = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error('LINE 登入驗證失敗，請重新開啟頁面。'), { statusCode: 401 });
    const profile = await response.json();
    return {
      userId: String(profile.userId || '').trim(),
      displayName: String(profile.displayName || '').trim(),
      clientId,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error('LINE 身分驗證逾時，請稍後再按一次。'), { statusCode: 504, code: 'LINE_PROFILE_TIMEOUT', cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertReviewGroupMember(session, userId) {
  const groupId = String(session?.groupId || '').trim();
  const actor = String(userId || '').trim();
  if (!groupId || !actor) throw Object.assign(new Error('無法確認會議群組身分。'), { statusCode: 403 });
  if (typeof platform?.listGroupMemberIds !== 'function') {
    throw Object.assign(new Error('LINE 群組成員驗證尚未設定，確認功能暫時唯讀。'), { statusCode: 503 });
  }
  const key = `${session?.tenant?.key || ''}::${groupId}`;
  let cached = reviewGroupMemberCache.get(key);
  if (!cached || Date.now() - cached.at > REVIEW_GROUP_MEMBER_CACHE_MS) {
    const ids = await platform.listGroupMemberIds(groupId);
    cached = { at: Date.now(), ids: new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)) };
    reviewGroupMemberCache.set(key, cached);
  }
  if (!cached.ids.has(actor)) {
    throw Object.assign(new Error('只有這個 LINE 群組的成員可以查看或修改會議待辦。'), { statusCode: 403 });
  }
}

async function resolveReviewActor(session, body) {
  if (!reviewRequiresLineLogin(session)) {
    throw Object.assign(new Error('此租戶尚未完成 LIFF 身分設定，待辦確認目前為唯讀。'), { statusCode: 503 });
  }
  const profile = await lineProfileFromAccessToken(body.liffAccessToken, { expectedClientId: reviewLiffChannelId(session) });
  if (!profile?.userId) throw Object.assign(new Error('請先用 LINE 登入後再操作。'), { statusCode: 401 });
  const actorUserId = profile.userId;
  const actorName = profile.displayName || session.hostName || 'LINE 使用者';
  await assertReviewGroupMember(session, actorUserId);
  return { actorUserId, actorName };
}

async function persistSessionMemberMap(session) {
  if (!session?.binding?.pageId) return;
  const members = session.memberMap && typeof session.memberMap === 'object' ? session.memberMap : {};
  if (session.binding) session.binding.members = { ...members };
  await platform.notionRequest(`/v1/pages/${encodeURIComponent(session.binding.pageId)}`, {
    method: 'PATCH',
    body: { properties: { '成員對照': { rich_text: [text(JSON.stringify(members).slice(0, 1900))] } } },
  });
}

async function ensureSessionMember(session, actorName, actorUserId) {
  const name = String(actorName || '').trim();
  const userId = String(actorUserId || '').trim();
  if (!session || !name || !userId) return false;
  if (!session.memberMap || typeof session.memberMap !== 'object') session.memberMap = initialMemberMap(session.binding);
  if (session.memberMap[name] === userId) return false;
  session.memberMap[name] = userId;
  if (session.binding) session.binding.members = { ...(session.binding.members || {}), [name]: userId };
  await persistSessionMemberMap(session);
  return true;
}

async function ensureSessionMemberBestEffort(session, actorName, actorUserId, timeoutMs = 2500) {
  let timer = null;
  const update = Promise.resolve()
    .then(() => ensureSessionMember(session, actorName, actorUserId))
    .catch((error) => {
      console.warn(`meeting review member update failed: ${error.message}`);
      return false;
    });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`meeting review member update timed out after ${timeoutMs}ms; continuing without blocking the action`);
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([update, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createReviewSession(payload) {
  const sessionId = normId(payload.meetingId) || crypto.randomBytes(10).toString('hex');
  const todos = (payload.todos || []).slice(0, 30).map(normalizeTodo);
  const session = {
    id: sessionId,
    status: 'awaiting_host_choice',
    meetingMode: normalizeMeetingMode(payload.meetingMode)
      || meetingRolloutPolicy(payload.tenant, payload.binding || {}).effectiveMode,
    policyVersion: payload.policyVersion || MEETING_POLICY_VERSION,
    tenant: payload.tenant,
    binding: payload.binding,
    memberMap: initialMemberMap(payload.binding),
    groupId: payload.groupId,
    hostName: payload.hostName || '',
    hostUserId: payload.hostUserId || '',
    meetingId: payload.meetingId,
    meetingUrl: payload.meetingUrl || '',
    publicUrl: payload.publicUrl || '',
    projectPageId: payload.projectPageId || '',
    perGroup: Boolean(payload.perGroup),
    createdAt: Date.now(),
    todos,
    taskPageIds: [],
    timer: null,
  };
  session.timer = setTimeout(() => {
    autoCompleteReviewSession(sessionId).catch((e) => console.warn(`meeting review auto-complete failed: ${e.message}`));
  }, REVIEW_DECISION_TIMEOUT_MS);
  session.timer.unref?.();
  reviewSessions.set(sessionId, session);
  return session;
}

function clearReviewTimer(session) {
  if (session?.timer) clearTimeout(session.timer);
  if (session) session.timer = null;
}

function assertHostActor(session, actorUserId) {
  const expected = String(session?.hostUserId || '');
  const actor = String(actorUserId || '');
  if (!expected) {
    throw Object.assign(new Error('這場會議缺少上傳者身分，請由總管修復主持人後再操作。'), { statusCode: 409 });
  }
  if (!actor) {
    throw Object.assign(new Error('主持人操作需要先用 LINE 登入。'), { statusCode: 401 });
  }
  if (expected !== actor) {
    throw Object.assign(new Error('只有會議主持人可以執行此操作。'), { statusCode: 403 });
  }
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
const richText = (rt) => (rt || []).map((r) => r.plain_text || r.text?.content || '').join('');

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
  // 講者對照只允許從已簽署的會議連結改寫；此流程依產品需求不再要求額外 PIN。
  const { speakers } = parseLegend(legend);
  const editor = speakers.length && platform.publicLinkSecret
    ? speakerWidgetHtml(speakers, { savePath: `/m/${normId(pageId)}-${meetingSig(pageId)}` })
    : '';
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
${editor}
${body || '<p class="dim">(此會議尚無內容)</p>'}
<footer>🐌 葉小蝸自動整理</footer>
</div></body></html>`;
}

// GET  /m/<32碼id>-<16碼簽章> → 公開會議頁(免帳號)
// POST /m/<32碼id>-<16碼簽章> → 修正講者存回 Notion（已簽署連結，不需 PIN）
// 回傳 true=已處理。
async function handlePublicRequest(req, res, pathname) {
  const m = String(pathname).match(/^\/m\/([0-9a-f]{32})-([0-9a-f]{16})$/i);
  if (!m) return false;
  const [, id, sig] = m;
  const deny = () => { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<meta charset="utf-8"><p style="font-family:system-ui;padding:40px;text-align:center">找不到這份會議記錄(連結可能失效)。</p>'); };
  if (!platform.publicLinkSecret || meetingSig(id) !== sig.toLowerCase()) { deny(); return true; }

  if (req.method === 'POST') {
    const sendJson = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
    try {
      const body = await readJsonBody(req);
      const result = await handleSpeakerSave({ pageId: id, body, deps: { notionRequest: platform.notionRequest } });
      sendJson(result.status, result.json);
    } catch (e) {
      console.warn(`speaker-fix save failed: ${e.message}`);
      sendJson(500, { error: `儲存失敗:${e.message}` });
    }
    return true;
  }

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 262144) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function createMeetingTasksFromTodos(session) {
  if (!session || session.taskPageIds?.length) return session?.taskPageIds || [];
  if (!sessionCreatesFormalTasks(session)) return [];
  const ctx = { tenant: session.tenant, groupId: session.groupId, binding: session.binding };
  const common = {
    source: '會議',
    status: '待辦',
    projectPageId: session.projectPageId,
    meetingId: session.perGroup ? '' : session.meetingId,
    groupBindingId: session.binding?.pageId || '',
    sourceEvidence: `會議記錄：${session.publicUrl || session.meetingUrl || session.meetingId}${session.groupId ? `；LINE 群組：${session.groupId}` : ''}`,
    limit: 30,
  };
  if (platform.tasks?.expandTasks) {
    session.taskPageIds = await platform.tasks.expandTasks(ctx, session.todos, common);
    return session.taskPageIds;
  }
  const ids = [];
  for (const t of session.todos.slice(0, 30)) {
    try {
      const page = await platform.notionRequest('/v1/pages', {
        method: 'POST',
        body: {
          parent: { type: 'data_source_id', data_source_id: session.tenant.dataSources.tasks },
          properties: {
            '內容': { title: [text(t.content)] },
            ...(session.projectPageId ? { '專案': { relation: [{ id: session.projectPageId }] } } : {}),
            '負責人': { rich_text: t.owner ? [text(t.owner)] : [] },
            '期限': /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? { date: { start: t.due } } : { date: null },
            '來源': { select: { name: '會議' } },
            '狀態': { select: { name: '待辦' } },
            ...(session.binding?.pageId ? { '負責群組': { relation: [{ id: session.binding.pageId }] } } : {}),
            ...(session.perGroup ? {} : { '會議記錄': { relation: [{ id: session.meetingId }] } }),
          },
        },
      });
      ids.push(page.id);
    } catch (e) {
      console.warn(`todo create failed: ${e.message}`);
    }
  }
  session.taskPageIds = ids;
  return ids;
}

function reviewSummary(session) {
  const total = session.todos.length;
  const requiredReady = session.todos.filter(hasRequiredTodoFields).length;
  const confirmed = session.todos.filter((t) => t.ownerConfirmed).length;
  return { total, requiredReady, confirmed, allReady: total > 0 && requiredReady === total, allConfirmed: total > 0 && confirmed === total };
}

function confirmedTodoLine(t, index) {
  return `${index + 1}. ${t.content}${t.owner ? `(${t.owner})` : ''}${t.due ? ` 期限:${t.due}` : ''}`;
}

function confirmedTodosText(session) {
  return session.todos.map(confirmedTodoLine).join('\n') || '(無)';
}

async function appendConfirmedTodosToMeeting(session) {
  if (!session?.meetingId || session.confirmedTodosAppended) return;
  const blocks = [
    para(`[最終確認] ${stamp()} 由 ${session.finalizedBy || '主持人'} 完成待辦確認；以下清單為正式建立待辦的版本。`),
    ...session.todos.map((t) => todoBlock(t)),
  ];
  await appendToggleSection(session.meetingId, '✅ 最終確認待辦', blocks);
  session.confirmedTodosAppended = true;
}

async function autoCompleteReviewSession(sessionId) {
  const session = reviewSessions.get(sessionId);
  if (!session || session.status !== 'awaiting_host_choice') return;
  // Timeout is deliberately fail-closed. Silence is not meeting consensus and
  // must never create a formal task, even for review_and_create groups.
  session.status = 'candidates_retained';
  session.finalizedBy = '系統逾時保留';
  session.finalizedAt = new Date().toISOString();
  clearReviewTimer(session);
  await persistReviewSession(session);
  await platform.pushLineMessage(session.groupId, `⏱ 會議待辦確認超過 24 小時未選擇；候選待辦已保留，沒有建立正式待辦。\n會議記錄：${session.publicUrl || session.meetingUrl}`).catch(() => {});
}

async function finishReviewSession(session, actor = '主持人') {
  if (!sessionCanReview(session)) throw Object.assign(new Error('此會議模式不提供待辦確認。'), { statusCode: 409 });
  const s = reviewSummary(session);
  if (!s.allReady) throw Object.assign(new Error('仍有待辦缺少任務名稱、負責人或截止日期。'), { statusCode: 409 });
  if (!s.allConfirmed) throw Object.assign(new Error('仍有待辦尚未由負責人確認。'), { statusCode: 409 });
  const createFormalTasks = sessionCreatesFormalTasks(session);
  session.status = createFormalTasks ? 'finalized' : 'reviewed_candidates';
  session.finalizedBy = actor;
  session.finalizedAt = new Date().toISOString();
  clearReviewTimer(session);
  if (createFormalTasks) await createMeetingTasksFromTodos(session);
  await appendConfirmedTodosToMeeting(session).catch((e) => console.warn(`append confirmed meeting todos failed: ${e.message}`));
  await persistReviewSession(session);
  const outcome = createFormalTasks
    ? `正式建立 ${session.taskPageIds.length} 筆待辦`
    : '確認版已保存；此群目前為確認試行，沒有建立正式待辦';
  await platform.pushLineMessage(session.groupId, `✅ 會議待辦已完成確認，${outcome}。\n\n最終確認待辦：\n${confirmedTodosText(session)}\n\n會議記錄：${session.publicUrl || session.meetingUrl}`).catch(() => {});
}

async function completeWithoutReview(session, actor = '主持人') {
  session.status = 'completed_without_review';
  session.finalizedBy = actor;
  session.finalizedAt = new Date().toISOString();
  clearReviewTimer(session);
  if (!sessionCreatesFormalTasks(session)) {
    session.status = 'candidates_retained';
    await persistReviewSession(session);
    await platform.pushLineMessage(session.groupId, `✅ 主持人選擇不進行待辦確認；候選待辦已保留，沒有建立正式待辦。\n會議記錄：${session.publicUrl || session.meetingUrl}`).catch(() => {});
    return;
  }
  await createMeetingTasksFromTodos(session);
  await persistReviewSession(session);
  await platform.pushLineMessage(session.groupId, `✅ 主持人選擇不進行待辦確認，已依原流程建立 ${session.taskPageIds.length} 筆待辦。\n會議記錄：${session.publicUrl || session.meetingUrl}`).catch(() => {});
}

async function retainCandidatesFailClosed(session, reason = '待辦確認尚未完成設定') {
  session.status = 'candidates_retained';
  session.finalizedBy = '系統安全保留';
  session.finalizedAt = new Date().toISOString();
  session.retainedReason = String(reason || '').slice(0, 240);
  clearReviewTimer(session);
  await persistReviewSession(session);
  await platform.pushLineMessage(
    session.groupId,
    `⚠ ${reason}；候選待辦已保留，沒有建立正式待辦。\n會議記錄：${session.publicUrl || session.meetingUrl}`,
  ).catch(() => {});
}

function meetingReviewLineText(session) {
  const url = reviewUrl(session.id, session.tenant);
  const full = sessionCreatesFormalTasks(session);
  return [
    '🧾 會議記錄已完成。',
    '',
    `主持人：${session.hostName || '錄音上傳者'}`,
    `候選待辦：${session.todos.length} 筆`,
    '',
    '請主持人選擇是否開啟「待辦事項確認」。',
    full
      ? '選擇不需要時，系統會依原流程直接建立待辦；選擇需要時，負責人可在頁面中修正並確認自己的任務。'
      : '目前為「確認試行」；負責人可修正並確認任務，但系統不會建立正式待辦。',
    '',
    url ? `待辦確認頁：${url}` : '待辦確認頁尚未啟用；候選待辦會保留，不會直接建立正式待辦。',
  ].join('\n');
}

function renderReviewHtml(session) {
  const members = memberOptions(session);
  const s = reviewSummary(session);
  const liffId = reviewLiffId(session);
  const protectedData = Boolean(liffId);
  const createsFormalTasks = sessionCreatesFormalTasks(session);
  const sessionJson = JSON.stringify({
    id: session.id,
    status: session.status,
    hostName: session.hostName,
    meetingUrl: session.meetingUrl,
    publicUrl: session.publicUrl,
    apiPath: reviewPath(session.id),
    // LIFF 模式在伺服器確認 token + 真實群組成員前，不把待辦與 member map 放進 HTML。
    members: protectedData ? [] : members,
    liffId,
    requireLineLogin: reviewRequiresLineLogin(session),
    meetingMode: sessionMeetingMode(session),
    createsFormalTasks,
    todos: protectedData ? [] : session.todos,
    summary: s,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>會議待辦確認</title>
<style>
:root{--bg:#f5f7f6;--card:#fff;--line:#dfe8e3;--ink:#1e2b25;--muted:#6f7e76;--green:#0f4b35;--soft:#e7f3ed;--danger:#a62b25}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;line-height:1.55}.wrap{max-width:920px;margin:0 auto;padding:18px 14px 48px}header{position:sticky;top:0;background:rgba(245,247,246,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 0;z-index:2}h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);font-size:14px}.panel,.task{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin:14px 0}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}button{border:0;border-radius:8px;background:var(--green);color:white;font-weight:700;font-size:16px;padding:12px 16px;cursor:pointer}button.secondary{background:var(--soft);color:var(--green)}button.danger{background:var(--danger)}button:disabled{opacity:.45;cursor:not-allowed}label{display:block;font-weight:700;margin:12px 0 6px}input,select,textarea{width:100%;font:inherit;border:1px solid #cfd8d3;border-radius:8px;padding:10px;background:white;color:var(--ink)}textarea{min-height:84px;resize:vertical}.row{display:grid;grid-template-columns:1fr 180px;gap:10px}.badge{display:inline-block;border-radius:999px;background:var(--soft);color:var(--green);padding:4px 10px;font-size:13px;font-weight:700}.warn{color:var(--danger)}.ok{color:var(--green)}.toast{position:fixed;left:14px;right:14px;bottom:14px;background:#17231e;color:white;border-radius:8px;padding:12px 14px;display:none}@media(max-width:640px){.row{grid-template-columns:1fr}.actions button{width:100%}}
</style></head><body><div class="wrap"><header><h1>會議待辦確認</h1><div class="meta">主持人：${esc(session.hostName || '錄音上傳者')} ・ 狀態：<span id="statusText">${esc(session.status)}</span></div></header>
<div id="errorBox" class="panel warn" style="display:none"></div>
<section class="panel"><div id="summary"></div><p class="meta" id="authText">${liffId ? '正在驗證 LINE 身分…' : '一般網頁模式'}</p><div class="actions" id="hostChoice"><button data-action="start"${liffId ? ' disabled' : ''}>要，開啟確認</button><button class="secondary" data-action="complete"${liffId ? ' disabled' : ''}>不要，直接完成</button></div><div class="actions"><a href="${esc(session.publicUrl || session.meetingUrl)}" target="_blank" rel="noopener"><button class="secondary" type="button">查看會議記錄</button></a></div></section>
<section id="tasks"></section>
<section class="panel"><div class="actions"><button id="finalize" class="danger">${createsFormalTasks ? '主持人最終確認並建立待辦' : '主持人最終確認清單'}</button></div><p class="meta">${createsFormalTasks ? '只有所有任務具備任務名稱、負責人、截止日期，且已由負責人確認後，才能最終建立正式待辦。' : '目前為確認試行；完成負責人與主持人確認後，會保存確認版清單，但不建立正式待辦。'}</p></section>
<div class="toast" id="toast"></div>${liffId ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}<script>
const DATA=${sessionJson};let lineUserId='',lineName='',lineAccessToken='',identityVerified=false,toastTimer=0;
const api=async(body,timeoutMs=25000)=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetch(DATA.apiPath||location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,liffAccessToken:lineAccessToken}),signal:controller.signal});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'操作失敗');return j}catch(e){if(controller.signal.aborted)throw Error('連線逾時，請重新整理頁面後再試。');throw e}finally{clearTimeout(timer)}};
const within=(promise,timeoutMs,message)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(message)),timeoutMs);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})});
function show(msg,duration=2800){const el=document.getElementById('toast');clearTimeout(toastTimer);el.textContent=msg;el.style.display='block';if(duration>0)toastTimer=setTimeout(()=>el.style.display='none',duration)}
function showError(msg){const el=document.getElementById('errorBox');el.textContent=msg;el.style.display='block'}
function clearError(){const el=document.getElementById('errorBox');el.textContent='';el.style.display='none'}
async function initLiff(){if(!DATA.liffId)return;if(!window.liff){showError('LINE 登入元件載入失敗，請關閉後從群組連結重新開啟。');return}try{await within(liff.init({liffId:DATA.liffId}),10000,'LINE 登入初始化逾時，請關閉後重試。');if(!liff.isLoggedIn()){show('請先用 LINE 登入');liff.login({redirectUri:location.href});return}const p=await within(liff.getProfile(),10000,'讀取 LINE 身分逾時，請關閉後重試。');lineUserId=p.userId||'';lineName=p.displayName||'';lineAccessToken=liff.getAccessToken?.()||'';if(DATA.requireLineLogin&&lineAccessToken){const j=await api({action:'identify'});Object.assign(DATA,j.session);identityVerified=true;clearError();}}catch(e){identityVerified=false;console.warn(e);showError(e.message||'LINE 登入失敗，請從 LINE 重新開啟');show(e.message||'LINE 登入失敗，請從 LINE 重新開啟',7000)}}
function optionHtml(value){return '<option value="">選擇負責人</option>'+DATA.members.map(n=>'<option '+(n===value?'selected':'')+'>'+esc(n)+'</option>').join('')}
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function render(){
 const sum=DATA.summary;const statusLabels={awaiting_host_choice:'等待主持人選擇',opening_review:'正在通知 LINE 群組',reviewing:'等待負責人確認',finalized:'已完成並建立待辦',reviewed_candidates:'已完成確認（未建立正式待辦）',candidates_retained:'候選待辦已保留',completed_without_review:'已直接完成'};document.getElementById('statusText').textContent=statusLabels[DATA.status]||DATA.status;
 document.getElementById('authText').textContent=DATA.requireLineLogin?(identityVerified?'身分已確認：'+(lineName||'LINE 使用者'):'尚未完成 LINE 身分驗證'):'此租戶尚未設定 LINE 登入，確認功能目前唯讀';
 document.getElementById('summary').innerHTML='<span class="badge">候選 '+sum.total+' 筆</span> <span class="badge">欄位完整 '+sum.requiredReady+'/'+sum.total+'</span> <span class="badge">負責人確認 '+sum.confirmed+'/'+sum.total+'</span>';
 document.getElementById('hostChoice').style.display=DATA.status==='awaiting_host_choice'?'flex':'none';
 document.querySelectorAll('#hostChoice button').forEach(button=>button.disabled=!identityVerified);
 document.getElementById('finalize').disabled=!(DATA.status==='reviewing'&&sum.allReady&&sum.allConfirmed);
 document.getElementById('tasks').innerHTML=DATA.status==='reviewing'?DATA.todos.map(t=>'<article class="task" data-id="'+esc(t.id)+'" data-version="'+Number(t.version||1)+'"><div><span class="badge">'+(t.ownerConfirmed?'已確認':'待確認')+'</span></div><label>任務名稱</label><textarea name="content">'+esc(t.content)+'</textarea><div class="row"><div><label>負責人</label><select name="owner">'+optionHtml(t.owner)+'</select></div><div><label>截止日期</label><input name="due" type="date" value="'+esc(t.due)+'"></div></div><p class="meta">版本 '+t.version+(t.ownerConfirmedAt?' ・ 確認時間 '+esc(t.ownerConfirmedAt):'')+'</p><div class="actions"><button class="secondary save">儲存修改</button><button class="confirm">確認我的任務</button></div></article>').join(''):'<section class="panel"><p class="meta">主持人尚未開啟待辦確認；開啟成功後，任務才會顯示在這裡。</p></section>';
}
document.addEventListener('click',async(e)=>{const btn=e.target.closest('button');if(!btn)return;try{
 if(!identityVerified){showError(DATA.requireLineLogin?'尚未完成 LINE 身分驗證，請關閉後從群組連結重新開啟。':'此租戶尚未設定 LINE 登入，確認功能目前唯讀。');show(DATA.requireLineLogin?'請先用 LINE 登入後再操作':'確認功能尚未完成設定',7000);return}
 if(btn.dataset.action){btn.disabled=true;clearError();if(btn.dataset.action==='start')document.getElementById('statusText').textContent='正在通知 LINE 群組…';show(btn.dataset.action==='start'?'正在通知 LINE 群組，請稍候…':'正在處理…',0);try{const j=await api({action:btn.dataset.action});Object.assign(DATA,j.session);show('已更新');render();return}finally{btn.disabled=false}}
 if(btn.id==='finalize'){const j=await api({action:'finalize'});Object.assign(DATA,j.session);show(DATA.createsFormalTasks?'已建立正式待辦':'確認版清單已保存');render();return}
 const card=btn.closest('.task');if(!card)return;const todoId=card.dataset.id;const body={todoId,expectedVersion:Number(card.dataset.version||0),content:card.querySelector('[name=content]').value,owner:card.querySelector('[name=owner]').value,due:card.querySelector('[name=due]').value};
 const j=await api({action:btn.classList.contains('confirm')?'confirm-todo':'save-todo',...body});Object.assign(DATA,j.session);show(btn.classList.contains('confirm')?'已確認':'已儲存');render();
}catch(err){render();showError(err.message||'操作失敗');show(err.message||'操作失敗',7000)}});
initLiff().finally(render);
</script></div></body></html>`;
}

function reviewClientSession(session) {
  return {
    status: session.status,
    meetingMode: sessionMeetingMode(session),
    createsFormalTasks: sessionCreatesFormalTasks(session),
    members: memberOptions(session),
    todos: session.todos,
    summary: reviewSummary(session),
  };
}

function meetingReviewTokenFromRequest(pathname, url) {
  let m = String(pathname).match(/^\/meetings\/review\/([0-9a-f]{20}|[0-9a-f]{32})-([0-9a-f]{16})$/i);
  if (m) return { sessionId: m[1], sig: m[2] };
  if (String(pathname) !== '/meetings/review') return null;
  const state = String(url?.searchParams?.get('liff.state') || '');
  m = state.match(/^\/(?:meetings\/review\/)?([0-9a-f]{20}|[0-9a-f]{32})-([0-9a-f]{16})(?:[?#].*)?$/i);
  if (m) return { sessionId: m[1], sig: m[2] };
  return null;
}

async function handleMeetingReviewRequest(req, res, { pathname, url, tenant = null, tenants = [] }) {
  const token = meetingReviewTokenFromRequest(pathname, url);
  if (!token) return false;
  const { sessionId, sig } = token;
  let session = reviewSessions.get(sessionId);
  if (!session) session = await loadReviewSessionFromMeeting(sessionId, tenants, tenant);
  if (!platform.publicLinkSecret || reviewSig(sessionId) !== sig.toLowerCase() || !session) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><p style="font-family:system-ui;padding:40px;text-align:center">找不到這份待辦確認。</p>');
    return true;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderReviewHtml(session));
    return true;
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' }), true;
  let action = 'unknown';
  try {
    const body = JSON.parse(await readBody(req));
    action = String(body.action || '');
    console.log(`Meeting review action=${action || 'unknown'} session=${sessionId.slice(0, 8)} status=${session.status}`);
    const { actorName, actorUserId } = await resolveReviewActor(session, body);
    const actorHash = actorUserId ? crypto.createHash('sha256').update(actorUserId).digest('hex').slice(0, 10) : '-';
    console.log(`Meeting review actor resolved action=${action || 'unknown'} session=${sessionId.slice(0, 8)} actorHash=${actorHash} hostMatch=${!session.hostUserId || session.hostUserId === actorUserId}`);
    if (action === 'identify') {
      await ensureSessionMemberBestEffort(session, actorName, actorUserId);
      await persistReviewSession(session);
      return sendJson(res, 200, { ok: true, session: reviewClientSession(session) }), true;
    }
    if (action === 'start') {
      assertHostActor(session, actorUserId);
      await ensureSessionMemberBestEffort(session, actorName, actorUserId);
      await beginMeetingReview(session);
      return sendJson(res, 200, { ok: true, session: reviewClientSession(session) }), true;
    }
    if (action === 'complete') {
      assertHostActor(session, actorUserId);
      await ensureSessionMemberBestEffort(session, actorName, actorUserId);
      if (session.status !== 'awaiting_host_choice') throw Object.assign(new Error('此會議已進入確認流程，不能直接完成。'), { statusCode: 409 });
      await completeWithoutReview(session, actorName);
      return sendJson(res, 200, { ok: true, session: reviewClientSession(session) }), true;
    }
    if (!['reviewing'].includes(session.status)) throw Object.assign(new Error('此會議目前不能修改待辦。'), { statusCode: 409 });
    if (action === 'save-todo' || action === 'confirm-todo') {
      const todo = session.todos.find((t) => t.id === String(body.todoId || ''));
      if (!todo) throw Object.assign(new Error('找不到這筆待辦。'), { statusCode: 404 });
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(todo.version || 1)) {
        throw Object.assign(new Error('這筆待辦已被其他人更新，請重新整理後再操作。'), { statusCode: 409 });
      }
      // Work on a copy. A rejected owner/date/version request must not mutate
      // the in-memory session before all authorization and validation succeeds.
      const candidate = {
        ...todo,
        content: String(body.content || '').trim(),
        owner: String(body.owner || '').trim(),
        due: String(body.due || '').trim(),
      };
      const before = `${todo.content}|${todo.owner}|${todo.due}`;
      const after = `${candidate.content}|${candidate.owner}|${candidate.due}`;
      if (before !== after) {
        candidate.ownerConfirmed = false;
        candidate.ownerConfirmedBy = '';
        candidate.ownerConfirmedAt = '';
        candidate.version = Number(todo.version || 1) + 1;
      }
      if (candidate.owner && !memberUserId(session, candidate.owner)) {
        throw Object.assign(new Error('負責人必須從已同步的 LINE 群組成員中選擇。'), { statusCode: 409 });
      }
      if (action === 'confirm-todo') {
        if (!hasRequiredTodoFields(candidate)) throw Object.assign(new Error('任務名稱、負責人、截止日期都填完後才能確認。'), { statusCode: 409 });
        await ensureSessionMemberBestEffort(session, actorName, actorUserId);
        if (reviewRequiresLineLogin(session) && !actorUserId) throw Object.assign(new Error('確認任務需要先用 LINE 登入。'), { statusCode: 401 });
        const expectedUserId = memberUserId(session, candidate.owner);
        if (!expectedUserId) throw Object.assign(new Error('目前負責人尚未對應到 LINE 群組成員，請先重新同步成員。'), { statusCode: 409 });
        if (actorUserId !== expectedUserId) throw Object.assign(new Error('只有目前負責人可以確認這筆任務。'), { statusCode: 403 });
        candidate.ownerConfirmed = true;
        candidate.ownerConfirmedBy = actorName || candidate.owner;
        candidate.ownerConfirmedAt = stamp();
      }
      Object.assign(todo, candidate);
      await persistReviewSession(session);
      return sendJson(res, 200, { ok: true, session: reviewClientSession(session) }), true;
    }
    if (action === 'finalize') {
      assertHostActor(session, actorUserId);
      await ensureSessionMemberBestEffort(session, actorName, actorUserId);
      await finishReviewSession(session, actorName);
      return sendJson(res, 200, { ok: true, session: reviewClientSession(session) }), true;
    }
    return sendJson(res, 400, { error: '未知的操作。' }), true;
  } catch (error) {
    console.warn(`Meeting review request failed action=${action || 'unknown'} session=${sessionId.slice(0, 8)} status=${session.status} statusCode=${error.statusCode || 500}: ${error.message || error}`);
    return sendJson(res, error.statusCode || 500, { error: error.message || '會議待辦確認失敗。' }), true;
  }
}

// ── 落地 + 發布 ────────────────────────────────────────────
async function publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, senderUserId, answeredBy, filename, audioDriveUrl, tenant, binding, meetingMode }) {
  const rollout = meetingRolloutPolicy(tenant, binding || {}, meetingMode);
  if (!rollout.enabled) {
    console.log(`Meeting publish skipped by rollout policy (tenant=${tenant?.key || 'default'}, group=${groupId}).`);
    return false;
  }
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
  // Before human confirmation every extracted item is a candidate, including
  // review_and_create groups. The confirmed version is appended only after the
  // responsible owners and host finish review.
  await appendToggleSection(meeting.id, '📄 摘要(會議記錄)', summaryTabBlocks(parsed, kind, { formalTasks: false }));
  await appendToggleSection(meeting.id, '📝 筆記(分區詳細記錄)', notesTabBlocks(parsed));
  const transcriptBlocks = [];
  for (let i = 0; i < diarized.length && transcriptBlocks.length < 90; i += 1900) {
    transcriptBlocks.push(para(diarized.slice(i, i + 1900)));
  }
  if (transcriptBlocks.length) {
    try { await appendToggleSection(meeting.id, '🎧 逐字稿(署名)', transcriptBlocks); }
    catch (e) { console.warn(`transcript section failed: ${e.message}`); }
  }

  // 候選待辦先留在 review session；正式待辦只在主持人略過確認或最終確認後建立。
  const todos = (parsed.todos || []).slice(0, 30);

  // LINE 推完整會議記錄(不含逐字稿),過長自動分段;附「自架公開頁(免帳號)」+「Notion 連結」
  const url = await shareableUrl(meeting.id, meeting.url);
  const publicUrl = publicMeetingUrl(meeting.id, tenant);
  await sendMeetingToLine(groupId, parsed, { legendLine, date: today, type: meetingType, url, publicUrl, defaultTitle });
  if (!rollout.review) {
    if (todos.length) await platform.pushLineMessage(groupId, `📌 本次辨識 ${todos.length} 項待辦候選，已隨會議記錄保存；尚未建立正式待辦。`).catch(() => {});
    console.log(`Meeting published as record-only: ${parsed.title}, ${todos.length} todos.`);
    return true;
  }
  const session = createReviewSession({
    tenant,
    binding,
    groupId,
    hostName: senderName,
    hostUserId: senderUserId || '',
    meetingId: meeting.id,
    meetingUrl: url,
    publicUrl,
    projectPageId,
    perGroup,
    todos,
    meetingMode: rollout.effectiveMode,
    policyVersion: MEETING_POLICY_VERSION,
  });
  await persistReviewSession(session);
  if (!reviewLiffId(session) || !reviewUrl(session.id, tenant)) {
    await retainCandidatesFailClosed(session, 'LIFF 或安全待辦確認連結尚未完成設定');
  } else {
    await platform.pushLineMessage(groupId, meetingReviewLineText(session));
  }
  console.log(`Meeting published (AssemblyAI, mode=${rollout.effectiveMode}): ${parsed.title}, ${todos.length} todos.`);
  return true;
}

// 錄音原檔存 Drive「會議錄音/日期/」
async function archiveAudio(buffer, filename, contentType, tenant) {
  if (!tenant?.driveConfigured) return '';
  const folder = await platform.ensureDriveFolder('會議錄音', tenant.driveRootFolderId);
  const dayFolder = await platform.ensureDriveFolder(todayStr(), folder);
  const uploaded = await platform.uploadToDrive(buffer, filename, contentType, dayFolder);
  return uploaded.webViewLink || '';
}

// 錄音原檔「串流」存 Drive(大檔友善):LINE 下載串流直灌 Drive resumable 上傳,整檔不進記憶體。
async function streamArchiveAudio(tenant, audioMessageId, filename) {
  if (!tenant?.driveConfigured) return '';
  if (typeof platform.streamLineContent !== 'function' || typeof platform.uploadDriveStream !== 'function') return '';
  const folder = await platform.ensureDriveFolder('會議錄音', tenant.driveRootFolderId);
  const dayFolder = await platform.ensureDriveFolder(todayStr(), folder);
  const { stream, contentType, contentLength } = await platform.streamLineContent(audioMessageId);
  if (!contentLength) { try { await stream?.cancel?.(); } catch { /* ignore */ } throw new Error('LINE 未回 content-length,無法串流留底'); }
  const uploaded = await platform.uploadDriveStream(stream, filename, contentType, dayFolder, contentLength);
  console.log(`Meeting audio Drive backup (stream): ${filename}, ${contentLength} bytes.`);
  return uploaded.webViewLink || '';
}

// promise 限時收割:逾時回 fallback(不讓 Drive 備份的慢尾巴擋住發布)。
function raceTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}

// ── Gemini 直讀音檔(唯一還沒被 platform.llm 取代的路徑)──────
// llm.js 不吃音訊,所以這條備援仍自己打 Gemini Files API,也自己解析 JSON。
// Gemini 免費配額是「每分鐘」限流,故三個呼叫都必須帶 fetchRetry。
//
// Gemini 直接讀音檔 → 整理成 parsed(供「無 AssemblyAI key」與「AssemblyAI 失敗備援」共用)。
// 走 Google 網路(從雲端主機穩定),但無講者分離,故不產署名逐字稿。
async function geminiTranscribeParsed({ tenant, buffer, filename, contentType, sourceIsVideo = false, roster, cfg = GENERIC_MEETINGS_CONFIG }) {
  const ai = aiForTenant(tenant);
  if (!ai.geminiKey) throw new Error('Gemini API key not configured for tenant');
  contentType = normalizeMeetingContentType(contentType, filename, sourceIsVideo);
  const boundary = `mtg${Date.now()}`;
  const meta = JSON.stringify({ file: { display_name: filename } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.from(buffer),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  // 這是「備援的備援」(AssemblyAI 全掛時的唯一活路),三個呼叫都必須耐得住暫時性失敗。
  const up = await fetchRetry('https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart', {
    method: 'POST', headers: { 'x-goog-api-key': ai.geminiKey, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  }, { tries: 3, label: 'Gemini upload', baseDelay: 5000 });
  let file = JSON.parse(await up.text()).file;
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    // 輪詢也要過 fetchRetry:否則一次 429 會讓 file.state 變 undefined、直接跳出迴圈當成失敗。
    const poll = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
      headers: { 'x-goog-api-key': ai.geminiKey },
    }, { tries: 3, label: 'Gemini file state' });
    file = await poll.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Gemini file state: ${file.state}`);
  const who = (roster?.speakers || []).map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、');
  const prompt = meetingPrompt({ who: '', topic: roster?.topic || '', today: todayStr(), kind: roster?.kind, cfg })
    + (who ? `\n與會者(供人名辨識,依發言順序):${who}` : '');
  const gen = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${ai.meetingModel || 'gemini-2.5-flash'}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': ai.geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: contentType, file_uri: file.uri } }, { text: prompt }] }] }),
  }, { tries: 5, label: 'Gemini generate', baseDelay: 6000 });
  const genJson = await gen.json();
  const raw = (genJson.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const j = JSON.parse((raw.replace(/```(json)?/gi, '').match(/\{[\s\S]*\}/) || ['{}'])[0]);
  // 這條路徑不經 llm.js,拿不到 schema 檢查 —— 同一個「包一層」的洞在這裡也開著。
  // 寧可讓 finalizeMeeting 的 catch 誠實報「整理失敗」(錄音留底還在),也不要靜靜產出一頁空白。
  const missing = REQUIRED_SUMMARY_KEYS.filter((k) => !(k in j));
  if (missing.length) throw new Error(`Gemini 直讀回傳缺少 ${missing.join('/')}(整包可能被裹在另一層 key 裡)`);
  return normalizeParsed(j);
}

// ══ 後備:Gemini 直轉流程(無 AssemblyAI key 時使用)══
// ctx: { tenant, buffer, filename, contentType, binding, senderName, senderUserId, groupId }
async function processRecording({ tenant, buffer, filename, contentType, sourceIsVideo = false, binding, senderName, senderUserId, groupId, meetingMode }) {
  const rollout = meetingRolloutPolicy(tenant, binding || {}, meetingMode);
  if (!rollout.enabled) {
    console.log(`Meeting recording skipped by rollout policy (tenant=${tenant?.key || 'default'}, group=${groupId}).`);
    return false;
  }
  contentType = normalizeMeetingContentType(contentType, filename, sourceIsVideo);
  const cfg = meetingsCfg(tenant);
  const minutes = Math.round(buffer.byteLength / 1024 / 1024);
  await platform.pushLineMessage(groupId, `🎙 收到會議錄音「${filename}」,葉小蝸整理中(${minutes > 60 ? '較長錄音約 5-10 分鐘' : '約 3-5 分鐘'}),完成後在此發布。`)
    .catch((error) => console.warn(`Meeting processing acknowledgement failed (group=${groupId}): ${error.message}`));

  const parsed = await geminiTranscribeParsed({ tenant, buffer, filename, contentType, sourceIsVideo, roster: {}, cfg });
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
  await appendToggleSection(meeting.id, '📄 摘要(會議記錄)', summaryTabBlocks(parsed, 'work', { formalTasks: false }));
  await appendToggleSection(meeting.id, '📝 筆記(分區詳細記錄)', notesTabBlocks(parsed));

  const todos = (parsed.todos || []).slice(0, 30);
  const url = await shareableUrl(meeting.id, meeting.url);
  const publicUrl = publicMeetingUrl(meeting.id, tenant);
  await sendMeetingToLine(groupId, parsed, { legendLine: '', date: today, type: meetingType, url, publicUrl, defaultTitle: cfg.defaultTitle });
  if (!rollout.review) {
    if (todos.length) await platform.pushLineMessage(groupId, `📌 本次辨識 ${todos.length} 項待辦候選，已隨會議記錄保存；尚未建立正式待辦。`).catch(() => {});
    console.log(`Meeting processed as record-only: ${parsed.title}, ${todos.length} todos.`);
    return true;
  }
  const session = createReviewSession({
    tenant,
    binding,
    groupId,
    hostName: senderName,
    hostUserId: senderUserId || '',
    meetingId: meeting.id,
    meetingUrl: url,
    publicUrl,
    projectPageId: binding?.projectPageId || '',
    perGroup,
    todos,
    meetingMode: rollout.effectiveMode,
    policyVersion: MEETING_POLICY_VERSION,
  });
  await persistReviewSession(session);
  if (!reviewLiffId(session) || !reviewUrl(session.id, tenant)) {
    await retainCandidatesFailClosed(session, 'LIFF 或安全待辦確認連結尚未完成設定');
  } else {
    await platform.pushLineMessage(groupId, meetingReviewLineText(session));
  }
  console.log(`Meeting processed (Gemini fallback, mode=${rollout.effectiveMode}): ${parsed.title}, ${todos.length} todos.`);
  return true;
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
  handlePublicRequest, // (req,res,pathname) GET 公開會議頁 / POST 固定拒絕;回 true=已處理
  // core/server 的模組路由掛載點(collectRoutes 會蒐集 mod.routes)。公開會議頁免登入、
  // 路徑不帶租戶(靠 id+簽章定位,由平台共用 Notion token 讀取);所有租戶都由此唯一入口掛載。
  // 不限 method:GET=看,POST=明確拒絕；公開簽章不能取代 Portal / 群組授權。
  routes: [{
    prefix: '/meetings/manage',
    access: { kind: 'tenant', capability: 'groups.core', denied: 'handler' },
    handler: async (req, res, rctx) => {
      if (!meetingAdminHandler) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: '會議功能管理服務尚未初始化。' }));
      }
      return meetingAdminHandler(req, res, rctx);
    },
  }, {
    prefix: '/m',
    access: { kind: 'public', scope: 'signed-link' },
    handler: async (req, res, { pathname }) => {
      const handled = await handlePublicRequest(req, res, pathname);
      if (!handled) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
    },
  }, {
    prefix: '/meetings/review',
    access: { kind: 'public', scope: 'signed-link' },
    handler: async (req, res, { pathname, url, tenant, tenants }) => {
      const handled = await handleMeetingReviewRequest(req, res, { pathname, url, tenant, tenants });
      if (!handled) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
    },
  }],
  consumeRoster,       // (ctx) 直接以與會資訊收斂發布(外層已判定 pending 時用)
  processRecording,    // (ctx) 無 AssemblyAI 時的 Gemini 直轉
};

// 測試用內部匯出(不影響正式流程)
export const __test = { meetingPrompt, normalizeParsed, normalizeMeetingContentType, withNextMeetingTodo, summarize, summaryTabBlocks, formalTasksEnabled, meetingRolloutPolicy, sessionMeetingMode, sessionCanReview, sessionCreatesFormalTasks, notesTabBlocks, publishMeeting, resolveMeetingsTarget, provisionMeetingsDb, normalizeTodo, hasRequiredTodoFields, reviewSummary, renderReviewHtml, pushMeetingReviewNotification, beginMeetingReview, lineProfileFromAccessToken, ensureSessionMemberBestEffort, createReviewSession, persistReviewSession, loadReviewSessionFromMeeting, autoCompleteReviewSession, finishReviewSession, completeWithoutReview, reviewSessions };

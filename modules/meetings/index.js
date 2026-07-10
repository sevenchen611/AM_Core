// AM Platform 模組:meetings
// ─────────────────────────────────────────────────────────────────────────
// 會議錄音 → 反問「與會者(含發言順序)/主題」→ AssemblyAI 轉寫+講者分離
//   → 依發言順序對齊真名 → Gemini 收斂署名摘要 → 建會議記錄(三分頁)+待辦 → 發布。
//   AssemblyAI(上傳/轉寫)失敗會自動改用 Gemini 直讀音檔備援(無署名逐字稿,但摘要/筆記/待辦照樣產出);
//   完全無 ASSEMBLYAI key 時走 Gemini 直轉。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入「共用能力」(所有租戶相同):notionRequest / pushLineMessage / drive 助手 / AI 金鑰。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」:自己的 Notion 資料源(meetings/tasks/projects)、Drive 根資料夾。
//   - 模組狀態(會議待補 pending)一律以「(租戶, 群組)」為鍵,不同租戶不互相污染。
//
// 功能與 BuildAM src/meeting.js 完全等同,只是重組成模組形狀。

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
function meetingLineText({ parsed, legendLine, date, type, url }) {
  const L = [`📋 會議記錄|${date} ${parsed.title || '工程會議'}(${type})`];
  if (legendLine) L.push(`講者:${legendLine}`);
  const hi = parsed.highlights || [];
  if (hi.length) L.push(`\n💡 重點摘要\n${hi.map((h) => `・${h}`).join('\n')}`);
  const con = parsed.conclusions || [];
  if (con.length) L.push(`\n✅ 主議題結論\n${con.map((c) => `・${c}`).join('\n')}`);
  const todos = parsed.todos || [];
  L.push(`\n📅 待辦 ${todos.length} 項${todos.length ? '\n' + todos.map((t, n) => `${n + 1}. ${t.content}${t.owner ? `(${t.owner})` : ''}${t.due ? ` 期限${t.due}` : ''}`).join('\n') : ':(無)'}`);
  if (parsed.nextMeeting) L.push(`\n🔔 下次會議:${parsed.nextMeeting}`);
  L.push(`\n📄 完整記錄(含分區筆記與逐字稿):${url}`);
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

// 固定工程術語詞庫(餵給 AssemblyAI keyterms,降低專有名詞聽錯率)
const BASE_KEYTERMS = [
  '茲心園', '草悟道館', '葉綠宿', '拆除', '泥作', '木作', '水電', '油漆', '防水',
  '鋁窗', '放樣', '封板', '矽酸鈣板', '天花板', '輕隔間', '系統櫃', '交底', '審圖',
  '驗收', '管道間', '樑柱', '隔音', '牆面', '地坪', '衛浴', '弱電', '消防', '空調',
];

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
  try {
    // 1. 解析與會資訊(主題/與會者/發言順序/專有詞/所屬專案)
    const roster = await parseRoster(rosterAnswer);
    // 專案歸屬:預設綁定專案,與會回覆若指名 ZS/HZ/SYS 則改掛
    let projectPageId = binding?.projectPageId || '';
    if (roster.projectCode) {
      const pid = await resolveProjectByCode(roster.projectCode, tenant);
      if (pid) projectPageId = pid;
    }
    // 2-4. 優先 AssemblyAI 轉寫+講者分離 → Gemini 署名整理;失敗則自動改 Gemini 直讀備援
    let parsed, diarized = '', legend = new Map();
    try {
      const tr = await transcribeWithAssembly({ buffer, filename, contentType, roster });
      legend = buildSpeakerLegend(tr.utterances, roster.speakers);
      diarized = renderDiarized(tr, legend);
      parsed = await summarize({ diarized, roster, legend });
    } catch (assemblyErr) {
      console.warn(`AssemblyAI path failed, fallback to Gemini-direct: ${assemblyErr.message}`);
      await platform.pushLineMessage(groupId, '⚠ 逐字轉寫服務忙線,改用備援方式整理(這次不附署名逐字稿),稍候發布。').catch(() => {});
      parsed = await geminiTranscribeParsed({ buffer, filename, contentType, roster });
    }
    if (roster.topic) parsed.title = roster.topic; // 使用者主題優先
    // 5. 落地 + 發布
    await publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, answeredBy, filename, audioDriveUrl, tenant, binding });
  } catch (error) {
    console.warn(`Meeting finalize failed (key=${key}): ${error.message}`);
    await platform.pushLineMessage(groupId, `⚠ 會議記錄整理失敗(${error.message.slice(0, 90)})。錄音原檔已存 Drive,可重傳再試或聯絡 Seven。`).catch(() => {});
  }
}

// 會議樣式:分享型關鍵字(讀書會/心得分享等)→ 用「分享」格式;其餘一律「工作」。
const SHARE_HINT = /讀書會|分享會|分享型|心得|座談|沙龍|工作坊|讀經|讀書/;
const kindFromText = (s) => (SHARE_HINT.test(String(s || '')) ? 'share' : '');

// ── 與會資訊解析 ───────────────────────────────────────────
async function parseRoster(answer) {
  const empty = { topic: '', speakers: [], keyterms: [], projectCode: '', kind: 'work' };
  if (!answer || !answer.trim()) return empty;
  const fallbackKind = kindFromText(answer) || 'work';
  if (!platform.minimaxApiKey && !platform.geminiKey) return { topic: answer.trim().slice(0, 40), speakers: [], keyterms: [], projectCode: '', kind: fallbackKind };
  try {
    const raw = await textLLM(`以下是使用者提供的一場會議/聚會的與會資訊。請抽取成 JSON:
{"kind":"work|share","topic":"主題(15字內)","project":"ZS|HZ|SYS 或空字串","speakers":[{"order":1,"name":"姓名","role":"職務/角色","gender":"男|女|"}],"keyterms":["需要被正確辨識的人名或專有名詞",...]}
規則:
- kind:一般工作/工程會議填 "work";讀書會、心得分享、座談、分享會等「分享/討論型」聚會填 "share";不確定填 "work"。
- project:若提到「茲心園」填 ZS;提到「草悟道」或「草屋」填 HZ;提到「系統」填 SYS;沒提到就空字串。
- speakers 依「發言順序」由小到大排列。
- keyterms 放所有人名與可能被聽錯的術語、案場名。
只輸出 JSON,不要說明。
使用者輸入:
${answer.trim().slice(0, 1000)}`);
    const j = extractJson(raw);
    const code = String(j.project || '').trim().toUpperCase();
    return {
      topic: String(j.topic || '').trim(),
      projectCode: ['ZS', 'HZ', 'SYS'].includes(code) ? code : '',
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
async function transcribeWithAssembly({ buffer, filename, contentType, roster }) {
  const auth = { Authorization: platform.assemblyKey }; // 原始 key,不加 Bearer

  // 1. 上傳原始位元組(非 multipart);上傳偶發 422/5xx 會自動重試
  const up = await fetchRetry('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: auth, body: buffer }, { tries: 4, label: 'AssemblyAI upload' });
  const uploadUrl = JSON.parse(await up.text()).upload_url;

  // 2. 提交(keyterms=人名+工程術語;prompt=主題+與會者;省略 language_code 讓中英夾雜原生切換)
  const names = roster.speakers.map((s) => s.name);
  const keyterms = [...new Set([...names, ...roster.keyterms, ...BASE_KEYTERMS])]
    .filter((t) => t && t.length <= 24).slice(0, 100);
  const who = roster.speakers.map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、');
  const promptText = [
    '台灣旅宿室內裝修工程會議,繁體中文為主、夾雜英文工程術語。',
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

// ── Gemini 收斂(署名摘要/決議/待辦)────────────────────────
async function summarize({ diarized, roster, legend }) {
  const who = [...legend.values()].join('、');
  const raw = await textLLM(meetingPrompt({ who, topic: roster.topic, today: todayStr(), kind: roster.kind }) + `\n\n逐字稿:\n${diarized}`);
  return normalizeParsed(extractJson(raw));
}

// 會議記錄整理指示(AssemblyAI 逐字稿路徑與 Gemini 直轉路徑共用)。
// kind='work' → 工作/工程會議格式(定案、待辦);kind='share' → 分享/討論型格式(讀書會、心得分享)。
function meetingPrompt({ who, topic, today, kind = 'work' }) {
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
  return `這是一場台灣旅宿室內裝修工程會議${who ? `(已標註講者的逐字稿)。與會者:${who}` : '的錄音'}。${topic ? `會議主題:${topic}。` : ''}(繁體中文)
${dateNote}

請仔細聽/讀完整場,整理成結構化、可追蹤的會議記錄。要求:
- 逐條記錄討論脈絡與「具體細節」:空間/房型、尺寸、材質、規格、品牌、金額、做法,以及每位與會者的主張與理由。寧可詳盡,不要過度濃縮。
- 依主題或空間分區段(例:01房需求、02房家電、03房格局與浴室…),每區段一個小標題。
- 提到誰決定/負責/主張時,一律用真名。
- 每個主議題給出明確結論(定案內容)。
- 待辦事項要具體可追蹤,盡量指出負責人與期限。
- 若會議中約定了下次會議或回報時間,務必在 nextMeeting 寫出,並在 todos 補一條「在群組發送下次會議提醒」。

只輸出 JSON,不要任何說明文字:
{
 "title":"會議主題(15字內)",
 "type":"審圖|交底|工地檢討 三選一",
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
  return {
    '會議': { title: {} },
    '類型': { select: { options: [{ name: '審圖' }, { name: '交底' }, { name: '工地檢討' }] } },
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

// ── 落地 + 發布 ────────────────────────────────────────────
async function publishMeeting({ parsed, diarized, legend, roster, projectPageId, groupId, senderName, answeredBy, filename, audioDriveUrl, tenant, binding }) {
  const today = todayStr();
  const { dbId: meetingsDb, perGroup } = await resolveMeetingsTarget(tenant, binding);
  const kind = roster?.kind === 'share' ? 'share' : 'work';
  // 工作型:限定工程類型(預設工地檢討);分享型:用 AI 給的型別(讀書會/分享會…,Notion select 自動建選項),預設分享會
  const meetingType = kind === 'share'
    ? (parsed.type || '分享會')
    : (['審圖', '交底', '工地檢討'].includes(parsed.type) ? parsed.type : '工地檢討');
  const defaultTitle = kind === 'share' ? '分享會' : '工程會議';
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

  // LINE 推完整會議記錄(不含逐字稿),過長自動分段
  await sendMeetingToLine(groupId, parsed, { legendLine, date: today, type: meetingType, url: meeting.url });
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

// ── Gemini 共用 ────────────────────────────────────────────
async function geminiText(promptText) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${platform.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': platform.geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

// 文字 LLM(解析與會資訊 / 寫摘要):MiniMax 主(付費穩、不吃 Gemini 免費配額)→ Gemini 備援。
// 回傳純文字(已去 MiniMax-M3 的 <think> 推理段)。「聽」音檔仍走 AssemblyAI/Gemini,不經此。
async function textLLM(promptText) {
  if (platform.minimaxApiKey && platform.aiJudgeModel) {
    try {
      const r = await fetch(`${platform.minimaxBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${platform.minimaxApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: platform.aiJudgeModel, max_tokens: 8000, messages: [{ role: 'user', content: promptText }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`MiniMax ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
      const content = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (content) return content;
      throw new Error('MiniMax 回傳空內容');
    } catch (e) {
      console.warn(`[meetings] MiniMax 文字失敗,改用 Gemini 備援: ${e.message}`);
    }
  }
  return geminiText(promptText); // 備援
}
function extractJson(raw) {
  return JSON.parse((raw.replace(/```(json)?/gi, '').match(/\{[\s\S]*\}/) || ['{}'])[0]);
}

// Gemini 直接讀音檔 → 整理成 parsed(供「無 AssemblyAI key」與「AssemblyAI 失敗備援」共用)。
// 走 Google 網路(從雲端主機穩定),但無講者分離,故不產署名逐字稿。
async function geminiTranscribeParsed({ buffer, filename, contentType, roster }) {
  if (/x-m4a|m4a/i.test(contentType) || /\.(m4a|mp4)$/i.test(filename)) contentType = 'audio/mp4';
  const boundary = `mtg${Date.now()}`;
  const meta = JSON.stringify({ file: { display_name: filename } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.from(buffer),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const up = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart', {
    method: 'POST', headers: { 'x-goog-api-key': platform.geminiKey, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  const upText = await up.text();
  if (!up.ok) throw new Error(`Gemini upload failed: ${up.status} ${upText.slice(0, 200)}`);
  let file = JSON.parse(upText).file;
  for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    file = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { 'x-goog-api-key': platform.geminiKey } })).json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Gemini file state: ${file.state}`);
  const who = (roster?.speakers || []).map((s) => `${s.name}${s.role ? `(${s.role})` : ''}`).join('、');
  const prompt = meetingPrompt({ who: '', topic: roster?.topic || '', today: todayStr(), kind: roster?.kind })
    + (who ? `\n與會者(供人名辨識,依發言順序):${who}` : '');
  const gen = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${platform.geminiModel}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': platform.geminiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: contentType, file_uri: file.uri } }, { text: prompt }] }] }),
  });
  const genJson = await gen.json();
  if (!gen.ok) throw new Error(`Gemini generate failed: ${gen.status} ${JSON.stringify(genJson).slice(0, 200)}`);
  const raw = (genJson.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return normalizeParsed(JSON.parse((raw.replace(/```(json)?/gi, '').match(/\{[\s\S]*\}/) || ['{}'])[0]));
}

// ══ 後備:Gemini 直轉流程(無 AssemblyAI key 時使用)══
// ctx: { tenant, buffer, filename, contentType, binding, senderName, groupId }
async function processRecording({ tenant, buffer, filename, contentType, binding, senderName, groupId }) {
  if (/x-m4a|m4a/i.test(contentType) || /\.(m4a|mp4)$/i.test(filename)) contentType = 'audio/mp4';
  const minutes = Math.round(buffer.byteLength / 1024 / 1024);
  await platform.pushLineMessage(groupId, `🎙 收到會議錄音「${filename}」,葉小蝸整理中(${minutes > 60 ? '較長錄音約 5-10 分鐘' : '約 3-5 分鐘'}),完成後在此發布。`);

  const parsed = await geminiTranscribeParsed({ buffer, filename, contentType, roster: {} });
  const today = todayStr();
  let audioDriveUrl = '';
  if (tenant?.driveConfigured) {
    try { audioDriveUrl = await archiveAudio(buffer, filename, contentType, tenant); }
    catch (error) { console.warn(`Meeting audio Drive upload failed: ${error.message}`); }
  }

  parsed.todos = withNextMeetingTodo(parsed);
  const meetingType = ['審圖', '交底', '工地檢討'].includes(parsed.type) ? parsed.type : '工地檢討';
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
        '會議': { title: [text(`${today} ${parsed.title || '工程會議'}`)] },
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

  await sendMeetingToLine(groupId, parsed, { legendLine: '', date: today, type: meetingType, url: meeting.url });
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
  consumeRoster,       // (ctx) 直接以與會資訊收斂發布(外層已判定 pending 時用)
  processRecording,    // (ctx) 無 AssemblyAI 時的 Gemini 直轉
};

// 測試用內部匯出(不影響正式流程)
export const __test = { meetingPrompt, normalizeParsed, withNextMeetingTodo, summarize, summaryTabBlocks, notesTabBlocks, publishMeeting, resolveMeetingsTarget, provisionMeetingsDb };

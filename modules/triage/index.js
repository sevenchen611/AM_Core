// AM Platform 模組:triage(AI 初判)
// ─────────────────────────────────────────────────────────────────────────
// collect 落庫「之後」,對有專案脈絡的文字訊息做初判:
//   過濾層1(系統轉貼) → AI judge(空間/工項/類型/信心度) → 過濾層2(高信心閒聊自動歸檔)。
//   其餘標「AI初判待確認」交給 queue。功能與 BuildAM src/server.js 的 AI 初判完全等同。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(所有租戶相同):notionRequest / AI 金鑰(provider 可切)/ logger。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」:自己的空間/工項/訊息資料源、專案脈絡。
//   - 模組狀態(專案脈絡快取)一律以「(租戶, 專案)」為鍵,不同租戶不互相污染。
//   - 依賴 collect:訊息頁由 collect 建立,其 id 經 ctx.messagePageId 傳入(triage 不建頁,只寫回)。

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具 ─────────────────────────────────────────────────
const textItem = (content) => ({ type: 'text', text: { content: String(content) } });

const MESSAGE_TYPES = ['進度回報', '問題反映', '提問', '一般對話'];
const CONFIDENCE_LEVELS = ['高', '中', '低'];

// per-tenant 隔離守衛的 notionRequest(一律帶 tenantKey,只允許該租戶宣告的資料源)
const nr = (tenant, pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: tenant.key });

// AI 是否可用(金鑰由 platform 注入;provider 可切 minimax / anthropic)
function aiConfigured() {
  const provider = platform.aiProvider;
  if (provider === 'minimax') return Boolean(platform.minimaxApiKey && platform.aiJudgeModel);
  if (provider === 'anthropic') return Boolean(platform.anthropicApiKey && platform.aiJudgeModel);
  return false;
}

// 此租戶是否啟用 triage:需有空間/工項脈絡(否則整體 no-op)
function enabledFor(tenant) {
  return Boolean(tenant?.dataSources?.spaces && tenant?.dataSources?.workItems);
}

// ── 專案脈絡(記憶體快取,鍵=（租戶,專案）)──────────────────
const projectContextCache = new Map();
const PROJECT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const ckey = (tenant, projectPageId) => `${(tenant && tenant.key) || 'default'}::${projectPageId}`;

async function loadProjectContext(tenant, projectPageId) {
  const key = ckey(tenant, projectPageId);
  const cached = projectContextCache.get(key);
  if (cached && Date.now() - cached.at < PROJECT_CONTEXT_TTL_MS) return cached;
  const spaces = await queryAllByProject(tenant, tenant.dataSources.spaces, projectPageId, '名稱', '別名');
  const workItems = await queryAllByProject(tenant, tenant.dataSources.workItems, projectPageId, '工項');
  const context = { spaces, workItems, at: Date.now() };
  projectContextCache.set(key, context);
  return context;
}

async function queryAllByProject(tenant, dataSourceId, projectPageId, titleProperty, aliasProperty) {
  const items = [];
  let cursor;
  do {
    const body = { filter: { property: '專案', relation: { contains: projectPageId } }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await nr(tenant, `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: 'POST', body });
    for (const page of result.results || []) {
      const name = (page.properties?.[titleProperty]?.title || []).map((t) => t.plain_text || '').join('');
      if (!name) continue;
      const item = { id: page.id, name };
      if (aliasProperty) {
        const alias = (page.properties?.[aliasProperty]?.rich_text || []).map((t) => t.plain_text || '').join('').trim();
        if (alias) item.alias = alias;
      }
      items.push(item);
    }
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);
  return items;
}

// ── AI 初判 ─────────────────────────────────────────────────
function buildJudgePrompt({ text, senderName, binding, context }) {
  const roleLabel = binding.trade ? `${binding.role}群(工種:${binding.trade})` : `${binding.role}群`;
  const aliasEntries = context.spaces.filter((s) => s.alias);
  const aliasBlock = aliasEntries.length
    ? `\n空間別名對照(訊息可能使用舊房號或俗稱,對應後仍必須回傳正式名稱):${JSON.stringify(Object.fromEntries(aliasEntries.map((s) => [s.alias, s.name])))}`
    : '';
  return `你是旅宿工程專案的訊息分類助手。以下是工地 LINE 群組的一則訊息,請判斷掛載目標與訊息類型。

群組角色:${roleLabel}
空間清單:${JSON.stringify(context.spaces.map((s) => s.name))}${aliasBlock}
工項清單:${JSON.stringify(context.workItems.map((w) => w.name))}

訊息(發送者 ${senderName}):「${text}」

輸出一個 JSON 物件,欄位:
- space:最可能相關的空間,必須從空間清單原文選一個,沒把握就 null
- work_item:最可能相關的工項,必須從工項清單原文選一個,沒把握就 null
- message_type:從「進度回報/問題反映/提問/一般對話」選一個(問題反映=現場發現的問題、瑕疵、異常、需要處理的狀況)
- ticket_suggested:此訊息是否應開立圖面問題回饋單(true/false)
- confidence:高/中/低(space 或 work_item 沒把握時降低)
- reason:一句話理由

只輸出 JSON,不要任何其他文字或 markdown 標記。`;
}

async function callAiJudge(prompt) {
  if (platform.aiProvider === 'minimax') {
    const response = await fetch(`${platform.minimaxBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${platform.minimaxApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: platform.aiJudgeModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 3000,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      const error = new Error(`MiniMax failed: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
      error.retryable = response.status === 429 || response.status >= 500 || response.status === 529;
      throw error;
    }
    return json.choices?.[0]?.message?.content || '';
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': platform.anthropicApiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: platform.aiJudgeModel,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(`Anthropic failed: ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  return (json.content || []).map((block) => block.text || '').join('');
}

function extractJudgeJson(content) {
  const withoutThink = String(content).replace(/<think>[\s\S]*?<\/think>/g, '');
  const cleaned = withoutThink.replace(/```(json)?/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object in AI response: ${cleaned.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

// 對一則有專案脈絡的文字訊息做 AI 初判,並把結果寫回訊息頁。
// ctx-lite: { tenant, messagePageId, text, senderName, binding }
async function judgeMessage({ tenant, messagePageId, text, senderName, binding }) {
  const context = await loadProjectContext(tenant, binding.projectPageId);

  let content;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      content = await callAiJudge(buildJudgePrompt({ text, senderName, binding, context }));
      break;
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  if (content === undefined) throw lastError;

  const parsed = extractJudgeJson(content);
  const space = context.spaces.find((s) => s.name === parsed.space) || null;
  const workItem = context.workItems.find((w) => w.name === parsed.work_item) || null;
  const messageType = MESSAGE_TYPES.includes(parsed.message_type) ? parsed.message_type : '一般對話';
  const confidence = CONFIDENCE_LEVELS.includes(parsed.confidence) ? parsed.confidence : '低';

  const judgement = {
    space: space ? { id: space.id, name: space.name } : null,
    work_item: workItem ? { id: workItem.id, name: workItem.name } : null,
    message_type: messageType,
    ticket_suggested: Boolean(parsed.ticket_suggested),
    confidence,
    reason: String(parsed.reason || '').slice(0, 300),
    model: platform.aiJudgeModel,
    judged_at: new Date().toISOString(),
  };

  // 過濾層 2:AI 高信心判定為「一般對話」→ 自動歸檔,不進佇列(留紀錄可稽核,審核視圖可修正)
  const autoArchive = messageType === '一般對話' && confidence === '高';
  const properties = {
    'AI 訊息類型': { select: { name: messageType } },
    'AI 信心度': { select: { name: confidence } },
    'AI 初判結果': { rich_text: [textItem(JSON.stringify(judgement).slice(0, 1900))] },
    '掛載狀態': { select: { name: autoArchive ? '一般對話' : 'AI初判待確認' } },
  };
  if (autoArchive) {
    properties['確認者'] = { rich_text: [textItem('葉小蝸(高信心自動歸檔)')] };
    properties['確認時間'] = { date: { start: new Date().toISOString() } };
  }
  await nr(tenant, `/v1/pages/${encodeURIComponent(messagePageId)}`, { method: 'PATCH', body: { properties } });
  return judgement;
}

// ── 過濾層 1:系統通知的轉貼/測試訊息 → 直接歸檔為一般對話 ──
const SYSTEM_ECHO_RE = /^(⏰|🔔|📣|🚨|📋|✅)?\s*(回饋單|催辦|升級通知|會議記錄|擱置單)|真標記測試|^測試$/;
function looksLikeSystemEcho(text) {
  return SYSTEM_ECHO_RE.test(text.trim());
}

async function archiveSystemEcho(tenant, messagePageId) {
  await nr(tenant, `/v1/pages/${encodeURIComponent(messagePageId)}`, {
    method: 'PATCH',
    body: { properties: {
      '掛載狀態': { select: { name: '一般對話' } },
      'AI 訊息類型': { select: { name: '一般對話' } },
      '確認者': { rich_text: [textItem('葉小蝸(自動歸檔)')] },
      '確認時間': { date: { start: new Date().toISOString() } },
    } },
  }).catch((error) => platform.logger.warn(`auto-archive failed: ${error.message}`));
}

// ── 模組契約:每則訊息(collect 之後)────────────────────────
// ctx: { tenant, binding, isMaster, senderName, text, messagePageId, ... }
// 回傳 true = 已處理(系統轉貼歸檔 or 完成 AI 初判)→ 短路後續模組;false = 不適用,續跑。
async function onMessage(ctx) {
  const { tenant, binding, isMaster, senderName } = ctx;
  const text = ctx.text;

  // per 租戶啟用門檻:需有空間/工項脈絡
  if (!enabledFor(tenant)) return false;
  // 只判「非總管群、有專案脈絡、非空白文字」訊息(比照 BuildAM)
  if (isMaster) return false;
  if (!binding?.projectPageId) return false;
  if (!text || !text.trim()) return false;

  // 訊息頁由 collect 建立;無頁 id 則無從寫回(collect 未提供 → 不處理)
  const messagePageId = ctx.messagePageId;
  if (!messagePageId) return false;

  // 過濾層 1:系統轉貼/測試 → 直接歸檔,不勞駕 AI
  if (looksLikeSystemEcho(text)) {
    await archiveSystemEcho(tenant, messagePageId);
    return true;
  }

  // AI 未配置:只跑過濾層 1,不呼叫 LLM(交給 queue 以「未掛載」呈現)
  if (!aiConfigured()) return false;

  // AI 初判(層 2 高信心閒聊自動歸檔在 judgeMessage 內);失敗不影響訊息收集
  try {
    await judgeMessage({ tenant, messagePageId, text, senderName, binding });
  } catch (error) {
    platform.logger.warn(`AI judge failed (tenant=${tenant.key}, page=${messagePageId}): ${error.message}`);
    return false;
  }
  return true;
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'triage',
  init,
  onMessage,           // (ctx) collect 之後做 AI 初判;已處理回傳 true 短路
  judgeMessage,        // (ctx-lite) 直接對訊息做初判並寫回(供測試/未來排程)
  loadProjectContext,  // (tenant, projectPageId) 載入空間/工項脈絡
};

// 測試用內部匯出(不影響正式流程)
export const __test = { buildJudgePrompt, extractJudgeJson, looksLikeSystemEcho, enabledFor, aiConfigured };

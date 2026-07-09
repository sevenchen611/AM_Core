// modules/construction — AI 初判領域分類器(空間/工項)
// ─────────────────────────────────────────────────────────────────────────
// 抽自 BuildAM src/server.js 的 loadProjectContext / buildJudgePrompt / callAiJudge /
// extractJudgeJson / judgeMessage 的「分類」部分。這是**工程領域知識**:
//   prompt 讀「該專案的空間清單 / 工項清單 / 空間別名」,並以「旅宿工程」語境判斷
//   掛載目標(空間・工項)、訊息類型、是否建議開回饋單。故歸 construction 擁有。
//
// 邊界(與 collect / triage 協調):
//   - collect 只落庫;triage 只保留「通用管線」(系統轉貼過濾層1 / 高信心閒聊自動歸檔層2 / 寫回訊息頁狀態)。
//   - 「怎麼分類」= 本檔。triage 於 collect 之後呼叫 construction.classify(ctx) 取得 judgement,
//     再由 triage 自己決定 autoArchive 並寫回訊息頁的通用工作流欄位(掛載狀態/確認者/確認時間)。
//   - 本檔**不寫 Notion 訊息頁狀態**(那是 triage/queue 的通用工作流),只讀空間/工項脈絡 + 產 judgement。
//
// 多租戶:一律吃 deps(由 construction/index.js 依 ctx.tenant + platform 每次組出),
//   deps.notionRequest 已鎖定該租戶 tenantKey,deps.dataSources 為該租戶自己的庫。
//   ⚠️ 絕不使用模組級全域 deps;deps 逐呼叫傳入。專案脈絡快取以(租戶,專案)為鍵。

import { plain } from './common.js';

const MESSAGE_TYPES = ['進度回報', '問題反映', '提問', '一般對話'];
const CONFIDENCE_LEVELS = ['高', '中', '低'];

// ── 此租戶能否做初判 / AI 是否可用 ─────────────────────────────
// enabledFor:需有空間 + 工項脈絡(否則整體 no-op,非工程租戶自動略過)。
export function enabledFor(dataSources) {
  return Boolean(dataSources?.spaces && dataSources?.workItems);
}

// deps.ai = { provider, anthropicApiKey, minimaxApiKey, minimaxBaseUrl, judgeModel }
export function aiConfigured(ai) {
  if (!ai?.judgeModel) return false;
  if (ai.provider === 'minimax') return Boolean(ai.minimaxApiKey);
  if (ai.provider === 'anthropic') return Boolean(ai.anthropicApiKey);
  return false;
}

// ── 專案脈絡(空間/工項清單;記憶體快取,鍵=(租戶,專案))────────
const projectContextCache = new Map();
const PROJECT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const ckey = (deps, projectPageId) => `${deps.tenantKey || 'default'}::${projectPageId}`;

export async function loadProjectContext(deps, projectPageId) {
  const key = ckey(deps, projectPageId);
  const cached = projectContextCache.get(key);
  if (cached && Date.now() - cached.at < PROJECT_CONTEXT_TTL_MS) return cached;
  const spaces = await queryAllByProject(deps, deps.dataSources.spaces, projectPageId, '名稱', '別名');
  const workItems = await queryAllByProject(deps, deps.dataSources.workItems, projectPageId, '工項');
  const context = { spaces, workItems, at: Date.now() };
  projectContextCache.set(key, context);
  return context;
}

export function clearContextCache(tenantKey) {
  if (!tenantKey) { projectContextCache.clear(); return; }
  for (const k of projectContextCache.keys()) if (k.startsWith(`${tenantKey}::`)) projectContextCache.delete(k);
}

async function queryAllByProject(deps, dataSourceId, projectPageId, titleProperty, aliasProperty) {
  const items = [];
  let cursor;
  do {
    const body = { filter: { property: '專案', relation: { contains: projectPageId } }, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const result = await deps.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, { method: 'POST', body });
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

// ── 領域 prompt(旅宿工程語境;讀空間/工項/別名)──────────────
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

async function callAiJudge(ai, prompt) {
  if (ai.provider === 'minimax') {
    const response = await fetch(`${ai.minimaxBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ai.minimaxApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ai.judgeModel,
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
    headers: { 'x-api-key': ai.anthropicApiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ai.judgeModel,
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

// ── 對外:分類器 ───────────────────────────────────────────────
// 供 triage(collect 之後)注入呼叫。純產 judgement,**不碰 Notion 訊息頁狀態**。
// deps: { tenantKey, dataSources:{spaces, workItems}, notionRequest(已鎖租戶), ai:{provider, anthropicApiKey, minimaxApiKey, minimaxBaseUrl, judgeModel} }
// input: { text, senderName, binding:{ role, trade, projectPageId } }
// 回傳 judgement 物件;若此租戶無空間/工項脈絡或 AI 未配置 → 回傳 null(交棒通用管線以「未掛載」呈現)。
export async function classify(deps, { text, senderName, binding }) {
  if (!enabledFor(deps.dataSources)) return null;
  if (!aiConfigured(deps.ai)) return null;
  if (!binding?.projectPageId) return null;
  if (!text || !text.trim()) return null;

  const context = await loadProjectContext(deps, binding.projectPageId);

  let content;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      content = await callAiJudge(deps.ai, buildJudgePrompt({ text, senderName, binding, context }));
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

  return {
    space: space ? { id: space.id, name: space.name } : null,
    work_item: workItem ? { id: workItem.id, name: workItem.name } : null,
    message_type: messageType,
    ticket_suggested: Boolean(parsed.ticket_suggested),
    confidence,
    reason: String(parsed.reason || '').slice(0, 300),
    model: deps.ai.judgeModel,
    judged_at: new Date().toISOString(),
  };
}

// 測試用內部匯出(不影響正式流程)
export const __test = { buildJudgePrompt, extractJudgeJson, MESSAGE_TYPES, CONFIDENCE_LEVELS };

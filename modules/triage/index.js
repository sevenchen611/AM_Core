// AM Platform 模組:triage(AI 初判 · 通用管線)
// ─────────────────────────────────────────────────────────────────────────
// collect 落庫「之後」,對有專案脈絡的文字訊息跑「通用初判管線」(所有租戶共用):
//   過濾層1(系統轉貼) → 委派 construction.classify 取 judgement → 過濾層2(高信心閒聊自動歸檔) → 寫回訊息頁。
//   其餘標「AI初判待確認」交給 queue。
//
// 通用 vs 領域切線(決策 1,見 modules/EXTRACTION_PLAN.md):
//   - 兩層過濾、寫回訊息頁、決定進佇列/歸檔 = 通用,恆在 triage。
//   - 空間/工項的 prompt 與詞彙 = 領域,恆在 construction.classify(僅工程租戶)。triage 不自帶
//     buildJudgePrompt/loadProjectContext/callAiJudge,只透過 platform.classify 取 judgement。
//   - 無分類器的租戶(platform.classify 不存在 / 回 null)只跑過濾層1,不分類、交給 queue。
//
// 多租戶契約(modules/README.md):
//   - init(platform):注入共用能力(所有租戶相同):notionRequest / platform.classify(construction 掛)/ logger。
//   - 每次呼叫由 ctx.tenant 帶「租戶特定設定」;triage 本身不快取空間/工項(那是 construction.classify 的責任)。
//   - 依賴 collect:訊息頁由 collect 建立,其 id 經 ctx.messagePageId 傳入(triage 不建頁,只寫回)。

let platform = null;
function init(injected) { platform = injected; }

// ── 純工具 ─────────────────────────────────────────────────
const textItem = (content) => ({ type: 'text', text: { content: String(content) } });

// per-tenant 隔離守衛的 notionRequest(一律帶 tenantKey,只允許該租戶宣告的資料源)
const nr = (tenant, pathname, opts = {}) => platform.notionRequest(pathname, { ...opts, tenantKey: tenant.key });

// ── 過濾層 1:系統通知的轉貼/測試訊息 → 直接歸檔為一般對話 ──
// 含原工程服務的會議周邊排除語意：會議成品、機器人反問與 roster 答覆都不再進 AI 佇列。
const SYSTEM_ECHO_RE = /^(⏰|🔔|📣|🚨|📋|✅)?\s*(回饋單|催辦|升級通知|會議記錄|擱置單)|真標記測試|^測試$|會議[記紀]錄|收到會議錄音|參與者有誰|這次會議的主題/;
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

// ── 過濾層 2 + 寫回訊息頁(通用工作流;領域 judgement 由 construction.classify 產)──
// judgement:{space, work_item, message_type, ticket_suggested, confidence, reason, model, judged_at}
// 層2:AI 高信心判定為「一般對話」→ 自動歸檔,不進佇列(留紀錄可稽核,審核視圖可修正)。
async function writeJudgement(tenant, messagePageId, judgement) {
  const messageType = judgement.message_type;
  const confidence = judgement.confidence;
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
}

// ── 模組契約:每則訊息(collect 之後)────────────────────────
// ctx: { tenant, binding, isMaster, senderName, text, messagePageId, ... }
// 回傳 true = 已處理(系統轉貼歸檔 or 完成初判)→ 短路後續模組;false = 不適用/未分類,續跑(交給 queue)。
async function onMessage(ctx) {
  const { tenant, binding, isMaster, senderName, text } = ctx;

  // 只判「非總管群、有專案脈絡、非空白文字」訊息(比照 BuildAM)
  if (isMaster) return false;
  if (!binding?.projectPageId) return false;
  if (!text || !text.trim()) return false;

  // 訊息頁由 collect 建立;無頁 id 則無從寫回(collect 未提供 → 不處理)
  const messagePageId = ctx.messagePageId;
  if (!messagePageId) return false;

  // 過濾層 1:系統轉貼/測試 → 直接歸檔,不勞駕分類器
  if (looksLikeSystemEcho(text)) {
    await archiveSystemEcho(tenant, messagePageId);
    return true;
  }

  // 領域分類:委派 construction.classify(平台共用把手)。無分類器的租戶、AI 未配置、
  //   無空間/工項脈絡 → 回 null,交給 queue 以「未掛載/未確認」呈現(不短路)。
  if (typeof platform.classify !== 'function') return false;
  let judgement;
  try {
    judgement = await platform.classify({ tenant, binding, senderName, text });
  } catch (error) {
    platform.logger.warn(`classify failed (tenant=${tenant.key}, page=${messagePageId}): ${error.message}`);
    return false;
  }
  if (!judgement) return false;

  // 過濾層 2 + 寫回訊息頁(通用工作流);寫回失敗不影響訊息收集,交由 queue 呈現
  try {
    await writeJudgement(tenant, messagePageId, judgement);
  } catch (error) {
    platform.logger.warn(`judge write-back failed (tenant=${tenant.key}, page=${messagePageId}): ${error.message}`);
    return false;
  }
  return true;
}

// ── 模組契約:預設匯出 ─────────────────────────────────────
export default {
  name: 'triage',
  init,
  onMessage,           // (ctx) collect 之後跑通用初判管線;已處理回傳 true 短路
};

// 測試用內部匯出(不影響正式流程)
export const __test = { looksLikeSystemEcho, writeJudgement, SYSTEM_ECHO_RE };

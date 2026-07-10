# modules/ — 功能模組

一個功能一個資料夾。模組是**程式**，改一次、全租戶受惠。
模組**不綁死任一租戶**——它從每次呼叫的 `ctx` 拿到「現在服務的是哪個租戶」，所以同一份模組服務所有租戶。

## 模組契約（v1 — 由 `core/` 運行時定案）

```
modules/<name>/
  index.js   # 預設匯出模組物件
  README.md  # 這個功能做什麼
```

```js
export default {
  name: 'meetings',
  init(platform) {},              // 啟動時呼叫一次，注入「共用能力」(所有租戶相同)

  async onMessage(ctx) {},        // 每則訊息(帶租戶脈絡)；回傳 true = 已處理(短路後續模組)
  isAudio(message) {},            // (選用) 回傳 true 才會讓 core 把此訊息走 onAudio
  async onAudio(ctx) {},          // 綁定群收到音檔(core 已下載 buffer)；回傳 true 短路

  routes: [],                     // (選用) 網頁端點(佇列 / 儀表板 …)
  async tick(ctx) {},             // (選用) 週期任務(提醒巡邏)
};
```

### `init(platform)` — 共用能力(所有租戶共用一份，啟動時注入)

```
{
  logger,
  // Notion(內建 per-tenant 資料隔離守衛)
  notionRequest(pathname, { method, body }),   // ← 一律用這個寫 Notion
  uploadFileToNotion(buffer, filename, contentType),
  // LINE(共用同一支 OA)
  pushLineMessage(to, text, mention?), lineGet(pathname),
  downloadLineContent(messageId), resolveSenderName(source), resolveLineFilename(...),
  // Google Drive(全域憑證；目標資料夾用 ctx.tenant.driveRootFolderId)
  drive, driveConfigured, ensureDriveFolder(name, parentId), uploadToDrive(...), getDriveAccessToken(),
  // Portal 授權(web routes 用)
  portal: { pinAuthed(req), userAuthed(req), checkPin(pin) },
  // LLM(統一備援鏈)← 呼叫 AI 一律用這個
  llm: {
    completeJson({ system, userContent, schema, maxTokens, imagePaths }),  // → 解析後的物件
    completeText({ system, userContent, maxTokens, imagePaths }),          // → 純文字
    complete(...),        // → { data, backend, attempts }：想知道實際是誰答的
    available, backends, selfTest(),
  },
  // AI 金鑰(共用)⚠️ 逐步退場——留給尚未遷移的模組與非 LLM 服務(AssemblyAI)
  anthropicApiKey, assemblyKey, geminiKey, geminiModel, minimaxApiKey, minimaxBaseUrl, aiProvider, aiJudgeModel,
}
```

### `ctx` — 每次呼叫(帶「現在服務哪個租戶」的脈絡)

- **共同**：`{ tenant, binding, groupId, isMaster, senderName, event, message }`
  - `tenant`：`{ key, displayName, envPrefix, modules, parentPageId, dataSources, driveConfigured, driveRootFolderId }`
  - `binding`：該群的綁定 `{ pageId, projectPageId, role, trade, members }`(未綁定不會進到模組)
  - `isMaster`：`binding.role === '總管'`(總管群跨專案，模組據此決定是否自動判掛)
  - `ctx.notionRequest` / `ctx.pushLineMessage`：便利句柄(`notionRequest` 已鎖定本租戶 `tenantKey`)
- **`onMessage`** 另帶：`text`(文字訊息內容，非文字為 `''`)
- **`onAudio`** 另帶：`buffer`、`contentType`、`filename`、`ackSent`

### 分派規則(core 決定)

1. 依 `tenant.modules` 清單順序逐一呼叫；任一回傳 `true` 即短路後續模組。
2. 音檔候選(type=audio，或 file 且副檔名為音檔)且某模組 `isAudio(message)===true` → 走該模組 `onAudio`(core 延遲下載 buffer 一次)；否則走 `onMessage`。
3. **未綁定群**：core 直接忽略(不落庫、不回話，照 BuildAM)。

### `routes`(web) — 形狀

```js
routes: [
  { prefix: '/queue', method?: 'GET',            // 或 match(pathname) => boolean
    async handler(req, res, ctx) {} },           // ctx: { pathname, url, tenant, tenants, portal, platform }
]
```
- 租戶以 `?tenant=<key>` 指定(需在登記內)，否則預設為該 route 擁有的租戶。

### 隔離鐵律

- **寫 Notion 一律經 `platform.notionRequest`**：守衛只放行「某租戶宣告過、且位於該租戶母頁下」的資料源；目標 id 一律取自 `ctx.tenant.dataSources.*`，模組因此碰不到別租戶的庫。
- **模組內任何狀態(例如會議待補 pending)必須以「(租戶, 群組)」為鍵**(`${tenant.key}::${groupId}`)，避免跨租戶污染。
- **呼叫 AI 一律經 `platform.llm`**，不要自己 `fetch` 任何供應商、不要自己寫備援。備援鏈與成本策略集中在 `core/llm.js`(鏈序由 `AMCORE_LLM_CHAIN` 決定，預設 `minimax,gemini,anthropic`)。需要看圖就傳 `imagePaths`——抽象層只會把它交給**看得見圖的後端**，而不是讓瞎子瞎掰。
- 視覺能力是**型號**的屬性、不是廠商的屬性：MiniMax-M3 看得見圖，M2 看不見。換型號後請跑 `node scripts/check-llm.mjs`(會送一張自製彩圖實測每個宣告支援圖片的後端)。

### 參考實作（以此為準）

`modules/meetings/` 是第一個做好的模組，**其餘模組照它的形狀**：`init(platform)` 一次注入共用能力（`notionRequest` / `pushLineMessage` / drive helpers / AI keys）；其餘方法各吃 `ctx`（含 `ctx.tenant`）。模組除了 `onMessage`，可再匯出**具名方法**讓平台在特定時機呼叫——meetings 匯出 `isAudio` / `rosterPrompt` / `hasPending(tenant,groupId)` / `onAudio(ctx)` / `consumeRoster(ctx)` / `processRecording(ctx)`。

## 模組清單（權威清單見 `modules/EXTRACTION_PLAN.md`）

| 模組 | 類型 | 說明 |
|---|---|---|
| `collect` | 通用核心 | 訊息/照片落庫、群組路由（**只收不判**） |
| `triage` | 通用核心 | AI 初判**通用管線**（過濾層+寫回+進佇列/歸檔）；領域分類吃 `construction.classify` |
| `queue` | 通用核心 | 確認佇列（掛載既有目標/單據；開單委派 construction） |
| `meetings` | 通用核心 | 會議錄音→轉寫→記錄（**由平行 session 從 BuildAM 搬入**） |
| `tasks` | 通用核心 | 待辦 CRUD 共用服務 |
| `reminders` | 通用核心 | 到期/逾期/行程提醒（工程到期規則吃 `construction.reminderPasses`） |
| `construction` | 領域 | 工程專屬：回饋單/工項/預算/發包/**dashboard**/`classify`/`reminderPasses`（只有「工程」租戶啟用；拆 8A/8B/8C，整合者 8A） |

> **無獨立 `dashboard` 模組**：工程儀表板併入 `construction`（8A）。

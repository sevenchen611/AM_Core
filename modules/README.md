# modules/ — 功能模組

一個功能一個資料夾。模組是**程式**，改一次、全租戶受惠。
模組**不綁死任一租戶**——它從每次呼叫的 `ctx` 拿到「現在服務的是哪個租戶」，所以同一份模組服務所有租戶。

## 模組契約（v3 — 群組授權定版，2026-07-17）

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
  downloadLineContent(messageId), peekLineContent(messageId), streamLineContent(messageId),
  resolveSenderName(source), resolveLineFilename(...),
  // Google Drive(全域憑證；目標資料夾用 ctx.tenant.driveRootFolderId)
  drive, driveConfigured, ensureDriveFolder(name, parentId), uploadToDrive(...), getDriveAccessToken(),
  // Portal 授權(web routes 用；每次請求向 Portal 取最新帳號，不快取長效權限內容)
  portal: {
    userAuthed(req, tenant), resolveAccess(req, tenant), accessForUser(user, tenant),
    tenantScope(user, tenant), featureGranted(user, tenant, suffix)
  },
  // LLM(統一備援鏈)← 呼叫 AI 一律用這個
  llm: {                         // 平台預設
    completeJson({ system, userContent, schema, maxTokens, imagePaths, profile, chain }),  // → 解析後的物件
    completeText({ system, userContent, maxTokens, imagePaths, profile, chain }),          // → 純文字
    complete(...),        // → { data, backend, attempts }：想知道實際是誰答的
    available, backends, allBackends, profiles, selfTest(),
  },
  llmForTenant(tenant),          // 租戶覆寫 AI 金鑰時使用；模組優先取這個
  aiForTenant(tenant),           // 非 LLM 服務（AssemblyAI、音訊 Gemini）所需的租戶 AI 設定
  // AI 金鑰(共用)⚠️ 逐步退場——留給尚未遷移的模組與非 LLM 服務(AssemblyAI)
  anthropicApiKey, assemblyKey, geminiKey, geminiModel, minimaxApiKey, minimaxBaseUrl, aiProvider, aiJudgeModel,
}
```

### `ctx` — 每次呼叫(帶「現在服務哪個租戶」的脈絡)

- **共同**：`{ tenant, binding, groupId, isMaster, senderName, event, message, principal }`
  - `tenant`：`{ key, displayName, envPrefix, modules, parentPageId, dataSources, driveConfigured, driveRootFolderId, queueAccessKey, calendars, reminders, ai }`
- `binding`：該群的綁定 `{ pageId, groupId, groupName, projectPageId, projectName, role, trade, purpose, owner, capabilities, statusUpdatePolicy, defaultReminderTargets, members }`(未綁定不會進到模組)
  - `isMaster`：`binding.role === '總管'`(總管群跨專案，模組據此決定是否自動判掛)
  - `ctx.notionRequest` / `ctx.pushLineMessage`：便利句柄(`notionRequest` 已鎖定本租戶 `tenantKey`)
  - `principal`：Webhook／排程為 `{ kind: 'system', source }`；不受個人群組清單限制，但仍受 per-tenant Notion 守衛。
- **`onMessage`** 另帶：`text`(文字訊息內容，非文字為 `''`)
- **`onAudio`** 另帶：`audioMessageId`、`filename`、`ackSent`；平台支援串流時不預先下載整檔。舊呼叫才會另帶 `buffer`／`contentType`。

### 分派規則(core 決定)

1. 依 `tenant.modules` 清單順序逐一呼叫；任一回傳 `true` 即短路後續模組。
2. 音檔候選(type=audio，或 file 且副檔名／檔頭為音檔)且某模組 `isAudio(message)===true` → 走 `onAudio`；優先傳 `audioMessageId` 讓模組串流處理，舊平台才延遲下載一次 buffer。
3. **未綁定群**：core 直接忽略(不落庫、不回話，照 BuildAM)。

### `routes`(web) — 形狀

```js
routes: [
  { prefix: '/queue', method?: 'GET',            // 或 match(pathname) => boolean
    access: { kind: 'group', capability: 'queue.manage' },
    async handler(req, res, ctx) {} },           // ctx 另含 access:AccessContext、routeAccess
]
```
- 租戶以 `?tenant=<key>` 指定(需在登記內)，否則預設為該 route 擁有的租戶。
- `access.kind` 必須是下列四種之一；**未宣告或值不合法的 route 不會掛載**：

| kind | 用途 | Core 行為 |
|---|---|---|
| `public` | 不含個資的公開頁或另有短效簽章連結 | 不建立 Portal `AccessContext`；handler 必須驗自己的短效簽章。 |
| `machine` | Cron／伺服器對伺服器端點 | handler 驗證機器金鑰；執行內容使用 `system principal`。 |
| `tenant` | 預算、合約等租戶／專案級功能 | Core 先要求有效租戶權限；handler 再套用專案與特殊功能權限。 |
| `group` | 群組設定、佇列、待辦、具負責群組的案件 | Core 先要求有效租戶權限；handler 必須對每筆資料再次驗證群組 relation。 |

### `AccessContext`（Portal 後臺請求）

```js
{
  user, tenantKey, mode, allowedGroupIds,
  isPlatformOwner, isTenantAll, allowsUnassigned, authzVersion, actor,
  can(action, groupBindingId, { status }),
  assert(action, groupBindingId, { status }),
  filterBindings(rows, action),
}
```

- `mode: all` 包含該租戶現在及未來群組；`selected` 只包含 `amAccess` 指定的群組綁定 Page ID。
- 指定群組必須是「啟用」才可存取；總管群只是 `ctx.isMaster` 的營運角色，**不會自動擴張到其他群組**。
- 缺少「負責群組／群組綁定」relation 的資料屬「待分派」，僅 `isTenantAll`／平台最高管理者可讀寫。
- 所有更新、批次操作、附件讀取都必須在 PATCH／Drive 讀取前，重新讀目標頁並 `access.assert(...)`。不能只靠清單已過濾，也不能信任前端傳來的 `pageId`、附件 ID、Drive fileId、tenant 或 operator。
- 操作者一律使用 `access.actor`；不得接受瀏覽器自由填寫姓名。

### 隔離鐵律

- **寫 Notion 一律經 `platform.notionRequest`**：守衛只放行「某租戶宣告過、且位於該租戶母頁下」的資料源；目標 id 一律取自 `ctx.tenant.dataSources.*`，模組因此碰不到別租戶的庫。
- **Portal 資料再加群組守衛**：Notion 租戶守衛回答「可不可以碰這個租戶的頁」；`AccessContext` 回答「這個人可不可以碰這筆群組資料」。兩者都通過才可讀寫，任何一層都不能取代另一層。
- **LINE 建立的新待辦／案件要寫入 `ctx.binding.pageId`**；舊資料無法可靠推導時保留「待分派」，不得用群組名稱猜 relation。
- **模組內任何狀態(例如會議待補 pending)必須以「(租戶, 群組)」為鍵**(`${tenant.key}::${groupId}`)，避免跨租戶污染。
- **租戶設定只有 `tenants/*.json` 一份。** 模組不得手抄 tenant 物件或另維護 shim；否則詞彙、術語、權限與排程會漂移。
- **呼叫 AI 一律經 `platform.llm`**，不要自己 `fetch` 任何供應商、不要自己寫備援。備援鏈與成本策略集中在 `core/llm.js`(鏈序由 `AMCORE_LLM_CHAIN` 決定，預設 `minimax,gemini,anthropic`)。需要看圖就傳 `imagePaths`——抽象層只會把它交給**看得見圖的後端**，而不是讓瞎子瞎掰。
- 視覺能力是**型號**的屬性、不是廠商的屬性：MiniMax-M3 看得見圖，M2 看不見。換型號後請跑 `node scripts/check-llm.mjs`(會送一張自製彩圖實測每個宣告支援圖片的後端)。
- **依「這通呼叫要什麼」挑 profile，不要改全域鏈**：
  - `profile: 'quality'` — 長逐字稿、少量呼叫、要品質（會議摘要一類）。走 AssemblyAI LLM Gateway（轉售 Claude/GPT/Gemini），實測長逐字稿 9/9 零失敗。
  - 不給 profile（＝`cheap`）— 短 prompt、每則訊息都跑（訊息初判一類）。走 MiniMax 優先，**別為了一則 LINE 訊息去打 Claude**。
  - `chain: 'a,b,c'` 可直接指名，蓋過 profile。指名的後端若全不可用會**退回預設鏈**，不會變成空鏈。
- **空回應一律當失敗、往下一個後端落。** MiniMax 這類推理模型會把 `max_tokens` 燒光在 `<think>…</think>` 裡，剝掉後只剩空字串——`core/llm.js` 已在 `complete()` 統一擋掉。**模組不要自己判斷「回空就算了」**：那會產出一份標題空白、零內容的 Notion 頁，而且不報錯，比大聲失敗更糟。
- **重試與時間界線都在 core，模組不要自己包一層。** 暫時性錯誤（429／5xx／逾時）會退避重試同一後端；解析失敗立刻重試；金鑰錯／模型不存在則直接換人。整條鏈有 **300 秒總預算**（`budgetMs`），這才是使用者等待的上限——單一請求的 `timeoutMs`（120 秒）綁不住整條鏈。要更長只在該次呼叫傳參，不要調全域預設。

### 參考實作（以此為準）

`modules/meetings/` 是第一個做好的模組，**其餘模組照它的形狀**：`init(platform)` 一次注入共用能力（`notionRequest` / `pushLineMessage` / drive helpers / AI keys）；其餘方法各吃 `ctx`（含 `ctx.tenant`）。模組除了 `onMessage`，可再匯出**具名方法**讓平台在特定時機呼叫——meetings 匯出 `isAudio` / `rosterPrompt` / `hasPending(tenant,groupId)` / `onAudio(ctx)` / `consumeRoster(ctx)` / `processRecording(ctx)`。

## 模組清單（權威清單見 `modules/EXTRACTION_PLAN.md`）

| 模組 | 類型 | 說明 |
|---|---|---|
| `collect` | 通用核心 | 訊息/照片落庫、群組路由（**只收不判**） |
| `triage` | 通用核心 | AI 初判**通用管線**（過濾層+寫回+進佇列/歸檔）；領域分類吃 `construction.classify` |
| `queue` | 通用核心 | 確認佇列（掛載既有目標/單據；開單委派 construction） |
| `meetings` | 通用核心 | 會議錄音→轉寫→記錄；逐租戶使用 AI、Drive、Notion 與 pending 狀態 |
| `media` | 通用核心 | 圖片理解、事件關聯、附件歸檔；工程空間判斷委派 `construction.classifyPhoto` |
| `tasks` | 通用核心 | 待辦 CRUD 共用服務 |
| `reminders` | 通用核心 | 到期/逾期/行程提醒（工程到期規則吃 `construction.reminderPasses`） |
| `groups` | 通用後臺 | 租戶後臺首頁與「群組設定」表；編輯群組用途／負責人／功能，不處理 LINE 訊息 |
| `construction` | 領域 | 工程專屬：回饋單/工項/預算/發包/**dashboard**/`classify`/`reminderPasses`（只有「工程」租戶啟用；拆 8A/8B/8C，整合者 8A） |

> **無獨立 `dashboard` 模組**：工程儀表板併入 `construction`（8A）。

工程租戶的定版順序是 `collect → meetings → media → triage → queue → tasks → reminders → construction`。`meetings` 必須先於 `triage`，避免與會資訊答覆被 AI 初判短路；全部模組完成 `init` 後才開始收事件，因此 `construction` 可在清單末端註冊跨模組能力。

### 全模組授權覆蓋

| 模組 | 個人後臺授權 | 系統事件／排程 | 群組資料要求 |
|---|---|---|---|
| `collect` | 無 web route | LINE webhook `system principal` | 訊息必寫 `群組綁定`；附件必須可由附件→訊息→群組綁定追溯。 |
| `triage` | 無 web route | LINE webhook `system principal` | 只更新 collect 已建立、帶群組綁定的訊息頁。 |
| `media` | 無 web route | LINE webhook `system principal` | 只更新可追溯至來源訊息的附件／訊息頁。 |
| `meetings` | 公開簽章頁只讀 | LINE webhook `system principal` | 由群組會議建立的待辦必寫 `負責群組=ctx.binding.pageId`。 |
| `reminders` | 無個人 route | `machine` route／scheduler `system principal` | 依待辦 `負責群組` 推播；仍受租戶 Notion 守衛。 |
| `groups` | `group` | 無 | 清單與更新逐筆核對群組綁定。 |
| `queue` | `group` | 無 | 訊息、附件、批次、開單全部逐筆核對來源群組。 |
| `tasks` | `group` | LINE 建單可由 system principal 呼叫 | 清單／狀態更新依 `負責群組`；缺 relation 為待分派。 |
| `construction` | `tenant`（專案型）＋`group`（案件型） | 工程提醒由 scheduler 呼叫 | 回饋單依 `負責群組`；預算／合約維持專案特殊權限。 |

執行 `node tools/audit-module-authorization.mjs` 可核對每個租戶啟用的模組都已列入上述政策、所有 route 都有合法 access、Webhook／排程由 Core 注入 system principal，且 tenant-locked Notion 句柄沒有遺失。

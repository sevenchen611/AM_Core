# HOZO 收編 — 可直接派工的交接單

每張卡片自成一體，**整段貼進一個新 session 即可開工**（含共同前提）。
規劃背景見 [`HOZO_EXTRACTION_PLAN.md`](./HOZO_EXTRACTION_PLAN.md)。

## 派工順序

```
✅ C0  core/llm.js            (2ad91e3，已完成)
✅ C0b tenants config 區塊     (8144216，已完成)
   C1  core/event-queue.js    ← 底座，單一擁有者

   H1  conversations
    └─ H3 control-tasks        ← 幾乎所有模組都讀它
        └─ H2 extraction
        └─ 以下九張可完全並行：
           H4 next-action   H5 reports      H6 dashboard-drill
           H7 calibration   H8 attachments  H9 commands
           H10 responsibility  H11 project-proposals  H12 meeting-actions
```

> **一次派幾張？** H1 → H3 必須依序（各一個 session）。H3 一落地，其餘十張可同時開十個 session。

---

## 共同前提（每張卡片都已內含，此處僅供你查閱）

```
你在 AM 平台專案：D:\Codex_project\AM_Core（單一伺服器 + 多租戶）。

先讀（照順序）：
  PLATFORM.md                      三層架構
  modules/README.md                模組契約（★ 必讀）
  modules/HOZO_EXTRACTION_PLAN.md  本次收編的設計原則與模組清單
  modules/meetings/index.js        參考範本：模組長什麼樣子

來源（唯讀，正在生產運行，絕對不要修改）：
  D:\Codex_project\HOZO_AM\line-oa-webhook

鐵律：
1. 你只擁有 modules/<你的模組>/。不要動 core/、server.js、或別人的模組。
   若你認為 core 需要改，寫進交付報告，不要自己動手。
2. 呼叫 AI 一律用 platform.llm（completeJson / completeText / complete）。
   不要自己 fetch 任何 AI 供應商、不要自己寫備援。
3. 寫 Notion 一律用 platform.notionRequest，目標 id 取自 ctx.tenant.dataSources.*。
4. 模組內任何狀態以「(租戶, 群組)」為鍵：`${tenant.key}::${groupId}`。
5. ★ 程式通用、行業味進設定。凡是「換個租戶就不一樣」的東西
   （案場、部門、術語、報告時刻、欄位名、controller）一律從 ctx.tenant.config 讀，
   不准硬寫進程式。硬寫＝這模組只能給 HOZO 用＝這次收編失敗。
6. 行為需等同 HOZO 現況；不確定就照抄 HOZO 的邏輯，不要順手「改良」。
7. 交付前 `node --check` 每個 .js 都要過。不要對生產 Notion 做寫入測試。
8. 機密不進 git。tenants/*.json 只放結構與非機密設定。

交付報告請寫：做了什麼、對照 HOZO 哪些檔、哪些東西被抽進 tenant.config、
             留下什麼未解問題、以及你希望 core 補什麼。
```

---

# C1 — `core/event-queue.js`（底座）

> ⚠️ 底座只能一個 session 擁有。**不要與 H1–H12 並行派給不同人**。

**依賴**：無
**來源**：`HOZO_AM/line-oa-webhook/src/event-queue.js`（~300 行）、`render.yaml`（Postgres 接法）

**要做的**
webhook 事件持久化 ＋ 指數退避重試 ＋ 死信告警。平台目前 `server.js` 收到事件就直接處理，行程掛了訊息就永久消失。

**要點**
- 決策 2 已定：**用 Postgres**（`DATABASE_URL`）。沿用 HOZO 那顆 Render 執行個體最省事。
- 共用一張表 ⇒ **必須有 `tenant_key` 欄位**，並在所有查詢中帶上，否則跨租戶污染。
- **上線前確認那顆 Postgres 不是會過期的 free plan**（Render 免費 Postgres 會被回收）。
- `DATABASE_URL` 未設時要能**優雅降級**成「直接處理、不入列」，否則工程/森在兩個現有租戶會當場掛掉。

**驗收**
- 未設 `DATABASE_URL`：平台行為與今天完全相同（現有租戶零影響）。
- 有設：殺掉行程再重啟，未處理的事件會被重跑；重試耗盡進死信並告警。
- `node --check` 過。

---

# H1 — `modules/conversations`

**依賴**：無（可立刻開工）
**來源**（唯讀）：`HOZO_AM/line-oa-webhook/src/server.js`，共 2056 行，你要的部分：

| 行號 | 函式 | 你要不要？ |
|---|---|---|
| 1136 | `storeLineEventInNotion` | ✅ 主流程（但只取對話/訊息那段，見下） |
| 1312 | `resolveConversationContext` | ✅ 決定「這則訊息屬於哪個對話」 |
| 1329 | `resolveDisplayNames` | ✅ 但改用平台的 LINE 能力 |
| 1358 | `findOrCreateConversation` | ✅ |
| 1385 | `findConversationPage` | ✅ |
| 1478 | `createMessagePage` | ✅ |
| 1508 | `appendConversationContentFirst` | ✅ ★ 最新在上的關鍵 |
| 1514 | `findOrCreateConversationAnchor` | ✅ ★ 讀那段註解 |
| 1539 | `buildConversationMessageBlocks` | ✅ |
| 1586 | `updateConversationAfterMessage` | ✅ |
| 1897 | `conversationAnchorBlock` | ✅ |
| 1087 | `createOutgoingReplyMessagePage` | ✅（機器人自己發的話也要進對話） |
| 1594 | `createAttachmentPage` | ❌ 那是 **H8** 的 |
| 1246 | `createCodexCommandPage` | ❌ 那是 **H9** 的 |
| 1411 | `upsertLineGroupMemberIndex` | ❌ 那是 **H10** 的 |

**要做的**
把逐則訊息聚合成**對話主檔**（會話級，最新在上），供 `extraction`（H2）讀取整段脈絡。

## ★ 三個不看原始碼就會踩的陷阱

**① `storeLineEventInNotion` 是個「大орchestrator」，橫跨 H1/H8/H9/H10。**
你只負責：去重 → 解析對話脈絡 → 找/建對話主檔 → 建訊息頁 → 內容最前面插訊息區塊 → 更新對話主檔統計。
附件頁、指令頁、成員索引 **不要抄進來**。請在你的模組裡把它們留成**擴充點**（例如 `onMessage` 回傳 `{ conversation, messagePage }` 供其他模組接手），並在模組 README 寫清楚這個介面——H8/H9/H10 三個 session 會依賴它。

**② 「最新在上」是靠一個錨點區塊實作的，不是靠排序。**
`appendConversationContentFirst` 用 `PATCH /v1/blocks/{id}/children` 帶 `after: anchor.id`，把新訊息插在錨點**正下方**。
`findOrCreateConversationAnchor`（1514）有段 2026-06-13 的修正註解值得一讀：錨點比對**刻意用「】對話記錄」這個穩定子字串**，而不是完整前綴——因為舊頁面的錨點是「【HOZO CRM】…」、移植後是「【HOZO LINE】…」，用全字比對會在舊頁面重複建錨點，導致新訊息掉到頁尾。
**照抄這個比對策略。** 這是踩過坑修好的，不要「順手改良」成全字比對。

**③ 冪等靠 `findMessagePage(messageId)` 先查再寫。**
LINE 會重送 webhook。開頭那段 `if (existingMessage) return;` 是防重複的唯一防線，別省略。
（C1 `core/event-queue.js` 上線後會重試事件，這條更重要。）

## 契約與平台適配

- 對話主檔：`ctx.tenant.dataSources.conversations`；訊息：`ctx.tenant.dataSources.messages`。
- **不要自己 `fetch` LINE**。用 `platform.lineGet` / `platform.resolveSenderName`。
  HOZO 的 `resolveDisplayNames` 直接打 `/v2/bot/group/{id}/summary` 與 member profile —— 平台已有對應能力，改用它。
- **不要自己 `fetch` Notion**。一律 `platform.notionRequest`。
- ⚠️ **`resolveConversationContext` 支援 group / room / user 三種來源，但平台目前收不到個人訊息**：
  `server.js:96` 的 `handleEvent` 只認 `source.groupId || source.roomId`，未綁定就丟棄。
  個人對話（`user:` 分支）在平台上**現在不會被觸發**。程式碼保留該分支，但**不要為它設計測試**，也不要因此去改 `core/`——若你認為平台該支援個人訊息，寫進交付報告。

## 與現有模組的關係

- 平台的 `modules/collect` 是 **BuildAM 血統**（逐則訊息落庫、丟給 triage）。
  你這個是 **HOZO 血統**（聚合成對話級脈絡）。
  **兩者並存、不要合併、不要動 `collect`。** 租戶各自勾選（工程用 collect，HOZO 用 conversations）。

**進 tenant.config**：無 —— 這層應該是純結構的。
（`findOrCreateConversation` 會寫「總控專案」等 HOZO 味欄位嗎？不會，那是後續模組填的。若你發現有，抽進 config 並回報。）

## 驗收

- 同一則 `messageId` 送兩次 → 只寫一次。
- 新訊息出現在對話主檔內容**最上方**（錨點正下方），不是頁尾。
- 舊頁面（錨點文字為「【HOZO CRM】對話記錄」）不會被重複插入新錨點。
- 跨租戶不互相寫入（狀態以 `${tenant.key}::${groupId}` 為鍵）。
- 寫一支 `tools/dryrun-conversations.mjs`，**用 mock `notionRequest` 驗證**——照 `tools/dryrun-tasks.mjs` 的樣子（`bootstrap(env, overrides)` 可注入 mock）。
  **不要對生產 Notion 做寫入測試**（HOZO 正在運行）。
- `node --check` 全過。

---

# H3 — `modules/control-tasks`

> **H2 之前必須先完成這張**（extraction 要寫任務，得先有任務模型）。

**依賴**：H1
**來源**：HOZO「總控任務庫」schema ＋ `src/server.js` 查待辦/打開任務的路徑

**要做的**
豐富任務模型與其讀寫層。這是整個 HOZO 血統的心臟，**H4–H12 幾乎都讀它**。

狀態機：`待確認 / 未開始 / 進行中 / 等待回覆 / 待確認完成 / 已完成 / 封存`
欄位：確認狀態、優先級、來源原文、AI 判斷摘要、信心度、
**預定訊息內容 / 預定發送對象 / 下次行動時間 / 下次行動模式**

**要點**
- 比平台現有 `modules/tasks` 強得多（等待回覆追蹤、排定下次行動）。**不要改 `tasks`，另立模組**，兩者由租戶勾選。
- 「下次行動時間 / 模式」是 H4 `next-action` 的輸入契約 —— **請把讀寫這幾個欄位的 API 設計清楚並寫進模組 README**，H4 直接依賴它。
- 欄位名若各租戶不同 → 走 `ctx.tenant.config.fieldMap`。

**進 tenant.config**：`fieldMap`（選用）、優先級/狀態的顯示字串（若租戶想改稱呼）

**驗收**：狀態轉移合法性檢查；讀寫都經 `platform.notionRequest`；匯出給其他模組的方法有 README。

---

# H2 — `modules/extraction`

**依賴**：H1、H3
**來源**：`scripts/llm-task-extraction.js`（887 行）＋ `config/conversation-task-hierarchy-prompt.json` ＋ `config/task-hierarchy-judgment-contract.json`

**要做的**
**對話級 LLM 階層萃取**：讀 36 小時內的對話 → 產出任務／專案／風險／進度報告，含**信心度**與**邊界採樣**（低信心案例送 H7 校準）。

**要點**
- ★ **這張卡最容易違反最高原則。** hierarchy prompt 裡的 controlled vocabulary（案場「寓好草悟道／寓見櫻桃」、部門、房務/工務術語）**全部是 HOZO 的行業味**，必須從 `ctx.tenant.config.vocabulary` 注入，**不可留在程式或 prompt 檔的字面值裡**。
  程式該保留的是「prompt 骨架 + 注入機制 + 判準契約」。
- 用 `platform.llm.completeJson({ system, userContent, schema, maxTokens })`。schema 直接沿用 HOZO 的判準契約。
- 36 小時窗口大小也該可設定（`config.extraction.windowHours`，預設 36）。
- ⚠️ **成本**：這是全平台最耗 token 的模組。決策 3 已把本機 worker（零 API 成本）退掉，這裡的呼叫會真的計費。請在模組 README 註明單次呼叫的大致 token 量。

**進 tenant.config**：`vocabulary`（案場/部門/術語）、`extraction.windowHours`、信心度門檻

**驗收**：把 vocabulary 換成工程租戶的詞彙（茲心園/草悟道館/泥作/木作…），同一份程式要能跑出工程口味的結果。**做不到就代表沒抽乾淨。**

---

# H4 — `modules/next-action`

**依賴**：H3
**來源**：`scripts/run-scheduled-actions.js`（301 行）

**要做的**
**死人開關排程**：每 15 分掃「下次行動時間 ≤ now」的任務 → 依模式「自動發送」或「提醒我」；失敗則推延 2 小時再試。

**要點**
- 平台的 tick 目前是每 10 分鐘（`server.js` 的 `setInterval`）＋ 外部 cron 打 `/cron/tick`。用 `tick(ctx)` 實作，**不要自己開 setInterval**。
- 「自動發送」會**真的推 LINE 訊息給人**。請確保 dry-run 開關存在，且預設不對生產群組發話。
- 發送對象是 LINE user/group id ⇒ **個資，放 `.env`，不要進 tenants json**。

**進 tenant.config**：掃描間隔、失敗推延時數

**驗收**：到點觸發；失敗推延；重啟後不重複發送（冪等）。

---

# H5 — `modules/reports`

**依賴**：H3
**來源**：`src/report-pages.js`（~1000 行）、`scripts/render-cron-report.js`（269 行）、`control-api.js` 的報告路由

**要做的**
早報／跟催報／晚報，以及**六區段裁決頁**：待確認任務、等待回覆、進行中提醒、待分類、附件核准、專案提案 —— 加上 approval 回寫。

**要點**
- 這是「一頁把今天要裁決的事做完」，是整個家族對管理者最有價值的產出。
- 報告時刻表（08:30 早報／10:00・13:00・17:00 跟催／20:30 晚報…）**是設定不是程式**。
- approval 回寫要走 `platform.portal` 授權，不要自建密碼機制。
- 六個區段裡「附件核准」依賴 H8、「專案提案」依賴 H11 —— **這兩區在對應模組未上線時要能優雅地空著**，不要炸掉。

**進 tenant.config**：`reportSchedule`、六區段各自的開關

**驗收**：六區段渲染正確；核准動作回寫 Notion；缺席模組時報告仍可產生。

---

# H6 — `modules/dashboard-drill`

**依賴**：H3
**來源**：`src/dashboard-pages.js`（~600 行）、`control-api.js` 的 `/dashboard/*`

**要做的**
**三層下鑽**：全局統計 → 專案卡片牆 → 任務詳情（來源對話內嵌、拖拽編輯、改狀態/專案/負責人/母任務）。

**要點**
- 與 `modules/construction` 的工程儀表板**不同層次**，兩者並存，不要合併。
- 走模組 `routes`（見 `modules/README.md`），租戶以 `?tenant=<key>` 指定。
- 授權一律走 `platform.portal`。

**驗收**：三層都能下鑽；改欄位會寫回 Notion；跨租戶不串資料。

---

# H7 — `modules/calibration`

**依賴**：H3、H2（讀 extraction 的邊界案例）
**來源**：`scripts/judgment-calibration.js`（555）、`sync-extraction-feedback.js`（354）、`eval-extraction.js`（259）

**要做的**
**判讀校準迴圈**：邊界案例 → controller 在 LINE 上校準 → 抽出規則 → 存規則庫 → **回注 LLM prompt**。

**要點**
- 這是「讓 AI 越用越準」的機制，是整個家族最有價值的設計之一。**務必抽乾淨，工程/森在都會想要。**
- controller 是誰＝設定（LINE user id ⇒ 個資 ⇒ 放 `.env`，用 `<PREFIX>_CONTROLLER_USER_ID`）。
- 規則回注的位置在 H2 的 prompt 骨架，**兩張卡要對齊介面**：H2 請預留「額外規則注入點」。

**進 tenant.config**：規則庫上限、校準取樣策略

**驗收**：一個邊界案例走完「送審 → 人工判定 → 生成規則 → 下次 extraction 帶上該規則」。

---

# H8 — `modules/attachments`

**依賴**：H3
**來源**：`scripts/parse-attachments.js`（520 行）

**要做的**
附件自動解析（圖片／PDF／Word／Excel）；大檔與私訊圖片**隔離待核准**。

**要點**
- ★ **這張卡直接受決策 3 影響。** HOZO 的圖片解析原本綁死在本機 codex——因為它當年用的 **MiniMax-M2 看不見圖**。
  但平台現在跑的是 **MiniMax-M3，原生多模態、看得見圖**（2026-07-10 實測通過）。
  ⇒ 你只要傳 `imagePaths` 給 `platform.llm`，**最便宜的後端就能直接處理圖片解析**，不必落到 Gemini/Anthropic。抽象層會自己挑看得見圖的後端。
- ⚠️ PDF／Word／Excel **不是圖片**：MiniMax 端點只吃圖，抽象層會丟錯讓鏈落到 Gemini。非圖片檔的轉換路徑請照抄 HOZO 的做法。
- 平台現有 `collect` 只存檔不解析；**不要動它**，解析是這個模組的事。
- 「待核准」的隔離狀態要能被 H5 的第五區段讀到。

**進 tenant.config**：大檔門檻、允許的副檔名

**驗收**：丟一張含文字的圖 → 解析出文字。另跑 `node scripts/check-llm.mjs` 確認視覺鏈健在。
把型號換成 `MINIMAX_MODEL=MiniMax-M2` 且鏈只有 minimax → 應**明確失敗**而非瞎掰。

---

# H9 — `modules/commands`

**依賴**：H3
**來源**：`src/server.js` 的 `buildCommandReply`、`scripts/llm-codex-command-triage.js`（255 行）

**要做的**
LINE **指令解析與分流**：早報／報告／儀表板／查待辦／校準 ＋ 指令佇列 ＋ **安全性分級**（高風險指令 → 進待確認，不直接執行）。

**要點**
- 這是 Seven 想要的「**對話式下指令改狀態**」的基礎（總管群裡講一句話就去改單）。做好一點。
- 安全性分級是重點：**寫入型／破壞型指令一律先進待確認佇列**，不可即時執行。
- 指令觸發詞是設定（HOZO 的 `HOZO_CODEX_COMMAND_TRIGGERS`）。

**進 tenant.config**：觸發詞、各指令的風險等級

**驗收**：低風險指令即時回覆；高風險指令進佇列並回「已排入待確認」；未知指令不誤觸發。

---

# H10 — `modules/responsibility`

**依賴**：H3
**來源**：`scripts/sync-responsibility-candidates.js`（233）、`sync-line-group-options.js`（387）、`sync-line-group-member-index.js`（345）

**要做的**
**權責三層窄化**：專案 → 候選群組 → 候選負責人；並同步群組／成員索引。

**要點**
- 通用價值＝自動回答「這件事該找誰」。
- 群組成員索引與平台 `binding.members`（`core/router.js` 讀的「成員對照」）**有重疊，請先確認兩者關係**，不要各存一份互相打架。**這點若有衝突，寫進交付報告，不要自己改 core。**

**進 tenant.config**：無（純結構）

**驗收**：給定一個任務能列出候選負責人；成員索引同步不覆蓋 router 的成員對照。

---

# H11 — `modules/project-proposals`

**依賴**：H3
**來源**：`scripts/propose-projects.js`（331 行）

**要做的**
掃任務找**新專案候選** → 寫入「狀態＝候選」等待核准。

**要點**
- 核准介面由 H5 的第六區段提供；**這裡只負責產生候選**。
- 用 `tick(ctx)`，不要自己開 setInterval。

**進 tenant.config**：提案掃描頻率、成案門檻

**驗收**：一組相關任務會產生一個候選專案；重跑不重複提案（冪等）。

---

# H12 — `modules/meeting-actions`

**依賴**：H3
**來源**：`scripts/sync-meeting-actions.js`（619 行）

**要做的**
從**文字會議頁**萃取行動項目 → 建立任務。

**要點**
- ⚠️ **與平台既有的 `modules/meetings` 不同層**：`meetings` 是「錄音 → 轉寫 → 產生會議頁」，這張卡是「會議頁 → 行動項目」。兩者是上下游。
- **先評估**：這是否該直接併進 `modules/meetings` 當一個能力（`meetings` 產出會議頁後直接呼叫）？在交付報告給出你的判斷與理由，**不要擅自改動 `modules/meetings`**。
- ⚠️ `modules/meetings` **目前音檔轉寫是壞的**（AssemblyAI 422 + Gemini 上傳 400），另有 session 在處理。你的模組只吃「已存在的文字會議頁」，不受影響。

**進 tenant.config**：無

**驗收**：一份會議頁 → 正確產生任務；重跑不重複建任務。

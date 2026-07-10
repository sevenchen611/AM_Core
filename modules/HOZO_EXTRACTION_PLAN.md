# HOZO_AM 功能拆解計畫（收編進平台 · 模組化保留）

來源專案：`D:\Codex_project\HOZO_AM\line-oa-webhook`（好住寓好包租代管的 LINE 助理，服務管理者 Maggie）

> 目標：把 HOZO 的功能**拆成平台通用模組**，讓工程／森在／未來租戶都能勾來用。
> **7AM 先不動**（它與 HOZO 同血統，之後可直接接這批模組）。

---

## 0. 最高設計原則（違反這條，模組就只能給 HOZO 用）

**程式通用、行業味進設定。**

| 這些**不進程式**（進租戶設定） | 這些**才是模組程式** |
|---|---|
| 案場清單（寓好草悟道／寓見櫻桃）、部門、行業術語 | 對話萃取的演算法與 prompt 骨架 |
| 報告時刻表（08:30／10／13／17／20:30…） | 報告六區段的渲染與裁決回寫 |
| controller 是誰、alert target | 「等待回覆→跟催→裁決」的狀態機 |
| Notion 欄位名（若各租戶不同）→ 欄位映射表 | 讀寫欄位的邏輯 |
| hierarchy prompt 的 controlled vocabulary | hierarchy prompt 的注入機制 |

**⚠️ 血統提醒**：平台現有模組（collect/triage/queue/meetings/tasks/reminders/construction）是 **BuildAM 血統**（逐則訊息初判→確認佇列→掛空間/工項）。
HOZO 是 **另一套骨架**（整段對話萃取→總控任務→報告裁決→Next Action→校準）。兩套可並存，**租戶各自勾選**。

---

## 1. 底座升級（進 `core/`，全租戶受惠）

| 元件 | 來源 | 為什麼是底座不是模組 |
|---|---|---|
| **`core/llm.js`** — 可插拔 LLM 抽象，統一 `completeJson({system,userContent,schema,maxTokens,imagePaths})` 合約 + **備援鏈**（MiniMax／Gemini／Anthropic／Codex） | `src/llm-backend.js`(~400) | 所有模組都要呼叫 AI。目前各模組自己接（meetings 才剛手工做 MiniMax→Gemini 備援）→ 應統一。**做完這個，備援策略只改一處。** |
| **`core/event-queue.js`** — webhook 事件持久化＋指數退避重試＋死信告警 | `src/event-queue.js`(~300) | 目前平台收到 webhook 直接處理，掛了就掉。這層讓**所有租戶**的訊息不遺失。（Postgres 或輕量替代皆可） |

---

## 2. 通用模組（從 HOZO 抽出，工程／森在日後可勾用）

一個功能一資料夾，依平台 `modules/README.md` 契約（`init(platform)` + 方法吃 `ctx`）。

| # | 模組 | 做什麼 | HOZO 來源 | 通用價值 |
|---|---|---|---|---|
| H1 | `conversations` | 把逐則訊息聚合成**對話主檔**（會話級，最新在上），供對話級萃取讀取 | `server.js` storeLineEventInNotion／對話主檔寫入 | 任何 AM 要「理解整段對話」都需要 |
| H2 | `extraction` | **對話級 LLM 階層萃取**：36h 內對話 → 任務／專案／風險／進度報告，含信心度與邊界採樣。**詞彙由租戶設定注入** | `scripts/llm-task-extraction.js`(887) + `config/conversation-task-hierarchy-prompt.json` + `task-hierarchy-judgment-contract.json` | 比逐則初判更聰明（＝Seven 一直想要的「議題級理解」） |
| H3 | `control-tasks` | **豐富任務模型**：狀態機（待確認/未開始/進行中/**等待回覆**/待確認完成/已完成/封存）、確認狀態、優先級、來源原文、AI 判斷摘要、信心度、**預定訊息內容／預定發送對象／下次行動時間／下次行動模式** | 「HOZO 總控任務庫」schema + `server.js` 查待辦/打開任務 | 比平台現有 `tasks` 強很多（等待回覆追蹤、排定下次行動） |
| H4 | `next-action` | **死人開關排程**：每 15 分掃「下次行動時間 ≤ now」→ 依模式「自動發送」或「提醒我」；失敗推延 2h | `scripts/run-scheduled-actions.js`(301) | 極高價值：讓待辦「不會沉掉」 |
| H5 | `reports` | **早報／跟催報／晚報**＋**六區段裁決頁**（待確認任務／等待回覆／進行中提醒／待分類／附件核准／專案提案）＋ approval 回寫 | `src/report-pages.js`(~1000)、`scripts/render-cron-report.js`(269)、`control-api.js` 報告路由 | 任何 AM 的管理者都想要「一頁把今天要裁決的事做完」 |
| H6 | `dashboard-drill` | **三層下鑽**：全局統計 → 專案卡片牆 → 任務詳情（來源對話內嵌、拖拽編輯、改狀態/專案/負責人/母任務） | `src/dashboard-pages.js`(~600)、`control-api.js` `/dashboard/*` | 通用任務/專案視圖（與 construction 的工程儀表板不同層次） |
| H7 | `calibration` | **判讀校準迴圈**：邊界案例 → controller 在 LINE 校準 → 抽出規則 → 規則庫 → **回注 LLM prompt** | `scripts/judgment-calibration.js`(555)、`sync-extraction-feedback.js`(354)、`eval-extraction.js`(259) | **讓 AI 越用越準**，這是整個家族最有價值的機制之一 |
| H8 | `attachments` | 附件自動解析（圖片／PDF／Word／Excel），大檔與私訊圖片**隔離待核准** | `scripts/parse-attachments.js`(520) | 通用（平台 collect 目前只存檔不解析） |
| H9 | `commands` | LINE **指令解析與分流**：早報/報告/儀表板/查待辦/校準 + 指令佇列 + **安全性分級**（高風險→待確認） | `server.js` buildCommandReply、`scripts/llm-codex-command-triage.js`(255) | 通用（Seven 想要的「對話式下指令」的基礎） |
| H10 | `responsibility` | **權責三層窄化**：專案 → 候選群組 → 候選負責人；群組/成員索引同步 | `scripts/sync-responsibility-candidates.js`(233)、`sync-line-group-options.js`(387)、`sync-line-group-member-index.js`(345) | 通用（自動找出「這件事該找誰」） |
| H11 | `project-proposals` | 掃任務找**新專案候選** → 寫入「狀態=候選」待核准 | `scripts/propose-projects.js`(331) | 通用 |
| H12 | `meeting-actions` | 從**文字會議頁**萃取行動項目 → 建任務（**注意：與平台 `meetings`（錄音轉寫）不同層**，可併入 meetings 當一個能力） | `scripts/sync-meeting-actions.js`(619) | 通用 |

---

## 3. HOZO 租戶設定（**不是程式**）

| 設定 | 內容 |
|---|---|
| Notion 頁 + 資料源 | 11+ 個 HOZO 資料庫的 data source id（放平台 `.env` 的 `HOZO_*`） |
| `modules` | 勾選 H1–H12（＋是否要 BuildAM 血統的 collect/queue 等） |
| **詞彙**（行業味） | 案場（寓好草悟道／寓見櫻桃／公司層級）、部門、房務/工務/財務術語 → 注入 `extraction` 的 hierarchy prompt |
| 報告時刻表 | 08:30 早報／10:00・13:00・17:00 跟催／20:30 晚報／22:20 專案提案／22:45 回饋收割 |
| controller / alert | Maggie 的 LINE id、alert target |
| 欄位映射 | 若 HOZO 欄位名與通用模組預期不同 → `fieldMap` |

---

## 4. 依賴與建議順序

```
底座先行：core/llm.js  →  core/event-queue.js
   （llm 抽象一做完，meetings 的手工備援也能收斂進來）

資料鏈：H1 conversations → H2 extraction → H3 control-tasks
   （後面的模組都讀 control-tasks）

可並行（依賴 H3）：
   H4 next-action ／ H5 reports ／ H6 dashboard-drill
   H7 calibration ／ H8 attachments ／ H9 commands
   H10 responsibility ／ H11 project-proposals ／ H12 meeting-actions
```

**協作鐵律沿用**：一個 session 只擁有一個 `modules/<name>/`；不動 HOZO 生產程式（HOZO_AM 全程活著）；`node --check` 過；狀態以 (租戶,群組) 為鍵；行為等同 HOZO 現況。

---

## 5. 待決（不阻擋拆解，但上線前要定）

- **HOZO 的 LINE OA**：它現在有自己的 OA（HOZO Jr.）。收進平台要嘛 (a) 改用葉小蝸一支 OA（要重拉機器人進所有 HOZO 群），要嘛 (b) 平台支援**多 OA**（`.env` 已預留 `<PREFIX>_LINE_*` 覆寫）。
- **事件佇列的儲存**：HOZO 用 Render Postgres。平台要不要也上 Postgres，還是先用輕量替代。
- **Codex 本機 worker**：HOZO 的 AI 跑在本機 worker（OpenAI 訂閱額度）。收進平台後改走 `core/llm.js` 的雲端後端（MiniMax/Gemini/…），或保留 worker 模式。

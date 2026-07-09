# AM Platform — 遷移任務分派

> ⚠️ **源頭已改**：模組拆解的權威清單以 **`modules/EXTRACTION_PLAN.md`** 為準（反映真正做好的 core v1 介面）。本檔為早期草稿，僅供歷史參考；如有分歧以 EXTRACTION_PLAN 為準。
> **已敲定**：AI 初判＝獨立 `triage` 模組（通用）＋ `construction.classify`（領域）；`collect` 純收集不判；`dashboard` 併入 `construction`；construction 拆 8A/8B/8C，整合者＝8A。

把 BuildAM 的功能拆成平台模組。每個任務自足，可交給不同 session。先讀 `PLATFORM.md`、`modules/README.md`（模組契約）、`tenants/README.md`。

## 關鍵路徑與並行

- **`core`（任務 C）是關鍵路徑**——所有模組最後都在這裡整合。**優先開一個強 session 專做 core。**
- 其他模組**可並行起步**：對著 `modules/README.md` 的契約寫，core 完成後接上即可。
- `meetings` 已指派另一 session 進行中。

## 協作鐵律（避免相撞）

1. **一個 session 只擁有一個 `modules/<name>/` 資料夾**，別人不碰。
2. **契約（`modules/README.md`）與 `core/` 介面由 core session 擁有**；其他 session 視為唯讀規格，要改契約先提案、不擅改。
3. **不動 BuildAM 生產程式**，只在 AM_Core 內做（加法）。BuildAM 全程活著。
4. 每個模組**狀態以「(租戶, 群組)」為鍵**，不可跨租戶污染。

## 任務清單

| 任務 | 模組 | 來源（BuildAM） | 依賴 | 可並行 |
|---|---|---|---|---|
| **C** | `core/`（路由器+租戶解析+底座+伺服器） | `src/server.js` 的 plumbing | — | 關鍵路徑，先做 |
| M1 | `collect` 訊息收集 | server.js 訊息落庫、storeAttachment、照片→Drive | core | ✅ |
| M2 | `triage` AI 初判 | server.js loadProjectContext/judgeMessage/過濾層 | core, collect | ⚠️ 以 EXTRACTION_PLAN 為準 |
| M3 | `queue` 確認佇列 | `src/queue.js`（掛載部分） | core, collect | ✅ |
| M4 | `meetings` 會議 | `src/meeting.js` | core | 🔵 已指派 |
| M5 | `tasks` 待辦 | server.js 待辦展開 + 待辦任務庫 | core | ✅ |
| M6 | `reminders` 提醒 | server.js runDueReminders/升級/行程/cron | core, tasks | ✅ |
| ~~M7~~ | ~~`dashboard` 儀表板~~ | ~~`src/dashboard.js`~~ | — | ⚠️ **已作廢**：dashboard 併入 `construction`（8A），**無獨立模組**。以 EXTRACTION_PLAN 為準 |
| M8 | `construction` 工程領域 | queue.js 單據部分、budget.js、contracts.js、trades.js、SOP、**dashboard** | core, queue | ⚠️ 拆 8A/8B/8C，整合者 8A。以 EXTRACTION_PLAN 為準 |

> ⚠️ **此段的子拆法已被 EXTRACTION_PLAN 取代**：正式拆法為 **8A**(budget+contracts+trades+**dashboard**,兼整合者/擁有 index.js)、**8B**(回饋單+變更單,切 queue.js)、**8C**(初判分類器 `classify`+到期/擱置 `reminderPasses`,切 server.js)。下方 M2「judgeMessage 內嵌分類器」與 M7「獨立 dashboard」敘述**均已作廢**,一律以 `modules/EXTRACTION_PLAN.md` 為準。
> ~~M8 可再拆成三個子任務並行：**8a 單據**（回饋單/變更單狀態機）、**8b 預算＋發包**（budget.js＋contracts.js，含回寫）、**8c 工種＋SOP**（trades.js＋SOP 檢核）。~~

---

## 任務 C — 平台 core（路由器 + 租戶解析 + 底座 + 伺服器入口）

**背景**：AM 轉「單一平台+多租戶」。平台在 `D:\Codex_project\AM_Core`。先讀 PLATFORM.md、modules/README.md、tenants/README.md、tenants/*.json。參考實作＝`D:\Codex_project\BuildAM\line-oa-webhook\src\server.js`（**只抽 plumbing／底座，功能邏輯留給模組**）。

**要做**：
1. **平台入口**：`AM_Core/package.json` + `server.js`（ESM、無框架 http，比照 BuildAM）。端點 `/health`、`/webhook/line`。
2. **租戶登記載入**：讀 `tenants/*.json`；每個租戶依 `envPrefix` 從平台 `.env` 取 `<PREFIX>_NOTION_PARENT_PAGE_ID`、`<PREFIX>_*_DATA_SOURCE_ID`、（如有）`<PREFIX>_LINE_*`、AI 金鑰 → 組成 tenant 物件。
3. **路由器／租戶解析（核心）**：收到事件 → 取 `groupId` → 判斷屬哪個租戶（對各租戶的「群組綁定」庫查該群、狀態=啟用，命中即該租戶）；快取 `groupId→tenant`（TTL）。找不到＝未綁定（照 BuildAM 行為）。
4. **模組載入與分派**：依租戶 `modules` 清單載入 `modules/<name>/index.js`；建 `ctx`；依序呼叫 `onMessage/onAudio`（回傳 true 短路）；掛載各模組 `routes`；提供 `tick` 排程。
5. **共用能力（注入模組）**：
   - `notionRequest(tenant, …)`：一律經**資料隔離守衛**——只允許該租戶宣告的資料來源、且驗證位於該租戶 Notion 母頁下（比照 `assertBuildNotionTarget`，但 **per-tenant**）。
   - LINE 簽章驗證 + `pushLineMessage`（共用同一支 OA）。
   - Drive client（token/ensureFolder/upload）。
   - Portal auth（驗 `hozo_session` → `rental.hozorental.com/api/me`）給 web routes。
6. **群組綁定解析** `resolveGroupBinding` 放 core（路由器要用）；模組從 `ctx.binding` 取。
7. **總管群（role=總管）**：先保留 BuildAM 現行語意，於 core 標 `ctx.isMaster` 供模組參考。

**務必**：一支 OA/一個 webhook 是唯一入口；資料隔離**必須 per-tenant**（守衛用該租戶母頁），A 租戶不可碰 B 租戶庫；`node --check` 過；先用 **stub 回聲模組**驗證——兩租戶的群各發一則 → 分別落到各自 Notion 頁；**不碰 BuildAM 部署**。

**回報**：core 檔案結構、租戶解析與隔離實作、/health 與 stub 驗證結果、**模組載入介面最終定版（回填 `modules/README.md` 契約）**。

---

## 模組任務通用交接單（M1–M8 套用）

**背景**：同上（先讀 PLATFORM.md + modules/README.md 契約）。**core 介面若未定版，先對草稿契約寫，介面以 core session 回填為準。**

**每個任務填入下列即可派工**：
- **目標**：把 BuildAM `<來源檔>` 的 `<功能>` 抽成 `modules/<name>/`，依契約匯出 `{ name, init, onMessage/onAudio/routes/tick }`。功能不改，只重組成模組形狀、並改為**吃 ctx.tenant**（不寫死任一租戶/專案）。
- **務必**：`node --check` 過；行為等同 BuildAM 現況；狀態以 (租戶,群組) 為鍵；只擁有自己的 `modules/<name>/`；不碰 BuildAM 生產部署。
- **回報**：模組檔案、對外介面、與其他模組的相依點、驗證結果。

## M1–M8 完整交接單（每張可直接貼進一個 session）

**每張都以此開頭（共同）**：先讀 `D:\Codex_project\AM_Core\PLATFORM.md`、`modules\README.md`，並以 `modules\meetings\`（已完成）為介面範例：`init(platform)` 注入共用能力；方法吃 `ctx`（含 `ctx.tenant`）；可另出具名方法。只擁有自己的 `modules\<name>\`、不碰 BuildAM 生產部署、`node --check` 過、行為等同 BuildAM 現況、狀態以 (租戶,群組) 為鍵。回報：模組檔案、對外介面、與其他模組相依點、驗證結果。core 介面未定版前對草稿契約寫。

### M1 · collect（訊息收集）
把 BuildAM `src/server.js` 的「訊息落庫」抽成 `modules/collect/`：群組脈絡使用、發送者解析、成員對照（名字→userId）、訊息寫入該租戶「訊息」庫、照片/檔案→Drive「未歸檔/日期」＋Notion 附件預覽。匯出 `init` + `onMessage(ctx)`（寫訊息後回傳 false 讓後續模組續跑）。依賴 core。**不做 AI 判斷（那是 triage）**；寫哪個庫由 `ctx.tenant.dataSources` 決定。

### M2 · triage（AI 初判）
> ⚠️ **以 EXTRACTION_PLAN 為準**：triage 是**通用管線**,**不內嵌**空間/工項分類器。`loadProjectContext`/`buildJudgePrompt`(領域分類)由 `construction.classify`(8C)提供,triage 於 AI 段呼叫之。下段的「judgeMessage 內嵌分類」敘述為舊法。

抽 `src/server.js` 的 AI 初判成 `modules/triage/`：`loadProjectContext`、`judgeMessage`（MiniMax，可切 provider）、兩層過濾（系統轉貼直接歸檔、高信心閒聊自動歸檔）。匯出 `init` + `onMessage(ctx)`（在 collect 之後：判空間/工項/類型/信心度、寫回訊息、決定進佇列或自動歸檔；回傳 true 短路）。依賴 core、collect。**per 租戶可選啟用**（需 `ctx.tenant` 有空間/工項脈絡）；金鑰由 platform 注入。

### M3 · queue（確認佇列）
抽 `src/queue.js` 的確認佇列成 `modules/queue/`：待確認/已確認、照片縮圖、雙向連帶掛載、佇列內新增工項、**選專案掛載（總管群跨專案）**、批次確認、掛到回饋單。匯出 `init` + `routes`（`/queue`、`/queue/api/*`）。依賴 core（Portal 授權、per-tenant scope）、collect。**不含開單/單據狀態邏輯**（那在 construction，queue 只負責掛載並呼叫 construction 的開單）。

### M4 · meetings（會議）— ✅ 已完成
已由另一 session 抽好於 `modules/meetings/`，BuildAM 已改薄 shim 委派。**此為其餘模組的介面範例**，不需再派。

### M5 · tasks（待辦）
抽「待辦任務」建立/展開/狀態成 `modules/tasks/`，並**對外提供「建立任務」服務**（meetings、construction 單據都會呼叫）。匯出 `init` + `createTask(ctx)` + （如有待辦頁）`routes`。依賴 core。期限可帶時刻（＝行程）、來源（會議/回饋單/手動）、狀態機（待辦/進行中/完成/取消）。

### M6 · reminders（提醒）
抽 `src/server.js` 的提醒引擎成 `modules/reminders/`：到期/當天/逾期推播＋真 @mention 點名、逾期升級、行程前一晚+30 分、擱置復活、週一盤點、`/cron/reminders`。匯出 `init` + `tick(ctx)` + `routes`（cron 端點）。依賴 core、tasks、construction（讀逾期單據）。真 @mention 需成員對照；升級對象（總管群/內部群）per 租戶；各租戶各自巡邏。

### ~~M7 · dashboard（儀表板）~~ — ⚠️ 已作廢,併入 construction（8A）
> **無獨立 dashboard 模組**(決策 2)。`src/dashboard.js` 由 construction 的 **8A** 擁有(整檔搬入 `modules/construction/`),
> 資料由 construction 內部提供、routes 掛在 construction。非工程租戶暫無儀表板。以 `modules/EXTRACTION_PLAN.md` 為準。
> ~~抽 `src/dashboard.js` 成 `modules/dashboard/`~~。

### M8 · construction（工程領域）— 有額外事情，見下節
抽工程專屬成 `modules/construction/`（只有「工程」租戶啟用）：回饋單/變更單狀態機（`queue.js` 單據部分：擱置/復活/催辦/公告）、`budget.js`、`contracts.js`（回寫預算）、`trades.js`、SOP 檢核。匯出 `init` + `routes`（`/budget`、`/contracts`、單據相關 API）+ 供 queue 呼叫的「開回饋單」+ 供 dashboard 的 SOP/單據資料 + 供 reminders 的逾期單據來源。依賴 core、queue、tasks。

## construction 比別的模組「多做」的五件事

1. **租戶閘門**：只有 `modules` 含 `construction` 的租戶看得到；其餘租戶完全不載入。
2. **建議再拆 8a/8b/8c 並行**：8a 單據（回饋單/變更單狀態機）、8b 預算＋發包（budget＋contracts 含回寫）、8c 工種＋SOP。子任務間**先約定介面**（合約→回寫預算、單據→掛工項、trades 供 queue＋budget）。
3. **權限鍵一般化**：BuildAM 的 `am-buildam-budget` / `am-buildam-contract` 要改成 per-tenant（`am-<tenant>-budget`…）——**這條跟 core/Portal 對齊**（core 負責驗 Portal 授權，construction 提供鍵名）。
4. **編號多租戶不撞號**：`ZS-2026-001` / `-CO-` / `-CT-` 用租戶專案的館別代碼，確認跨租戶各自序號。
5. **web routes 授權/scope 一律走 core**（不信任網址參數）。

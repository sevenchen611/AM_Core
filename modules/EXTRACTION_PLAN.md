# 模組拆解計畫（唯一源頭 · SINGLE SOURCE OF TRUTH）

> 📌 **本檔為模組拆解的唯一權威源頭。** 早期草稿 `PLATFORM_TASKS.md` 已退役,任何分歧一律以本檔為準。

把 BuildAM(`D:\Codex_project\BuildAM\line-oa-webhook\src\`)的功能,依 `modules/README.md` 契約,
逐一抽成平台共用模組。**`meetings` 已完成**,可當作範本(參見 `modules/meetings/index.js` 與
BuildAM 端的綁定 `src/meeting.js` + `src/_platform/meetings/`)。

本檔是「總指揮」:每個模組一支資料夾 + 一份 README(carve-out 規格)。認領一個模組請先讀該資料夾 README。

## 範本:meetings 的做法(所有模組照抄這個模式)
1. 在 `AM_Core/modules/<name>/index.js` 寫模組:`export default { name, init, onMessage?, onAudio?, routes?, tick?, ... }`。
2. **共用能力**(所有租戶相同)由 `init(platform)` 注入:`notionRequest / pushLineMessage / drive 助手 / AI 金鑰`。
3. **租戶特定設定**(自己的 Notion 資料源、Drive 資料夾、金鑰網頁 key…)一律由每次呼叫的 `ctx.tenant` 提供。
4. **模組內任何狀態一律以 `(租戶, 群組)` 或 `(租戶, …)` 為鍵**(見 meetings 的 `pkey()`)。
5. BuildAM 綁定:**vendored 複製** 到 `BuildAM/src/_platform/<name>/` + 一層薄 shim(把舊 deps 拆成 platform + 固定 `buildam` tenant,函式名照舊 re-export),**server.js 不動**。
6. 驗證:`node --check` 通過、行為等同(mock 網路的等同性測試,見 meetings 的測法)。

## 什麼「不是」模組(留在平台底座 core/)
以下是**共用底座**,由 `init(platform)` 提供,不要抽成模組:
- LINE:`pushLineMessage`、`lineGet`、`downloadLineContent`、webhook 驗簽 `isValidLineSignature`
- Notion:`notionRequest`、資料隔離守衛 `assertBuildNotionTarget/assertBuildDataSource`、`uploadFileToNotion`
- Drive:`getDriveAccessToken`、`ensureDriveFolder`、`uploadToDrive`、`moveDriveFile`
- 身分:Portal 登入 `portalAuthed/portalUserAuthed`、`renderLoginPage`、HTTP router/伺服器

---

## ✅ 已敲定的決策(照做,不重新討論)

**決策 1 — AI 初判拆兩層(通用管線 vs 領域分類器):**
- **`triage` 模組 = 通用初判管線**(所有租戶共用):呼叫 LLM、算信心度、兩層過濾
  (層1 系統轉貼直接歸檔、層2 高信心閒聊自動歸檔)、決定進佇列或自動歸檔、寫回訊息頁。
- **領域分類器由 `construction` 提供 `classify(ctx)`**(空間/工項詞彙,**僅工程租戶**)。
  triage 有 `construction.classify` 時用之取得 judgement;沒有該分類器的租戶走通用流程/不分類。
- **`collect` = 純收集**(訊息/照片落庫),**不含任何判斷**。

**決策 2 — dashboard 併入 `construction`(非獨立模組):**
- 工程儀表板是 `construction` 的一部分(由整合者 8A 擁有),**不再是獨立 `modules/dashboard/`**。
- 非工程租戶暫無儀表板(日後要通用版再另開)。

**決策 3 — `construction` 拆 8A / 8B / 8C:**
- **8A** = `budget` + `contracts` + `trades` + `dashboard`(整檔,乾淨)。**8A 兼整合者**。
- **8B** = 回饋單 + 變更單(切 `queue.js` 的單據部分)。
- **8C** = 初判領域分類器(`classify`)+ 到期/擱置提醒 pass(切 `server.js`)。

**決策 4 — 整合者 = 8A:**
- **8A session 擁有 `modules/construction/index.js`**,負責把三部分組成單一 `construction` 模組,
  對外匯出 **`routes` / `classify` / `reminderPasses`**。
- **8B / 8C 只交自己的領域檔 + 一個 register 掛鉤**(不寫 index.js),由 8A 串接並做**最終整合驗證**。

---

## 模組清單與狀態(唯一權威清單)

| 模組 | 類型 | 狀態 | 主要來源檔 | 邊界一句話 |
|---|---|---|---|---|
| `collect` | 通用核心 | 已抽出 | `src/server.js`(handleEvent/storeAttachment) | **只收不判**:訊息/照片落庫,把頁 id 交棒給後續 |
| `triage` | 通用核心 | 待重導 ⚠️ | `src/server.js`(判斷/過濾層) | **通用初判管線**;領域分類吃 `construction.classify` |
| `queue` | 通用核心 | 已完成 | `src/queue.js`(確認佇列的通用部分) | 掛載既有目標/單據;**不含開單** |
| `meetings` | 通用核心 | ✅ 已完成(範本) | `src/meeting.js` | 會議錄音→轉寫→記錄 |
| `tasks` | 通用核心 | ✅ 已完成 | 散落(meetings 建、reminders 讀) | 待辦 CRUD 共用服務 |
| `reminders` | 通用核心 | 已抽出 | `src/server.js`(runAllReminderPasses 等)+ `/cron/reminders` | 通用排程骨架;工程到期規則吃 `construction.reminderPasses` |
| `construction` | 領域(僅工程租戶) | 進行中(8A 整合) | `queue.js` 單據 + `budget/contracts/trades/dashboard` + `server.js` 分類/到期 | 工程專屬**含 dashboard**;拆 8A/8B/8C,整合者 8A |

> **沒有獨立 `dashboard` 模組**(見決策 2)。若見任何 `modules/dashboard/` 資料夾或以 M7 名義開工的 session,一律重導併入 `construction`(8A)。

## 各模組邊界(拆解時對齊這裡)

- **collect**:讀 `ctx.binding`/`ctx.senderName`,寫訊息庫 + 附件(照片存 Drive),把訊息列 id 放 `ctx.messagePageId`,回 `false` 交棒。**不呼叫 LLM、不分類、不進佇列**。
- **triage**(collect 之後、queue 之前):過濾層1(系統轉貼)→ 取 judgement(有 `construction.classify` 才呼叫,吃空間/工項)→ 過濾層2(高信心閒聊自動歸檔)→ 其餘標 `AI初判待確認` 交 queue。**通用邏輯(兩層過濾、寫回訊息頁、決定進佇列/歸檔)恆在 triage;空間/工項詞彙一律來自 construction。** 無分類器的租戶只跑過濾層1。
- **queue**:待確認/已確認、照片縮圖、掛載到空間/工項、選專案掛載、批次確認、**掛到既有回饋單**。**開立回饋單委派 `platform.createFeedbackTicket`(construction)**。
- **tasks**:待辦 CRUD 共用服務(`platform.tasks.createTask/expandTasks/setStatus/listOpen/markReminded`),供 meetings、construction、reminders 共用。
- **reminders**:通用排程骨架(t30/每日/傍晚 pass + 待辦提醒 + `/cron/reminders`)。**工程專屬的回饋單到期/擱置規則由 `construction.reminderPasses` 提供**,reminders 只迭代呼叫,不自己實作。
- **construction**(僅工程租戶):回饋單/變更單狀態機、budget、contracts(回寫預算)、trades、**dashboard**、給 triage 的 `classify`、給 reminders 的 `reminderPasses`。整合者 8A 於 `index.js` 匯出 `routes/classify/reminderPasses`。

## ⚠️ 糾纏點(跨模組共用檔,認領前必看)

這些檔案被多個模組共用,兩個 session 會同時想改。**請照下方協作規則,避免互踩**。

1. **`src/server.js`** — 被 `collect`(落庫)、`triage`(判斷/過濾)、`reminders`(reminder passes)共用,`meetings` 已從這裡呼叫。
2. **`src/queue.js`** — **混了兩種功能**:通用「確認佇列」(→`queue`)＋工程專屬「回饋單/變更單」(→`construction` 8B)。
3. **AI 初判(judge)** — **已定案(決策 1)**:通用管線在 `triage`;空間/工項的領域分類器在 `construction.classify`(8C)。
   `collect` 純落庫、不參與判斷。triage 於 AI 段呼叫 `construction.classify` 取 judgement,不再自帶 `buildJudgePrompt/loadProjectContext`。
4. **待辦任務** — 已收斂到 `tasks` 模組:`meetings`/`queue`/`construction` 一律呼叫 `platform.tasks.*`,不各自寫。
5. **reminders 內含工程料** — **已定案(決策 3/4)**:`runDueReminders`/`wakeParkedTickets` 屬工程,搬入 `construction`(8C),
   以 `reminderPasses`(`{name, cadence:'daily', run(deps,{cfg,today})}`)交給 reminders 迭代。`reminders` 只保留通用排程骨架。

## 建議認領順序 / 協作規則

- **通用骨架先、領域後**:`collect`、`queue`、`tasks`、`reminders`(通用骨架)可平行;`construction` 依賴前四者介面。
- **一個檔一次一個 session 改**:要動 `server.js` 或 `queue.js` 的兩個 session,先在此檔簽名 + 講好切法。建議把要搬走的函式**整段圈出**再各自搬。
- **construction 內部**:8B/8C 只交領域檔 + register 掛鉤;**8A 擁有 `index.js` 並做最終整合**。8B/8C 不得各自改 `index.js`。
- **不動 BuildAM 部署**:一律 vendored 複製 + 薄 shim,`server.js` 對外介面不變(或改動極小且雙方講好)。
- **每個模組完成回報**:模組檔、BuildAM 綁定方式、`node --check`＋等同性測試結果(照 meetings 的回報格式)。

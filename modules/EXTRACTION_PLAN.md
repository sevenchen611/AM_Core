# 模組拆解計畫（給平行 session 認領）

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

## 模組清單與狀態

| 模組 | 類型 | 狀態 | 主要來源檔 | 認領 |
|---|---|---|---|---|
| `meetings` | 通用核心 | ✅ 已完成(範本) | `src/meeting.js` | — |
| `collect` | 通用核心 | 待做 | `src/server.js`(handleEvent/storeAttachment/routing/AI 初判) | |
| `queue` | 通用核心 | 待做 | `src/queue.js`(確認佇列的通用部分) | |
| `tasks` | 通用核心 | 待做 | 散落(meetings 建、reminders 讀)→ 收斂成共用 | |
| `reminders` | 通用核心 | 待做 | `src/server.js`(runAllReminderPasses 等)+ `/cron/reminders` | |
| `construction` | 領域(僅工程租戶) | 待做 | `queue.js`(回饋單/變更單)+`budget.js`+`contracts.js`+`trades.js`+`dashboard.js` | |

## ⚠️ 糾纏點(跨模組共用檔,認領前必看)

這些檔案被多個模組共用,兩個 session 會同時想改。**請照下方協作規則,避免互踩**。

1. **`src/server.js`** — 被 `collect`(handleEvent/attachment/routing/judge)與 `reminders`(reminder passes)共用,`meetings` 已從這裡呼叫。
2. **`src/queue.js`** — **混了兩種功能**:通用「確認佇列」(→`queue` 模組)＋工程專屬「回饋單/變更單」(→`construction` 模組)。
3. **AI 初判(judge)** — 在 server.js,但 prompt 讀「空間/工項清單」= **工程領域知識**。通用的「收訊息」屬 `collect`,但「怎麼分類」屬 `construction`。建議:`collect` 提供 hook,分類器由領域模組(construction)注入。
4. **待辦任務** — `meetings` 建立待辦、`reminders` 巡待辦、`queue`/回饋單也會開待辦。`tasks` 模組要把「建立/查詢/更新待辦」收成共用 helper,讓其他模組呼叫(而非各自寫)。
5. **reminders 內含工程料** — `runDueReminders`/`wakeParkedTickets` 是「回饋單到期/擱置復活」= 工程領域;`runTaskDailyPass` 等是通用待辦提醒。`reminders` 模組應只保留通用排程骨架,工程專屬的到期規則由 `construction` 提供。

## 建議認領順序 / 協作規則

- **先做通用骨架,再做領域**:`collect`、`queue`(通用部分)、`tasks`、`reminders`(通用骨架)可平行;`construction` 依賴前四者的介面,建議**稍後**或與 queue/reminders 的 session 密切協調。
- **一個檔一次一個 session 改**:要動 `server.js` 或 `queue.js` 的兩個 session,請先在此檔的「認領」欄簽名 + 講好切法,避免同檔衝突。建議先把該檔要搬走的函式**整段圈出**再各自搬。
- **不動 BuildAM 部署**:一律 vendored 複製 + 薄 shim,`server.js` 對外介面不變(或改動極小且雙方講好)。
- **每個模組完成回報**:模組檔、BuildAM 綁定方式、`node --check`＋等同性測試結果(照 meetings 的回報格式)。

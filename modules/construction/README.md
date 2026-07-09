# modules/construction — 工程領域（僅工程租戶啟用）

> 狀態:**完成(100%)**。單一擁有者,`index.js` 已整合全部子檔並驗證(見文末「驗證」)。其他 session 不碰此資料夾。
> 唯一源頭:`modules/EXTRACTION_PLAN.md`(決策 2/3/4)。範本見 `modules/meetings/`。

## 這個模組做什麼
工程租戶(BuildAM)專屬功能:**回饋單、變更單、工項/空間、工種、預算控制、發包合約、工程儀表板(dashboard 併入本模組)、
AI 初判的領域分類器 `classify`、回饋單到期/擱置提醒 pass**。非工程租戶(森在等)不啟用此模組。

> **dashboard 不是獨立模組**(決策 2):`src/dashboard.js` 整檔搬入本模組(8A),routes 掛在 construction、資料由 construction 內部提供;非工程租戶暫無儀表板。

## 來源(跨多檔——可再拆成多個子 session)
| 子功能 | 來源檔 / 函式 |
|---|---|
| 回饋單(feedback ticket) | `src/queue.js`:`createTicket` 536、`generateTicketNumber` 511、`listTickets` 672、`ticketAction` 745、`linkMessageToTicket` 379、`appendHistory` 737;端點 `/queue/api/create-ticket`、`/tickets`、`/ticket-action` |
| 變更單(change order) | `src/queue.js`:`createChangeOrder` 875、`listChangeOrders` 708;端點 `/queue/api/change-orders`、`/create-co` |
| 預算控制 | `src/budget.js`(整檔)+ `scripts/setup-budget-schema.js`、`add-budget-unit-quantity.js` |
| 發包合約 | `src/contracts.js`(整檔;含自動回寫預算) |
| 工種清單 | `src/trades.js`(整檔) |
| 工程儀表板 | `src/dashboard.js`(整檔:專案卡/甘特/SOP/照片/未銷項/空間×工種矩陣) |
| AI 初判領域知識 | `src/server.js` 的 `buildJudgePrompt`/`loadProjectContext`(空間/工項清單)——由 construction 提供分類器給 `collect` |
| 到期/擱置提醒 | `src/server.js` 的 `runDueReminders` 684、`wakeParkedTickets` 805——由 construction 提供 pass 給 `reminders` |
| schema 種子 | `scripts/setup-notion-schema.js`、`seed-projects.js`、`seed-spaces.js` 等 |

## 契約
```js
export default {
  name: 'construction',
  init(platform),
  routes: [ /* /budget/*, /contracts/*, /dashboard/*, 及 queue 的回饋單/變更單端點 */ ],
  classify?(ctx),         // 供 collect 注入的 AI 初判分類器(空間/工項)
  reminderPasses?: [],    // 供 reminders 呼叫的工程到期/擱置 pass
  async tick?(ctx),
};
```
`ctx.tenant` 需帶工程專屬 `dataSources { feedbackTickets, changeOrders, workItems, spaces, budgets, contracts, projects, tasks, meetings }`、`queueAccessKey`、`calendars`、`am-buildam-budget/contract` 授權旗標。

## 拆法(定案 · 決策 3/4)

construction 拆 **三個 session**,**整合者 = 8A**:

| 子任務 | 範圍 | 交付 |
|---|---|---|
| **8A**(整合者) | `budget` + `contracts`(回寫預算)+ `trades` + **`dashboard`**(整檔) | 領域檔 **＋擁有 `index.js`**:把三部分組成單一 construction,匯出 **`routes` / `classify` / `reminderPasses`**;做**最終整合驗證** |
| **8B** | 回饋單 + 變更單(切 `queue.js` 的單據部分) | 只交領域檔 + **一個 register 掛鉤**,不寫 index.js |
| **8C** | AI 初判領域分類器 `classify` + 到期/擱置提醒 pass(切 `server.js`) | 只交領域檔 + **一個 register 掛鉤**,不寫 index.js(已交付 `classify.js`/`reminders.js`,見 ③) |

> **只有 8A 動 `index.js`**。8B/8C 各交自己的 `*.js` + register 掛鉤,由 8A 串接。

## ⚠️ 糾纏點 / 切法建議
- **與 `queue` 共用 `queue.js`**(8B):先與 queue session 講好,把回饋單/變更單整段圈出移來;queue 只留「掛到既有單」,開單委派 `platform.createFeedbackTicket`。
- **與 `triage` 的 AI 初判**(8C):領域分類器 `classify` 在 construction;**triage 是通用管線**,呼叫 `construction.classify` 取 judgement。collect 純落庫、不參與。
- **與 `reminders`**(8C):到期/擱置規則以 **`reminderPasses`**(`{name, cadence:'daily', run(deps,{cfg,today})}`)交給 reminders 迭代呼叫;reminders 不自己實作。
- **與 `budget`/`contracts`**(8A):這兩支已是獨立檔,抽模組相對乾淨——**8A 的第一步**(先搬 budget + contracts + trades + dashboard 這些「整檔」的,再由整合者串接 8B/8C 的糾纏部分)。

## `index.js` 整合現況(已完成)
- **已 import 並匯出 `classify`(給 triage)與 `reminderPasses`(給 reminders,決策 4)**;`reminderSource(ctx)` 保留為內部低階資料把手(供 reminders 自組時用)。
- **routes**:`/dashboard`、`/budget`、`/contracts`、`/tickets/api/*`,皆經內聯的 `webRoute`(core.portal 授權 → 重算並注入 budget/contract/scope → 委派子 handler `(req,res,pathname,url,deps)`)。
- **授權殼內聯於 `index.js`**(不依賴外部共用檔):`resolveAuth` 走 `core.portal`,權限鍵 per-tenant(`am-<tenant>-budget/-contract/-<館別代碼>`);`fullDeps(tenant)` 逐呼叫組出隔離 deps。

## ③ 已完成:AI 初判分類器 + 工程到期/擱置 pass(切 server.js)

抽自 BuildAM `src/server.js`,重塑成 construction 領域檔(吃 `deps`,不寫 index.js — 由整合者組)。

| 檔 | 來源 | 對外匯出 | 由誰呼叫 |
|---|---|---|---|
| `classify.js` | `loadProjectContext`/`buildJudgePrompt`/`callAiJudge`/`extractJudgeJson`(judge 的「分類」段) | `classify(deps, {text, senderName, binding})` → judgement \| null | triage(collect 之後) |
| `reminders.js` | `runDueReminders`(684)/`wakeParkedTickets`(805) | `reminderPasses = [{name, cadence:'daily', run(deps,{cfg,today})}]` | reminders(每日班次) |

### 介面契約(給 triage / reminders 對接)

**分類器 `classify(deps, input)`(給 triage)**
- `deps`:`{ tenantKey, dataSources:{spaces, workItems}, notionRequest(已鎖租戶), ai:{provider, anthropicApiKey, minimaxApiKey, minimaxBaseUrl, judgeModel} }`。
- `input`:`{ text, senderName, binding:{role, trade, projectPageId} }`。
- 回傳 `judgement`(`{space, work_item, message_type, ticket_suggested, confidence, reason, model, judged_at}`),或 `null`(無空間/工項脈絡、AI 未配置、無專案、空白文字)。
- **邊界**:classify **只讀空間/工項 + 產 judgement,不寫訊息頁**。通用工作流(過濾層1 系統轉貼、過濾層2 高信心閒聊自動歸檔、寫回 `掛載狀態`/`確認者`/`確認時間`)仍歸 triage。
- **triage 對接**:triage 保留通用管線,把原內嵌的 `buildJudgePrompt`/`loadProjectContext`/`callAiJudge` 刪除,改於 AI 段呼叫 `construction.classify(...)` 取 judgement,再自行決定 `autoArchive`(=`message_type==='一般對話' && confidence==='高'`)並寫回訊息頁。整合者於 `construction/index.js` 以 `classify(ctx)` 包裝(deps 由 ctx.tenant + platform 組)。

**到期 pass `reminderPasses`(給 reminders)**
- pass 形狀:`{ name, cadence:'daily', run(deps, {cfg, today}) }`。
- `deps`:`{ tenantKey, dataSources:{feedbackTickets, groupBindings}, notionRequest(已鎖租戶), pushLineMessage }`;`cfg`:`{ escalationDays }`;`today`:`'YYYY-MM-DD'`。
- `run` 回傳 `{ ok, today, sent, woken }`(或 `{ skipped, reason }` 當該租戶無回饋單庫,如森在)。內部已串接 `wakeParkedTickets`(復活+週一盤點),故僅一個 daily pass。
- **reminders 對接**:reminders 保留通用骨架(tick/daily/evening + 待辦提醒),把原內嵌的 `runDueReminders`/`wakeParkedTickets` 刪除,於每日班次 `for (const p of construction.reminderPasses) if (p.cadence==='daily') await p.run(deps, {cfg, today})`,避免兩份實作漂移。

### 驗證
- `node --check modules/construction/classify.js`、`modules/construction/reminders.js`:通過。
- `node tools/dryrun-construction.mjs`:**12/12**(mock 網路,不打真 API):classify 產 judgement 且不寫訊息頁、正規化/守門、回饋單到期→推播+升級、擱置復活(重提日/觸發工項)、reminderPasses 契約、非工程租戶略過。

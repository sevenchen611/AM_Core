# modules/triage — AI 初判(通用管線)

把 BuildAM `src/server.js` 的「AI 初判」抽成平台**通用**模組。**功能與 BuildAM 現況等同**,只重組成模組形狀、改吃 `ctx.tenant`(不寫死任一租戶/專案)。

> 📌 **邊界(決策 1,以 `modules/EXTRACTION_PLAN.md` 為準)**:triage 是**所有租戶共用的通用初判管線**——
> 呼叫 LLM、算信心度、兩層過濾、決定進佇列/自動歸檔、寫回訊息頁。
> **空間/工項的「領域分類」不屬 triage**:由 `construction.classify(ctx)`(僅工程租戶)提供。
> triage 有 `construction.classify` 時呼叫之取得 judgement;沒有的租戶走通用流程/不分類(只跑過濾層1)。

## 做什麼

在 `collect` 落庫**之後**,對「文字訊息」判斷並決定進佇列或自動歸檔:

1. **過濾層 1(系統轉貼)**:回饋單/催辦/升級通知/會議記錄/擱置單的轉貼、或「測試」訊息——特徵明顯,不勞駕 AI,直接歸檔為「一般對話」。
2. **領域分類(委派 construction)**:有 `construction.classify` 的租戶,呼叫它載入該專案的空間/工項脈絡並判 `space / work_item / message_type / ticket_suggested / confidence / reason` → 回 judgement。無此分類器的租戶跳過此步。
3. **過濾層 2(高信心閒聊)**:judgement 高信心判為「一般對話」→ 自動歸檔,不進佇列(仍留可稽核紀錄,審核視圖可修正);其餘 → `掛載狀態=AI初判待確認`(交給 `queue`)。
4. **寫回訊息頁**:把 judgement / 信心度 / 掛載狀態寫回 collect 建立的訊息列(`ctx.messagePageId`)。

> **通用 vs 領域切線**:兩層過濾、寫回訊息頁、決定進佇列/歸檔 = **通用,恆在 triage**;
> 空間/工項的 prompt 與詞彙 = **領域,恆在 construction.classify**。triage 不自帶 `buildJudgePrompt`/`loadProjectContext`。

## 對外介面(模組契約)

```js
init(platform)          // 注入共用能力:notionRequest / AI 金鑰(aiProvider/aiJudgeModel/minimax*/anthropic*)/ logger
async onMessage(ctx)    // collect 之後:過濾層1 → construction.classify → 過濾層2、寫回訊息、決定進佇列/歸檔
                        //   已處理(系統轉貼歸檔 or 完成初判)→ 回傳 true 短路後續模組
                        //   不適用(未啟用/非文字/無專案/總管群/collect 未提供 messagePageId)→ 回傳 false
```

## 相依點

- **依賴 `collect`**:triage 不建立訊息頁,由 collect 建立後把頁 id 放在 **`ctx.messagePageId`**(同一則事件 core 傳同一個 ctx 物件給各模組)。無此欄位時 triage 回傳 false(無頁可寫回)。
- **依賴 `construction.classify`(領域分類器)**:透過平台共用把手取得(如 `platform.classify` / `ctx.tenant` 有 construction 時);回傳 judgement `{space, work_item, message_type, ticket_suggested, confidence, reason, model, judged_at}` 或 `null`。**triage 只讀 judgement、不讀空間/工項庫**。
- **依賴 core**:`ctx.tenant`(`key`)、`ctx.binding`(`role/trade/projectPageId`)、`ctx.isMaster`、`ctx.senderName`、`ctx.text`;`platform.notionRequest`(per-tenant 隔離守衛)。
- **餵給 `queue`**:把過關訊息標成 `掛載狀態=AI初判待確認`,queue 讀此狀態呈現待確認佇列。
- **模組順序**:須排在 `collect` 與 `meetings` **之後**(讓會議「與會資訊答覆」先被 meetings 收斂、不被誤判)、`queue` 之前。

## 啟用條件(per 租戶可選)

- 領域分類只在該租戶啟用 `construction`(有空間/工項脈絡)時運作;否則 triage 只跑過濾層1、不呼叫分類器。
- AI 金鑰由 **platform 注入**(construction.classify 內部使用):`aiProvider=minimax` 需 `minimaxApiKey`+`aiJudgeModel`;`aiProvider=anthropic` 需 `anthropicApiKey`+`aiJudgeModel`。未配置時只跑過濾層 1。

## 狀態隔離

- triage 本身**不快取空間/工項**(那是 construction.classify 的責任,以 `(租戶, 專案)` 為鍵)。
- triage 若保留任何狀態,一律以 `(租戶, …)` 為鍵,不同租戶不互相污染。

## ⚠️ 目前實作分歧(待重導)

**現況**:`modules/triage/index.js` **仍內嵌**舊版分類器(`buildJudgePrompt`/`loadProjectContext`/`callAiJudge`/`judgeMessage`,直接讀空間/工項庫)——這是照**舊分歧計畫**寫的,與決策 1 不符。
**重導方向**:刪除內嵌分類器,改於 AI 段呼叫 **`construction.classify(...)`**(該檔已由 8C 交付於 `modules/construction/classify.js`),triage 只保留過濾層1/層2 + 寫回訊息頁。整合細節見 `modules/construction/README.md` 的「③ classify 對接」。

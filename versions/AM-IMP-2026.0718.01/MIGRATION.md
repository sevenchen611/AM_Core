# Migration Strategy — From Notion-first AM to Operational Memory

這個版本不要求一次搬完所有歷史對話，也不以大量回填作為上線前提。每個 AM 應獨立採用「先接新資料、再收斂進行中案件、最後按需回填」的方式。

## 1. 建立基線

先盤點該 AM 自己的：

- LINE group / room / user 路由與 project binding
- 現有專案、未完成任務、有效決策、會議與 daily reports
- Notion relation、狀態欄位、owner、due date 與來源證據格式
- 群組／專案／角色／敏感等級權限
- 附件所在位置與可追溯 locator

盤點輸出只能放在該專案的 secured workspace，不可提交 AMCore。

## 2. 從新訊息開始 shadow ingest

先讓新 LINE 訊息、meeting checkbox、報告線索與人工修正同時進入 operational memory。既有流程繼續運作；shadow pipeline 只建立 candidate event、比對 task、產生 project snapshot 與差異報告。

建議先觀察 7–14 天，以涵蓋一般工作週期與多種事件。

## 3. 建立 active-state seed

不要把舊 Notion task 直接複製成無來源的 confirmed state。對仍進行中的專案／任務／決策：

1. 找到原始 LINE、會議、報告或附件 evidence。
2. 建立 `legacy_import` judgment trace 與 source links。
3. 先寫入 candidate event。
4. 通過 evidence、tenant、goal 與 owner review 後再投影 current state。
5. 找不到 evidence 的項目保持 candidate/pending confirmation。

## 4. 歷史資料回填順序

優先順序：

1. 目前進行中的專案與未完成任務。
2. 最近 90 天仍有效的承諾與決策。
3. 會影響現況的 blockers、risks 與 meeting checkbox。
4. 經常被詢問的正式知識與其核准來源。
5. 其他歷史 raw conversations 僅按稽核或查詢需求回填。

原始資料可以保留，但不需要在切換前把所有三個月訊息重新送進模型。

## 5. 差異審查

shadow report 至少列出：

- legacy task 與 canonical task 的一對一／一對多／無匹配
- 被判斷為 update 卻在 legacy 建成新 task 的案例
- source evidence 缺漏
- project/goal assignment 差異
- status、owner、due date、waiting-for 與 completion 差異
- decision supersession 差異
- cross-tenant、cross-group 或敏感資料拒絕紀錄

平台 owner 核准規則與 mapping 後才能進入 structured query shadow。

## 6. 查詢切換

先只切換三種 intent：

- project_progress
- task_or_commitment_status
- decision_history

每類 intent 都先平行產生 legacy 與 structured answer；人工抽樣確認來源、有效狀態與權限。只有這三類穩定後才擴大到知識、檔案或跨專案查詢。

## 7. Notion 角色轉換

切換後，Notion 頁面是 PostgreSQL state 的可重建 projection。人員在 Notion 的 owner、status、due date、decision approval 或 knowledge approval 修改，先轉成 manual event，再由核心更新 current state；不允許雙邊 last-write-wins。

## 8. 每個 AM 的獨立完成條件

一個 AM 完成遷移，不代表其他 AM 已完成。HOZO_AM、SEVEN_AM 與 AM Platform 其他 tenant 都必須各自：

- 建 tenant 與 database policy
- 連接自己的 sources/adapters
- 建立自己的 active-state seed
- 通過自己的 isolation、evidence、reconciliation 與 answer tests
- 更新自己的 manifest 與 upgrade record
- 驗證自己的 production service 後再標記 `Deployed`

# 安裝

1. 確認正式服務及原有案件／現場空間／工項／預算／合約來源。使用者已選定提交後直接更新施工進度。
2. 在 AM Platform 目前正式服務的工程租戶 checkout 整合 `modules/construction/journal*.js`。於工程 index 新增 `handleJournalRequest` import 與 `/journal` route，權限沿用 `construction.read`、`webRoute`；工程 dashboard 加導覽連結、矩陣工項入口與 buildDoc 下方的 constructionHistory 紀錄區。保留正式分支其他既有變更。無須修改 HOZO／Seven 或舊 BuildAM。
3. 帶入 `tools/provision-construction-journal.mjs` 及 schema。使用部署環境既有租戶資料來源，所有來源須位於該租戶母頁下。

```powershell
node --env-file=<deployment-env-file> tools/provision-construction-journal.mjs engineering
node --env-file=<deployment-env-file> tools/provision-construction-journal.mjs engineering --apply --state <absolute-project-local-state-outside-AMCore>
```

第一個命令只列計畫，不讀寫正式內容。第二個建立三個租戶內資料庫及雙向關聯，不建立案件或搬動原有工程；識別碼儲存於指定的專案本地狀態檔，禁止放 AMCore。每次建立前先記 pending，未知結果必須人工找回 ID，再清 pending 接續；不盲目重建。重跑會驗證既有欄位型別、關聯方向及目標，不覆蓋既有資料。

4. 從狀態檔的 bindings 將以下環境變數設到該部署環境：

```text
<PREFIX>_CONSTRUCTION_JOURNALS_DATA_SOURCE_ID
<PREFIX>_CONSTRUCTION_PROGRESS_DATA_SOURCE_ID
<PREFIX>_CONSTRUCTION_PHOTOS_DATA_SOURCE_ID
```

現有租戶載入器會自動轉成 `constructionJournals`、`constructionProgress`、`constructionPhotos`，與原有 `projects`、`spaces`、`workItems`、`budgets`、`contracts`、`attachments` 分庫。所有索引／上傳／讀寫都限原租戶與原案件；預算及合約關聯需各自權限。

5. 確保單一程序寫入；若多實例先完成共享鎖再開啟。重啟工程服務並依 VERIFY 做登入、scope、實際照片與資料落庫驗證。正式上線前確認 API Gateway／Portal 未把 `/journal` route 排除。
6. 在工程部署自己的 improvement manifest 與 upgrades 紀錄登錄 Installed；正式 Render 服務驗證後才改為 Deployed。AMCore 共用套件保持 Ready。工程租戶已於 2026-10-05 完成正式建庫、綁定及部署驗證，結果見 VERIFY 與租戶 upgrade record。

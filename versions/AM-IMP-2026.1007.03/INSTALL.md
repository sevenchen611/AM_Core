# 安裝

只對明確選定的 OA／正式服務安裝。SevenAM 與其他獨立 OA 要另外執行自己的安裝與授權，不複製這個部署的資料或憑證。

1. 準備 Notion 母頁的既有 integration 連線，以及 Google Drive 指定資料夾的 `drive.file` Picker 授權。
2. 設定 `AMCORE_CENTRAL_ARCHIVE_ENABLED=1`、`AMCORE_CENTRAL_ARCHIVE_NOTION_PARENT_PAGE_ID`、`AMCORE_CENTRAL_ARCHIVE_DRIVE_ROOT_FOLDER_ID`、`AMCORE_CENTRAL_ARCHIVE_BOT_USER_ID`。啟動會比對真實 BotInfo，母頁與資料夾必須可用。
   可設定 `AMCORE_CENTRAL_ARCHIVE_GOOGLE_ACCOUNT_EMAIL` 比對實際 Google OAuth 帳戶，防止誤用其他 Chrome 帳戶的連線。
3. 預設重用該部署的 LINE I/O PostgreSQL 連線；可用 `AMCORE_CENTRAL_ARCHIVE_DATABASE_URL` 指定獨立連線。外部連線維持 TLS 憑證驗證。遷移時提供短期、專案本地的 `ARCHIVE_MIGRATION_OWNER_DATABASE_URL`，執行 `node tools/central-archive-admin.mjs --migrate`。它只新增自己的 schema，並授權既有執行角色使用該 schema 的表。
4. 執行測試、建立審查過的主分支 commit；從真實正式服務部署來源部署。不要從髒工作區或個人 feature branch 直接部署。
5. 執行 `--seed-history` 與 `--provision`。第一次 seed 可以在啟用前完成；重跑可補入切換期間的新資料。
6. 啟用後由持久 worker 自動恢復與補入；新即時事件優先於歷史佇列。也可從目標專案執行 `--drain`。完成後執行 `--status` 與實際 Notion／Drive 讀回驗證。

Notion 的查詢與寫入有速率限制，大量歷史補入需要時間。不得將仍在 pending 的歷史資料宣稱為已全部完成。

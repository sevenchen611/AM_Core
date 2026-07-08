# Install

以 BuildAM repo(github.com/sevenchen611/BuildAM)為權威原始碼。部署新的工程型 AM 專案時:

1. Clone BuildAM repo 作為種子;全域替換 `BUILD_` 前綴與「葉小蝸」稱謂為新專案值。
2. 建立新專案自己的 LINE OA(Messaging API channel)、Notion integration 與母頁面、
   MiniMax/Gemini/Google OAuth 憑證——不得沿用其他專案的 token。
3. 依 `.env` 範本填入憑證後,依序執行:
   `setup-notion-schema.js`(建 10 資料庫並回填 .env)→ 匯入專案/空間/工項種子 →
   `google-drive-auth.js` + `setup-drive-folder.js`(Drive/Calendar 授權與資料夾)。
4. 部署 Render Web Service(參考 render.yaml),env 逐項同步;
   LINE console 綁 webhook `https://<service>/webhook/line` 並 Verify。
5. 設定 GitHub Actions `daily-reminders.yml`(secrets.QUEUE_ACCESS_KEY),每 15 分巡邏。
6. 建立群組綁定(群組→專案/角色/工種/主管),AM Portal 加對應授權鍵。
7. 更新專案 manifest 與 upgrade record。

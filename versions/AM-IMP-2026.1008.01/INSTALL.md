# 安裝與部署

1. 以正式 AM Platform 最新 main 建立乾淨 checkout，先確認既有 `core/attachment-retrieval.js` 與 `AM-IMP-2026.1004.07`；保留現有中央封存及各租戶資料來源。
2. 安裝 `core/attachment-delivery.js`、retrieval 和 server 的本版差異，及 `sharp ^0.35.5` 相依與更新 lockfile。不要將舊 collect 整檔覆蓋正式版本。
3. 使用目標自己的既有 HTTPS `AMCORE_PUBLIC_BASE_URL`／租戶網址，以及 `AMCORE_QUEUE_ACCESS_KEY`／租戶 signing key，Google Drive OAuth、租戶根目錄和資料源。公開 `GET /line-attachment`，handler 要求用途、租戶、來源、原檔指紋與有效期限簽章。代理及自訂存取 log 不得保留 token。
4. 不需更改資料庫、不更改 LINE webhook、不公開 Drive、不部署到舊獨立 HOZO_AM 或 SevenAM。它們若仍在使用需另行 adapter，不能宣稱本服務部署等於舊服務已更新。
5. 執行 VERIFY；在各平台租戶自己的 manifest／upgrades 記錄本地 `Installed`。PR 經差異檢查與 CI 通過後合併 main，再等待 Render 自動部署。不得從 feature branch、dirty checkout 或本工作區舊分支部署。
6. 檢查正式 `/health` commit、`attachmentRetrieval.delivery`、`configuredTenants` 和取檔端點，才將實際平台租戶改為 `Deployed`。使用者實際 LINE 回覆與照片顯示另列驗收，不能以健康資訊冒充已向 LINE 使用者傳送成功。

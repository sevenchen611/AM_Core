# 驗證

```powershell
node --test tools/test-attachment-delivery.mjs tools/test-attachment-retrieval.mjs
node --test tools/test-attachment-retention.mjs tools/test-central-archive.mjs
node --experimental-vm-modules tools/verify-attachment-webhook.mjs
node tools/dryrun-collect-attachment-archive.mjs
node tools/dryrun-core.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1008.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

合成測試涵蓋 21 項既有來源查找／隔離、7 項圖片及下載 delivery、42 項留存／中央封存：原圖位元一致、JPEG 預覽限制、一般文件／HEIC／大圖、兩小時有效期、竄改簽章、共用 signing key 仍不可換租戶、撤除綁定、來源遺失、原檔指紋改變、私人來源、顯示不了圖片時保留原檔下載。

既有真 server webhook harness 確認取檔命令早於任務及傳輸服務。既有未設定 signing 的服務仍回 verified Drive 連結。

正式部署需 health commit 對應 reviewed main，delivery=`line-quoted-image-signed-download-v1`、TTL=7200、啟用租戶均出現在 `configuredTenants`。缺少或無效 token 回 403，不能洩漏檔案。

在自己的對話，用原始照片、PDF 和過期但已有備份的來源實際回覆驗證。非 JPEG／PNG 或 >10 MB 只提供原檔。確認下載位元與備份一致、一般取檔沒有新待辦；沒有原始引用且沒有完整檔名時提示補來源。未獲明確授權時不向正式群組發送測試訊息。

各租戶部署紀錄保存非機密 commit、PR、health／HTTP 結果和未完成的使用者端驗收，不保存客戶內容、群組 ID、附件 ID、下載 token 或 OAuth。

本地檢查：31 項 retrieval/delivery、42 項留存/中央封存、真 server webhook 與無效下載拒絕、collect 留存及 core 19 項通過。現行正式 checkout 的整體 alignment 稽核仍有既有獨立專案 manifest 缺漏，不能宣稱所有舊專案已對齊；本版 package 完整性與語法檢查通過。

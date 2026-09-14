# Verify

## Local

```text
node --check modules/construction/drawings.js
node --check modules/construction/dashboard.js
node --check modules/construction/index.js
node --check tools/provision-design-drawings.mjs
node tools/dryrun-construction-drawings.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0914.06
node tools/audit-alignment.js
```

Dry run 必須證明 Drive 資料夾層級、檔名清理、串流上傳、Notion 版本索引、最新版排序、未設定資料庫的安全降級，以及 500 MB 限制。

## Project-local acceptance

1. 開啟一個權限範圍內的工程專案，確認階段①顯示「設計圖版本庫（Google Drive）」。
2. 上傳一個小型 PDF/DWG，版本填 `V1`，狀態填 `草稿`。
3. 在 Google Drive 確認檔案實際位於「設計圖／專案／圖面名稱」資料夾。
4. 在 Notion「設計圖版本」確認只有索引欄位，Drive 連結可開啟原檔。
5. 對相同圖面名稱上傳 `V2`，確認畫面顯示兩個版本且 `V2` 為最新；`V1` 仍可開啟。
6. 使用無該專案 scope 的帳號，確認清單與上傳均被拒絕。
7. 確認另一租戶的 Notion 與 Drive 根目錄沒有新增任何資料。

完成專案本機驗證後可標記 `Installed`；只有在該專案自己的正式 Render 服務完成以上驗收後才能標記 `Deployed`。

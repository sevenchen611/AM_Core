# 驗證

- `node --test tools/test-construction-journal.mjs`：21/21 通過；新增逐筆 6 與 3 人合計 9 人次、工程名稱獨立保存、兩空間關聯及各空間歷史、跨案件／租戶拒絕、未知與 0、缺名稱與非法人數拒絕、多空間中斷重送不重複、舊工班日誌相容及施工日期排序。
- `node tools/dryrun-construction-dashboard-management.mjs`：14/14。
- `node tools/dryrun-construction.mjs`：12/12。
- `node tools/dryrun-engineering-convergence.mjs`：18/18。
- 本套件 checker 通過；git diff --check 通過。工作區與 AGENTS 指定舊 checkout 的 alignment audit 均 exit 1，仍為既有 HOZO／Seven manifest／路徑缺列；版本比較已執行。本版不宣稱全域 alignment complete。
- 合成瀏覽器已實際選工項自動带入工程名稱，修改工作名稱，展開 checkbox 選兩個空間，新增第二工作，提交 6／3 人。結果直接已更新、合計 9 人次、第一工項 35% 並顯示兩個區域；舊工班紀錄仍保留。

正式發布後：檢查 health commit 與三日誌資料來源、登入表單欄位順序與多選位置、未登入 API 拒絕。於部署環境執行 `tools/verify-construction-journal-live.mjs engineering --prepare <absolute-state-outside-repo>`，只建立標示合成的案件／兩空間／兩工項及一張合成 Drive 照片。表單提交第一筆 6 人、35%、兩區域、一照片；第二筆 3 人、50%、第二區域。執行 --verify 確認合計 9 人次、工程名稱、雙空間反向關聯與原工項歷史，接著 --cleanup 封存合成 Notion 頁面並將專用 Drive 案件資料夾放可復原垃圾桶。所有正式 ID、状态與截圖留在 AMCore 外。

## 正式結果，2026-10-05

- PR #238 合併版本 `af88c41d35f433382ddf2df9a2f525b692beb3af`，Render `dep-db1im0uq1p3s73fbq700` Live；health 版本相符、三日誌來源齊全、isolation enabled。未登入 API HTTP 401。
- 正式瀏覽器依新版表單提交兩個合成工程名稱、各 6／3 人與兩個／一個區域。日誌直接已更新，顯示合計 9 人次；第一筆保留原有 Drive 照片。原工項下方實際顯示工程名稱、6 人及兩個區域名稱。
- live verifier 回傳 `verified: true`、`headcount: 9`、`unit: 人次`、`multiAreaLinked: true`、`engineeringNameSaved: true`、`nativeReverseRelation: true`。第二區域可反查兩筆工作，其原生關聯包含第一筆跨區域紀錄。
- cleanup 回傳 `cleaned: true`、`syntheticNotionPagesArchived: true`、`syntheticDriveFolderTrashed: true`，均可復原；未改動真實工程紀錄。未更改 Notion schema、環境綁定或服務實例數。

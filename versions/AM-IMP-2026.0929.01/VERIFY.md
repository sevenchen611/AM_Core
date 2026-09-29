# 驗證

使用假 token、假群組與假訊息，本地測試不呼叫 LINE 或 Notion 正式 API。

```powershell
node --check server.js
node --check core/line-io/index.js
node --check core/line-io/store.js
node --test tools/test-line-io.mjs
node tools/dryrun-core.mjs
node tools/verify-line-push-timeout.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0929.01
node tools/audit-alignment.js
```

SQL 測試在記憶體 PostgreSQL（PGlite）執行正式 schema 與 adapter，測試 runtime 放作業系統暫存區，不改套件正式 dependencies：

```powershell
$testRuntime = Join-Path $env:TEMP 'am-line-io-test-runtime'
npm install --prefix $testRuntime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
node tools/test-line-io-sql.mjs "$testRuntime\node_modules\@electric-sql\pglite\dist\index.js"
```

涵蓋：驗簽、讀写 scopes、跨群／跨租戶拒絕、綁定撤銷、影子群不推播、來源內容、postback、事件去重、cursor 分頁、失敗不 ACK、先 commit 再 ACK、發送衝突、併發保留、逾時重用 UUID、SQL 原子回退、重啟、23 小時重試期限與 unsend 先後順序。

PGlite 不等於正式 PostgreSQL 多連線環境。部署驗證需在專案測試資料庫額外確認：兩個同時進入的 webhook transaction 按 advisory lock 順序提交；多個服務實例對相同發送 key 只有一個取得 lease。正式端到端還需：OA 的 webhook Verify 200、已授權測試群收進訊息與 postback、未授權 key 拒絕、指定測試報告出群、重試不重發。完成前不可標成 Deployed。

工作指南的舊位置檢查命令也可在該 checkout 執行：`node D:\Codex_project\AMCore\tools\audit-alignment.js`。此工作目錄是 `D:\CodexWork\AM_Core`；不同 checkout 的稽核不能互相取代。既有專案路徑或套件缺失需分開記錄，不修改其他未相關套件以製造通過。

## 2026-09-29 本地與部署準備驗證

- HTTP 行為測試：9/9 通過，涵蓋人員限制、固定通知身分與 transport-only 設定。
- SQL schema／adapter：PGlite 真實 SQL 測試通過。
- 既有核心 dry run：19/19 通過；LINE push timeout/retry 驗證通過。
- 既有銀行報價回覆完整資料保存與 real webhook ACK ordering regression 通過。
- 正式資料庫：独立 line_io schema、restricted runtime role、forced RLS 已驗證，跨租戶寫入遭拒絕。
- 套件完整性檢查通過。全域 alignment 在此乾淨 checkout 存在既有 legacy project 路徑／manifest 缺失，不宣稱跨專案對齊完成。
- 正式服務啟用與 canary 結果記於實際 tenant 的 upgrade record。

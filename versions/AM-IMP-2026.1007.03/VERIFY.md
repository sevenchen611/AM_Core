# 驗證

執行：

```text
node --test tools/test-central-archive.mjs
node --experimental-vm-modules tools/verify-private-assistant-pause.mjs
node tools/test-attachment-retention.mjs
node tools/test-attachment-retrieval.mjs
node --test tools/test-work-journal-entry.mjs
node tools/dryrun-claims-authority-runtime.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1007.03
node tools/audit-alignment.js
```

SQL 測試使用一次性 PostgreSQL 引擎，覆蓋交易回滾、事件去重、來源分隔與 Bot 分隔。伺服器測試驗證無簽章事件不落庫、私人助理暫停仍保留、歸檔失敗回 503 不丟來源。媒體測試使用任意安裝檔內容。

正式驗證必須包含正確 commit、centralArchive enabled/ready、實際中央母頁的資料庫父層、群組／私人對話分開、實際長文字讀回、指定 Drive 父層與原檔 checksum，以及歷史 pending／失效附件／待確認來源清單。使用者未授權發送 LINE 測試訊息時，採用已收到的正式事件與獨立人工驗證記錄，不能冒充使用者發訊息。
# Bulk archive verification

The worker holds the existing bot-scoped PostgreSQL advisory lock and processes at most four independent jobs per batch. New conversation targets are serialized per conversation; provisioned targets share the archive's Notion rate limiter. Verify distinct job keys, bot isolation, and single target creation with `tools/test-central-archive.mjs`. Historical jobs remain resumable and lower priority than live messages.

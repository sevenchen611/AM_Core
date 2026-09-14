# Verify

AMCore / AM Platform:

```text
node tools/dryrun-claims-authority-admin.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0914.05
node tools/audit-alignment.js
```

Rental Management:

```text
node --check _worker.js
node scripts/finance-claims-v3-foundation.test.mjs
node scripts/finance-claims-v3-admin-api.test.mjs
node scripts/check-admin-usage-counter.mjs
```

正式環境：

1. 表單管理顯示四張表單的目前版本與版本歷史。
2. 第二張表單為零適用群組，且只出現在「已停用表單與歷史」。
3. LINE 請款選擇器不再顯示第二張表單。
4. 新建測試請款保存 `form_id`、`form_version_no=1` 與非空 `form_snapshot_json`。
5. 舊請款顯示 v1 且標記為歷史推定，不改寫原始資料。

# AM-IMP-2026.0914.01 — Claims group/form routing

Status: `Installed`

HOZO 的請款功能管理現在可將四張請款單分別正式發布給指定 LINE 群組。
發布狀態與表單關聯存於 tenant-scoped PostgreSQL，所有變更寫入 claims audit。

Canary 規則：沒有 `group_form_configs` 的群組維持既有 V3 直達；一旦由後台正式發布，該群改走短效、限本人使用的選擇頁。空集合也是正式狀態，不會意外回退。

Production deployment and one-group live verification are still required before changing this record to `Deployed`.

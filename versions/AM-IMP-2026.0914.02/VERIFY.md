# Verify

1. 執行 `npm run dryrun:claims-authority`。
2. 執行 `node tools/dryrun-claims-governance.mjs`。
3. 執行 `node tools/dryrun-finance-v3-direct.mjs`。
4. 執行 `node tools/dryrun-finance-v3-postgres-hotpath.mjs`。
5. 執行 `node tools/check-upgrade-package.js AM-IMP-2026.0914.02`。
6. 確認 selector 優先使用事件 reply token；備援 push 的 target 必須等於事件來源群組，不能是其他群組。直接 V3 queue 入口缺少來源群組專屬 recipient 時必須 fail closed。
7. 確認 selector Cookie 具備 `HttpOnly`、`Secure`、`SameSite=Lax` 與 `/claims/liff` path，且一般請求不會從 Cookie 恢復 token。
8. 正式環境在 canary 群組重新輸入「請款」，確認訊息只出現在同一群組。
9. 從外部瀏覽器完成 LINE 登入，確認回到請款單選擇頁而非顯示連結失效 JSON。
10. 選擇一張舊版與 V3 表單，確認身分、群組與表單授權仍在伺服器端重新驗證。

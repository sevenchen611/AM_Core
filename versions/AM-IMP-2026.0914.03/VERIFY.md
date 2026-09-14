# Verify

執行：

```text
npm run dryrun:claims-authority
node tools/dryrun-claims.mjs
node tools/dryrun-claims-governance.mjs
node tools/dryrun-finance-v3-direct.mjs
node tools/dryrun-finance-v3-postgres-hotpath.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0914.03
```

正式環境驗證：

1. Render deploy 為 `Live` 且 checkout 本版本的 merged main commit。
2. custom domain 與 onrender domain `/health` 均回 HTTP 200。
3. HOZO 財務群組重新輸入「請款」後，四張表單仍只出現在原群組。
4. 第 1 張可進入勞健保表單，不顯示 Notion 404。
5. 全新連結選第 4 張可進入 V3；舊版入口建立失敗時不得鎖住尚未完成的選擇。

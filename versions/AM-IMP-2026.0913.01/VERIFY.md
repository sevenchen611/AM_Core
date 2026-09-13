# Verify

Run:

```text
node --check core/claims-authority-admin.js
node tools/dryrun-claims-authority-admin.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0913.01
```

Confirm manually:

1. An authorized user can see 「請款功能工具」 and 「請款單管理」.
2. The page heading and browser title are both 「請款功能管理」.
3. 「返回財務後台」 points to the configured Rental origin's `/admin-finance.html`.
4. Opening the catalog hides the group table and shows exactly four entries.
5. The first three entries are the legacy LIFF modes: 勞健保、共同營業、其他費用.
6. The last entry is 「V3 標準版請款單」.
7. 「返回群組授權」 restores the existing group administration view.
8. Opening or closing the catalog sends no mutation request.

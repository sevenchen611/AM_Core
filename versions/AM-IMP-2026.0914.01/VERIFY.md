# Verify

1. 執行 `npm run dryrun:claims-authority`。
2. 執行 `npm run dryrun:finance-v3-direct`。
3. 執行 `node tools/check-upgrade-package.js AM-IMP-2026.0914.01`。
4. 在正式後台確認四張卡片都有「設定適用群組」與適用數量。
5. 只將一個 canary 群組發布給至少兩張請款單。
6. 在該群輸入「請款」，確認先看到請款單選擇頁，且只有發布的表單。
7. 分別打開舊版與 V3，確認舊版類型被鎖定、V3 仍通過正式 bridge。
8. 在未設定群組輸入「請款」，確認仍維持原本 V3 行為。
9. 確認另一位 LINE 使用者無法使用原申請人的短效連結。


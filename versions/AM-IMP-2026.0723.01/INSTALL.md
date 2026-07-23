# 安裝

1. 在 AM Platform 執行 `node --env-file=.env scripts/provision-meeting-terms.mjs <tenant-key>`，於該租戶自己的 Notion 母頁建立「AM 會議名詞庫」。
2. 將輸出的 `<PREFIX>_MEETING_TERMS_DATA_SOURCE_ID` 只設定到 AM Platform 的 Render Secret，然後重新部署。
3. 管理頁需同時呈現「已啟用」與「待確認」兩個狀態。
4. 將已啟用詞合併到該租戶 `meetings.keyterms`，不可跨租戶共用。

# Rollback

1. 回復 `modules/construction/dashboard.js` 與 `modules/construction/index.js` 的本套件變更，移除 `modules/construction/drawings.js`。
2. 重新部署上一版 AM Platform。
3. 從部署環境移除 `<PREFIX>_DESIGN_DRAWINGS_DATA_SOURCE_ID`。

回滾只停用上傳與版本庫畫面。不要刪除 Google Drive 的「設計圖」資料夾、任何歷史版本檔案，或租戶 Notion「設計圖版本」資料庫；它們是設計沿革與稽核證據，應保留供人工存取或日後恢復功能。

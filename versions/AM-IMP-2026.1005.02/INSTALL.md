# 安裝

1. 在目前正式 GitHub main 建立隔離分支，整合本版 journal-page、journal、dashboard 及驗證工具。保留正式環境的契約與設計圖功能及使用者未提交變更。
2. 原有 AM-IMP-2026.1005.01 三個日誌資料來源與 Drive 綁定必須已啟用；本版不改 schema、不建庫、不複製資料或環境值。
3. 執行 VERIFY 的測試、套件檢查、alignment audit 與版本比較。新版 format 是明確分流，舊日誌／舊提交仍支援原工班格式。
4. 合併經 review 的 commit 到 GitHub main，由既有 AM Platform Render Auto-Deploy 發布。保持單一寫入實例。
5. 驗證正式入口與可復原清理的合成回報；使用者有未送出欄位時保留內容再更新表單，不把草稿送出或儲存在 AMCore。正式服務確認後才將工程租戶紀錄改為 Deployed。

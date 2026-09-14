# AM-IMP-2026.0914.03 — 請款單即時群組綁定與失敗選擇復原

Status: `Deployed` (AM Platform `95afdae`; Render `dep-dajrt5mk1f9s7383uehg`; verified 2026-09-14)

修正請款單選擇器沿用舊 Notion 群組頁面 ID，造成舊版 LIFF 顯示
`object_not_found`，且錯誤入口仍鎖定選擇器、無法改選 V3 的問題。

- 請款指令進入 authority 前，依事件的原始 LINE 群組 ID 重新取得唯一且啟用的群組綁定。
- 建立舊版 LIFF 入口前再次驗證即時群組綁定；驗證成功後才鎖定選擇。
- 舊版 LIFF 保留來源群組 ID，受保護操作重新解析目前 canonical binding page。
- Notion 原始錯誤不再顯示給使用者，改為可執行的中文復原訊息。

不變更四張表單內容、群組發布設定或歷史請款資料。

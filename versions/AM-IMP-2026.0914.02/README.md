# AM-IMP-2026.0914.02 — 請款來源群組隔離與 LIFF 登入恢復

Status: `Installed` (production deployment pending)

修正請款單選擇功能的兩個正式環境問題：

- 已發布請款單選擇功能的群組，直接使用這次事件的 LINE reply token 回覆原群組；若 reply token 無法使用，備援推送也只允許事件本身的群組 ID。
- 已存在的錯誤 group binding 會在該群組下一次發出請款指令時，以即時路由辨識到的 binding 自動校正。
- 未發布選擇功能、仍使用 V3 群組投遞的入口，必須找到實際來源群組專屬的不透明投遞參照，否則 fail closed。
- 請款單選擇憑證以短效、HttpOnly、Secure、SameSite=Lax Cookie 跨越 LINE OAuth 跳轉；只有同時具有 OAuth `code` 與 `state` 的回跳請求可從 Cookie 恢復。

本修正不改寫請款資料、表單內容或歷史請款紀錄。

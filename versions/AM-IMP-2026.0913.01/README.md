# AM-IMP-2026.0913.01 — HOZO 請款單管理目錄

Status: `Installed` (local branch; not deployed)

在受保護的 `/claims-authority` 後台新增「請款功能工具」與
「請款單管理」入口，依 legacy LIFF 至 Finance Claims V3 的順序列出：

1. 勞健保費用請款單（legacy `social_insurance` adapter）。
2. 共同營業費用請款單（legacy `shared_operating` adapter）。
3. 其他費用請款單（legacy `other` adapter）。
4. V3 標準版請款單（`employee_expense`）。

這一版只有唯讀目錄，不新增表單編輯、啟停、來源綁定或正式財務寫入。
三種舊版項目代表同一張 LINE LIFF 頁面的固定模式，不宣稱它們是三套
彼此獨立的財務工作流。頁面與瀏覽器標題統一為「請款功能管理」，並以
tenant 的可信任 Rental base URL 提供「返回財務後台」連結。既有群組與
成員授權功能保持不變。

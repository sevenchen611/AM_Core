# AM-IMP-2026.0914.07 — Claims named personal templates

Status: `Installed`

每位通過 LINE 身分驗證的送件人，可在四種請款單各保存最多 20 份具名私人範本。
舊版由 AM Platform 維持原群組、本人與表單選擇驗證，再以匿名 identity reference
存取 Rental/Finance；V3 則由專用 Web session 直接限制 tenant、identity 與表單。

範本會保存常用明細、金額、備註或 V3 付款選擇；不保存請款月份、費用日期、
服務月份、發票號碼、附件、OCR 確認或送件狀態。V3 不在範本保存新廠商銀行資料，
公司付款範本僅能引用已建立的廠商。

使用者可新增、選擇套用、覆寫／重新命名與刪除自己的範本。系統不會在多張範本中任意自動套用，避免誤帶錯誤廠商或金額。

正式 PR、migration 與部署尚未執行，需另行取得明確發布授權。

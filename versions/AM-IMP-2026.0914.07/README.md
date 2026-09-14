# AM-IMP-2026.0914.07 — 請款單具名個人範本

Status: `Deployed`

讓每位已驗證的 LINE 送件人在四種請款單中，各自保存多份具名私人範本（每種表單最多 20 份）。

- 舊版三張 LIFF 表單由 AM Platform 驗證原群組與本人身分，再以匿名 reference 向 Finance Claims 讀寫範本。
- V3 由 Finance Claims Web session 直接限制在目前登入者與目前表單。
- 範本只保存可重用的付款與明細內容；請款月份、費用日期、服務月份、發票號碼、附件、OCR 核對與送件狀態不保存。
- 新廠商銀行資料不寫入範本；V3 公司付款範本只接受已建立的廠商。
- 使用者可新增、選擇套用、覆寫／重新命名及刪除自己的範本；多範本模式不會任意自動套用其中一份。

這是 HOZO 專案功能，不複製任何使用者資料或 LINE 識別碼到 AMCore。

Production evidence: Rental PR #274 was merged as `2a7209bfb9dec9bbebcc9681889366efc35e2d15`
and deployed successfully through Cloudflare Actions run `34850265948`. AM Platform PR #156
was merged as `8346f57bb0221405c9b6eaef241b67ab2b5d8db4`; both production health endpoints returned
HTTP 200, and the protected legacy administrator preview displayed the deployed named-template
controls in disabled preview mode without writing claim or template data.

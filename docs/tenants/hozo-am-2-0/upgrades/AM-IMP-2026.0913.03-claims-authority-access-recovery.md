# AM-IMP-2026.0913.03 — 請款功能管理授權復原

Status: `Deployed` (AM Platform `c6619de`; Rental `8f62475`; verified 2026-09-13)

HOZO 請款功能管理的失效入口改為安全復原頁。使用者由固定的 Rental 財務後台入口
重新登入與授權，再以既有一次性 SSO handoff 返回；沒有新增繞過租戶或角色驗證的路徑。

正式站已確認失效直連顯示重新授權頁；Rental 登入頁會保留固定復原參數，登入後再核發 SSO。

# AM Portal 統一帳號與權限整合方案

| 項目 | 內容 |
|---|---|
| 版本 | v1.0(2026-07-07,待 Seven 確認) |
| 目標 | 四專案(7AM/HOZO AM/HOZO Rental/BuildAM)統一帳號密碼與權限管控,單一管理介面 |
| 入口 | account.hozorental.com(統一登入+Seven 的管理後台) |

## 已確認的決策(Seven,2026-07-07)

1. 帳號形式:**名字+密碼**(不用 email);密碼經雜湊儲存,不存明文
2. 7AM/HOZO AM 的管控粒度:**專案層級**(誰能看/登入即可,不細分頁面)
3. 現有使用者:Seven、昱晴、Amber(財務)——HOZO Rental 後台現役;BuildAM 端另有其勳等工程夥伴
4. 所有專案網頁收編 `*.hozorental.com` 子網域(單一登入前提;am.hozorental.com 已完成)

## 架構

- **AM Portal 蓋在 Cloudflare**(與 HOZO Rental 同平台,不休眠),以 rental 現有 admin-auth 機制為種子升級
- 登入成功 → 簽發 HMAC 簽章 cookie(Domain=.hozorental.com,共用密鑰 PORTAL_SECRET)→ 全子網域通行
- 各服務(Cloudflare 端頁面、Render 端 BuildAM)以共用密鑰驗證 cookie,並比對授權矩陣
- **授權矩陣 = 人 × 專案 × 頁面群**,Seven 在管理後台勾選:
  - HOZO Rental:營運頁群(dashboard/calendar/cs)、財務頁群(bonus/company/contract)…(依現有 admin-*.html 分群)
  - BuildAM:儀表板、確認佇列
  - 7AM / HOZO AM:整專案可/不可
- BuildAM 佇列「操作人」自動帶登入者(實名歷程,取代手填)

## 分階段

| Phase | 內容 | 風險控管 |
|---|---|---|
| P1 | Portal 上線(帳號庫+登入頁+授權矩陣管理頁),HOZO Rental 遷移接入 | 相容現有帳密,昱晴/Amber 無感切換;舊機制保留為回退 |
| P2 | BuildAM 接入:個人帳號取代單一通行碼 hozo2026,操作人實名化 | 舊 key 網址保留一段過渡期 |
| P3 | 7AM/HOZO AM 網頁掛專案層級檢查 | 僅影響網頁,LINE bot 不動 |

## 待辦(實作前)

- 盤點 hozo-rental 現有 admin-auth 的帳號存放方式(KV/D1/硬編碼)與登入流程
- 確認 rental admin-*.html 頁面清單與分群
- 初始帳號名單與各自權限(Seven=管理員;昱晴、Amber、其勳=依角色)

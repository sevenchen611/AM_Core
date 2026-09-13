# AM-IMP-2026.0913.02 — HOZO 請款單管理者預覽

Status: `Installed` (local feature branches; not deployed)

讓受保護的「請款單管理」目錄可開啟四張表單的管理者預覽。

- 三種舊版表單直接重用正式 LIFF 表單 renderer，並固定各自的請款類型。
- V3 標準版連到 Rental 的正式申請頁預覽模式。
- 預覽不建立草稿、不上傳附件、不送出請款，也不建立假的 LINE 使用者 session。
- 舊版預覽仍受既有 `/claims-authority` 後台角色權限保護。

群組綁定、版本發布、表單編輯與使用範圍設定不在本版範圍。

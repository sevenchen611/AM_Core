# AM-IMP-2026.0913.03 — 請款功能管理授權復原

Status: `Installed`

當管理者直接開啟舊網址、登入逾時或 AM Platform 更新造成 SSO session 失效時，
`/claims-authority` 不再顯示原始權限 JSON，而會顯示保持 fail-closed 的重新授權頁。

重新授權按鈕只導回 HOZO 財務後台；財務後台仍須驗證登入、角色與功能權限，
再透過既有一次性 SSO handoff 返回請款功能管理。

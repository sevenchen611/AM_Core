# AM-IMP-2026.0830.04 — Mobile contract PDF attachment opening

Status: Deployed

The public review page replaces the unsupported mobile embedded PDF viewer with a `完整合併草約 PDF` attachment card. The complete draft and every original attachment open through a token-protected POST request in a new window, without blob URLs, public Drive links, or review tokens in the URL.

## Production verification

- PR #48 merged as `f8f3e40` and Render reported the deployment live.
- The production page contains `完整合併草約 PDF` and `開啟 PDF 檔案`.
- The production page contains no draft iframe or blob URL generation.
- The protected document control submits the token by POST to a new window.
- Existing LINE review links require no replacement or resend.

# Open work journal in the phone browser

Status: Ready. Target: existing shared AM Platform LINE account menu.

The 工作日誌 URI uses LINE's `openExternalBrowser=1` parameter so the phone opens the journal in an external browser and the user can switch back to LINE. The subtitle says 手機瀏覽器開啟. This package keeps the 2500 × 422 two-tile layout and UOF 待簽 action.

The installer must confirm the direct journal HTTPS origin and supply the URL. The external-browser placeholder requires `--journal-origin`; sensitive or unconfirmed query parameters fail closed. LINE credentials and production IDs/receipts stay outside the repository. This package does not migrate browser login or unsynced drafts. Phone acceptance remains separate from API/default/image verification.

Official specification: https://developers.line.biz/en/docs/line-login/using-line-url-scheme/#opening-url-in-external-browser

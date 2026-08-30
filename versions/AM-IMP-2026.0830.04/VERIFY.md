# Verify

- Run `npm run dryrun:contract-review`.
- Confirm the page contains a `完整合併草約 PDF` file card and no iframe.
- Confirm document controls use a POST form with a new-window target and not a blob URL.
- Confirm URL-encoded form tokens are accepted by the protected document endpoint.
- Verify on a mobile browser or LINE webview that tapping the card opens the PDF file.

# Verify

1. Run `npm run dryrun:contract-review`.
2. Run `node tools/check-upgrade-package.js AM-IMP-2026.0830.06`.
3. Run `npm run check`.
4. Open an existing V1 and V2 review link and verify the contract title, version, merged PDF, and attachments render.
5. Verify legacy LINE links still present the external-browser fallback and new links retain `openExternalBrowser=1`.

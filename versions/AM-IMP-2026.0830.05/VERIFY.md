# Verify

1. Run `npm run dryrun:contract-review`.
2. Run `node tools/check-upgrade-package.js AM-IMP-2026.0830.05`.
3. Run `npm run check`.
4. Verify a newly generated LINE message contains `?openExternalBrowser=1#token=`.
5. From LINE on Android and iOS, tap the link and confirm it is handed to an external browser.
6. Open a legacy link in LINE and confirm the fallback button is displayed.

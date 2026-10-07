# Verify

```text
node --check tools/apply-compact-rich-menu.mjs
node --test tools/test-journal-external-browser-url.mjs
node tools/check-upgrade-package.js AM-IMP-2026.1007.01
node tools/audit-alignment.js
node tools/compare-project-manifests.js
```

Dry-run the candidate with the confirmed origin/URL. Missing origin or URL must fail. Earlier 1006.06 and inactive 1006.05 configurations must still dry-run with explicit config/image paths. Inspect the new PNG for readable labels, no clipping and exact 2500 × 422 dimensions. Load the anonymous external-browser URL and confirm it reaches the existing login page without a redirect loop.

Production: verify channel, actual default, candidate URI with exactly one `openExternalBrowser=1` and no `openInAppBrowser`, both actions/bounds, menu dimensions, uploaded PNG SHA-256 and retained previous menu. Check aliases and any explicitly known per-user association independently; default verification does not prove per-user menu migration. No unsolicited LINE message or UOF approval is needed.

User phone acceptance: record iOS/Android, LINE and default browser versions; tap the actual 工作日誌 tile, confirm an independent browser opens, use an existing login or sign in, switch to LINE and back, and confirm the journal continues. Save designated test content before refreshing. Back up unsynced content in the old in-app browser; do not assume browser cookies or local drafts transfer. First-login/session-expiry/offline/conflict cases remain phone acceptance checks.

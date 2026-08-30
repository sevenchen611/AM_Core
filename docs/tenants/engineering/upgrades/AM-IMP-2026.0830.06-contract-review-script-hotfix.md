# AM-IMP-2026.0830.06 — Engineering contract review script hotfix

Status: Installed

The generated review-page script no longer interprets a regular-expression escape through the server template literal. Existing V1/V2 review links and stored files are unchanged.

The dry-run now executes the generated browser script with a LINE user agent and asserts that the legacy external-browser fallback is created without the `i is not defined` runtime failure.

Production deployment and live-link verification are pending.

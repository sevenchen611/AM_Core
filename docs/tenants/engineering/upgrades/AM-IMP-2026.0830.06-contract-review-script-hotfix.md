# AM-IMP-2026.0830.06 — Engineering contract review script hotfix

Status: Deployed

The generated review-page script no longer interprets a regular-expression escape through the server template literal. Existing V1/V2 review links and stored files are unchanged.

The dry-run now executes the generated browser script with a LINE user agent and asserts that the legacy external-browser fallback is created without the `i is not defined` runtime failure.

PR #52 merged as `119ffe9` and Render deployed the change. The live HZ-CT-001 V2 review link was reloaded in Chrome and displayed the version title, complete merged PDF, all three original attachments, and the feedback form with no browser error. Because V1 and V2 use the same generated review runtime, the shared failure is removed without changing either version's stored data.

# AM-IMP-2026.1007.01 — Work journal external browser

Status: Deployed. Verified on 2026-10-07 from reviewed PR #251 / main `0c5ac9e5117b7f66ee1515b8b9cdd8d75dcc962b`. Local URI contract tests, candidate/historical dry-runs, missing URL/origin rejection, visual inspection and package verification passed; full CI succeeded before merge/application.

The user authorized correction and formal deployment on 2026-10-07. The target is the existing shared 葉小蝸 LINE account menu, not a separate standalone tenant bot. Preflight matched the previous journal rollout channel/default and confirmed the direct journal root URL, 2500 × 422 layout and UOF 待簽 action. No aliases were configured; this rollout targets the default and does not claim all per-user menu assignments were enumerated or migrated.

The new journal URI has `openExternalBrowser=1`; subtitle 手機瀏覽器開啟. Credentials and menu IDs/private recovery receipts remain outside AMCore. User phone acceptance and first-login/unsynced-draft handling remain pending after API deployment. No journal or approval data is changed.

Production readback verified the created menu is the actual shared LINE default, the exact journal URI has one external-browser parameter, UOF 待簽 and both half-width bounds are preserved, size is 2500 × 422 and the retrieved PNG SHA-256 matches the main asset. The previous default/menu remains available in the target's private receipt for rollback. No LINE chat message was sent. No per-user association or alias was changed; default verification cannot prove every person's menu assignment.

Alignment audit/manifest comparison ran with the existing standalone project configuration and retained 113 pre-existing errors and 34 warnings. This menu deployment does not claim overall project alignment or independent phone acceptance. Runtime/database/environment configuration was not changed for this package.

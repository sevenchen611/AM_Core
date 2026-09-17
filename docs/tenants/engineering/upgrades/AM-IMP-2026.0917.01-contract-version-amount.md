# AM-IMP-2026.0917.01 — Version amount authority

Status: Deployed (actual AM Platform service and authenticated workspace verified).

Source evidence: the Engineering contract owner reported an approved version failing freeze with a generic package-invalid alert after the negotiated price changed. Read-only diagnosis confirmed the saved version/payment sum agreed but the backend master retained an earlier price. No live source record or attachment is copied into this package.

Payment validation now uses the saved version amount, matching PDF rendering, with master fallback only for legacy packages lacking the field. No master/Notion data synchronization or rewriting of saved versions is required. Genuine mismatches remain rejected with localized exact totals. Detail reads expose validation for the workspace, and percentage-only schedules derive from the issued version amount.

Local verification: management 36/36, domain 17/17, workspace generated-script/HTML tests, payment schedules, workflow API, issuance, LINE attachments, PDF renderer, scope, signing and final artifacts pass; package checker and npm syntax check pass. The legacy alignment audit still fails on pre-existing standalone project checkout/manifest gaps, not this tenant runtime; no complete legacy alignment is claimed.

Production evidence: PR #179 merged as `1ebe1f3e4eac053dafc25cf598845e6118db51c8`. Render `am-platform` deployment `dep-dalu8ge7bikc73c7lmdg` showed `Deploy succeeded | Live`, duration 41.9 seconds, service-live log at 2026-09-17 21:00:28 Asia/Taipei. Production health passed. After reload, the authenticated existing approved-version workspace displayed passed validation with matching saved-version and payment totals, despite the unchanged older master total.

The real contract remains approved. No live record rewrite, new contract version, freeze, issue, signing, LINE send or bank operation was performed. No migration or environment changes were needed.

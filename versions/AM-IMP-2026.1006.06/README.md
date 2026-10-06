# Enable the journal link in the half-height menu

Status: Ready. Target: existing shared LINE account menu.

LINE rollout: Deployed on 2026-10-06 from reviewed PR #247 / main `ab5ca5d3240b1651a903c00e7803a8dac368cda7`. The active default returned exactly the supplied journal URI, both click areas and the UOF 待簽 command at 2500 × 422. Uploaded image SHA-256 matched the local PNG. The production receipt remains outside AMCore. No chat message was sent during installation.

The user has provided a journal URL. The left 工作日誌 tile now opens that HTTPS address directly via a URI action and shows 開啟工作日誌 instead of 暫未開放. The 2500 × 422 layout and right-side UOF 待簽 command are preserved. AM assistant enablement and all journal runtime/data remain unchanged.

Supply the confirmed public URL using `--journal-url`; the shared config contains a placeholder. Secrets, menu IDs and production receipts stay outside AMCore. Earlier inactive assets/defaults remain available for rollback.

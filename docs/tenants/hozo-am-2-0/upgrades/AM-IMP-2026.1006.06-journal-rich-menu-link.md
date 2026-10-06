# AM-IMP-2026.1006.06 — Journal Rich Menu link

Status: Deployed. Verified on 2026-10-06.

Applied from reviewed PR #247 / main `ab5ca5d3240b1651a903c00e7803a8dac368cda7`. The active LINE default returned the exact user-provided journal URI on the left and 待簽 on the right, with 2500 × 422 dimensions. The retrieved image SHA-256 matched the local PNG. The journal URL returned HTTP 200 at its UOF login page. The application receipt is outside AMCore and the former default remains available for rollback.

工作日誌 becomes a URI action pointing to the user-provided journal URL, with an active tile and 開啟工作日誌 subtitle. The current 2500 × 422 layout and UOF 待簽 command remain. There are no journal data/runtime changes or AM private assistant activation. Production IDs and rollback receipts remain outside AMCore; actual default, exact URI/action bounds and image hash must be verified before Deployed.

# AM-IMP-2026.0831.04 — Contract LINE conversation archives

Status: Deployed

Engineering AM captures non-overlapping, immutable LINE conversation intervals immediately before each external draft-review send and final formal issue. The private archive PDF is independently openable and appended to the version's merged contract PDF.

Only messages already captured by Engineering AM from the contract's authoritative bound LINE group are eligible. Messages before bot participation, recalled messages that were never received, or failed webhook deliveries cannot be reconstructed.

Production verification (2026-09-02): schema
`2026-08-31.engineering-contract-evidence.v4` was applied to the dedicated
`engineering_contracts` database. HZ-CT-001 V1 through V3 were backfilled
without resending LINE, producing three protected immutable PDFs containing 17
stored group messages in total. The V1 archive opened successfully through the
authenticated Engineering AM route. Temporary migration-only database
privileges were revoked after installation; the existing fixed database
password was not changed.

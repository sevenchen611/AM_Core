# AM-IMP-2026.0902.04 — Contract workflow timestamp normalization

Status: Installed

Installed locally on 2026-09-02. PostgreSQL transition timestamps are normalized from JavaScript `Date` objects to ISO text before the service verifies immutable content and exact transition evidence. This prevents a successful draft-submission or approval commit from being reported to the Engineering AM UI as a generic failure.

Production deployment and read-only verification are pending. No database migration is required. HZ-CT-001 V12 was found in `internal_review` after reloading; no duplicate submission, approval, return, freeze, signing, or LINE action was performed during diagnosis.

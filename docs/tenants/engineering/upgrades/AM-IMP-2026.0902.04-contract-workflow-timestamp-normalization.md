# AM-IMP-2026.0902.04 — Contract workflow timestamp normalization

Status: Deployed

Installed locally on 2026-09-02. PostgreSQL transition timestamps are normalized from JavaScript `Date` objects to ISO text before the service verifies immutable content and exact transition evidence. This prevents a successful draft-submission or approval commit from being reported to the Engineering AM UI as a generic failure.

Production evidence: PR #93 merged as `3475cfc356ce307bf494e928bd13c43a1f81cbed`; Render deployment `dep-dabs2uss728c73aidni0` succeeded on service `srv-d97s94utrd3s739lin30`, and production health returned HTTP 200. Authenticated reload showed HZ-CT-001 V12 in `internal_review`, proving the original submission committed despite the former false alert. No duplicate submission, approval, return, freeze, signing, or LINE action was performed during verification.

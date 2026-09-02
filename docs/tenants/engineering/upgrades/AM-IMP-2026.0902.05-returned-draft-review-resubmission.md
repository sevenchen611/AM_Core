# AM-IMP-2026.0902.05 — Returned-draft review resubmission recovery

Status: Deployed

Installed locally on 2026-09-02. A second submission after `internal_review → draft` now replaces the previous review timestamp and actor. The Engineering AM workspace also reloads authoritative contract state after a workflow response error and restores the correct controls when the transition already committed.

Production evidence: PR #95 merged as `8116920049d44d8a800a8952ce1c48d6bc0983b7`; Render deployment `dep-dabsei9t0dsc73d071u0` succeeded on service `srv-d97s94utrd3s739lin30`, and health returned HTTP 200. The authenticated workspace served the response-recovery logic. A later read-only reload showed HZ-CT-001 V12 in `frozen`; Codex did not submit, approve, return, freeze, sign, or send LINE during verification.

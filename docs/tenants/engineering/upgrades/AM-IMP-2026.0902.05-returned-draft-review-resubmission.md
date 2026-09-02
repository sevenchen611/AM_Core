# AM-IMP-2026.0902.05 — Returned-draft review resubmission recovery

Status: Installed

Installed locally on 2026-09-02. A second submission after `internal_review → draft` now replaces the previous review timestamp and actor. The Engineering AM workspace also reloads authoritative contract state after a workflow response error and restores the correct controls when the transition already committed.

Production deployment is pending. Read-only diagnosis confirmed HZ-CT-001 V12 had again committed to `internal_review`; no duplicate submission, approval, return, freeze, signing, or LINE action was performed by Codex.

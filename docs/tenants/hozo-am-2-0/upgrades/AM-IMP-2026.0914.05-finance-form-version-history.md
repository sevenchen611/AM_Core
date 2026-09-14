# AM-IMP-2026.0914.05 — Claim form retirement and immutable version history

Status: `Deployed`

The shared-operating legacy form is no longer assigned to any LINE group and is hidden from the
active claim-form catalog. It remains visible under disabled history for audit and recovery.

Finance owns the immutable published definitions. Three legacy forms received a published v1
baseline, new legacy claims store the selected form id, version number, definition hash and
submission-time snapshot, and existing legacy claims remain unchanged with an inferred v1 marker.
The AM management page displays the current version and version history for every form.

Rental PR #276 introduced the version records and claim snapshots. Read-path hardening completed
through PR #280, merged as `61547233d00f9256bc8a7834b84b76d76e0f5cc8`, and Cloudflare deployment
run `34847479059` succeeded. AM PR #157 introduced the management history and disabled section;
PRs #160 and #161 bounded degraded loading and rendered the verified v1 baseline immediately.
Render deployed final commit `c1cbb9133d204e94849e69c8f8cbcfec230dbc9d`.

Verification passed the AM claims-authority, claims-governance and Finance V3 dry-runs, the Rental
Finance Claims V3 foundation and admin API suites, the legacy workflow regression, worker syntax,
Cloudflare deployment checks, and a production UI review.

# AM-IMP-2026.0828.05 — Engineering contract draft review

Tenant: `engineering`
Runtime target: `AM_PLATFORM`
Status: Ready

## Prepared and verified

- Incomplete draft versions may be shared when the contract body exists and the contract is bound to an active Engineering LINE group.
- The generated PDF and public page conspicuously state that the draft is for discussion only and cannot be signed.
- The review token is carried in the URL fragment; PostgreSQL stores only its SHA-256 digest.
- LINE send acceptance, first open, reviewer name, decision, notes, time, IP, and user agent are retained as project-local evidence.
- Reviewer feedback is separated from electronic-signing evidence. It cannot freeze, issue, sign, or complete a contract.
- Existing V1 remains immutable; staff create V2/V3 to incorporate requested changes.
- Unit/dry-run regressions pass, and the two-page Traditional Chinese sample PDF passed rendered visual inspection.

## Deployment gate

Apply schema v3 with the migration owner and explicitly grant only the new narrow privileges to the existing restricted runtime role. Then deploy and verify the public review page plus the internal review-history UI in production.

No real LINE draft is sent as part of automated deployment. Sending requires an operator-selected contract and its exact bound group.

## Rollback posture

Disable the new routes by rolling back application code, but retain all review rows, events, and private Drive artifacts. Never delete or rewrite reviewer evidence or contract versions.

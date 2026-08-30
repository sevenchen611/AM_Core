# AM-IMP-2026.0828.05 — Engineering contract draft review

Tenant: `engineering`
Runtime target: `AM_PLATFORM`
Status: Deployed

## Prepared and verified

- Incomplete draft versions may be shared when the contract body exists and the contract is bound to an active Engineering LINE group.
- The generated PDF and public page conspicuously state that the draft is for discussion only and cannot be signed.
- The review token is carried in the URL fragment; PostgreSQL stores only its SHA-256 digest.
- LINE send acceptance, first open, reviewer name, decision, notes, time, IP, and user agent are retained as project-local evidence.
- Reviewer feedback is separated from electronic-signing evidence. It cannot freeze, issue, sign, or complete a contract.
- Existing V1 remains immutable; staff create V2/V3 to incorporate requested changes.
- Unit/dry-run regressions pass, and the two-page Traditional Chinese sample PDF passed rendered visual inspection.

## Production deployment evidence

- PR #40 merged to `main` as `4b1eb0ea141891706eaf5ef66b4dda4ebdfa846a` and Render reported the same commit live.
- The Engineering contract database reports schema version `2026-08-28.engineering-contract-evidence.v3`.
- `contract_draft_reviews` and `contract_draft_review_events` exist with forced RLS and both database guard triggers.
- The restricted runtime role has the intended review-table privileges and lacks delete/truncate or event update privileges.
- Temporary migration access was removed: the platform owner cannot use the Engineering owner role, its `SET` option is disabled, and temporary database `CONNECT` is revoked.
- `https://am.hozorental.com/contract-review` returned 200 with no-store, no-index, frame denial, the draft warning, and the non-signature disclaimer.
- The production Engineering AM contract workspace loaded HZ-CT-001 V1 and displayed `產生草約並送 LINE 群組確認` while still blocking formal review because payment and acceptance sections are incomplete.

No real LINE draft is sent as part of automated deployment. Sending requires an operator-selected contract and its exact bound group.

## Rollback posture

Disable the new routes by rolling back application code, but retain all review rows, events, and private Drive artifacts. Never delete or rewrite reviewer evidence or contract versions.

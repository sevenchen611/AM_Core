# Verify

- `node tools/dryrun-engineering-contract-workspace.mjs`
- `node tools/dryrun-engineering-contract-structured-body.mjs`
- `node tools/dryrun-engineering-contract-management.mjs`
- `node tools/dryrun-engineering-contract-draft-review.mjs`
- `node tools/check-upgrade-package.js AM-IMP-2026.0902.02`
- `node tools/audit-alignment.js`

Authenticated production checks:

- Opening the next-version composer shows the currently effective contract body, drawings, and quotation as reusable files.
- Empty optional rows do not prevent an incomplete draft from being saved.
- Existing payment and acceptance rows are carried forward.
- A legacy quotation stored only in cumulative attachment history appears as the effective quotation and is promoted into the saved next version.
- A generated internal preview contains one payment table in Article 5 and one project-acceptance table in Article 10.
- General invoice and acceptance-procedure clauses remain present.
- Historical inherited files appear only in the evidence index, not as repeated attachment pages.
- No LINE message or signing action is triggered by verification.

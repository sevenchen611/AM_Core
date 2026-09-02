# Verify

- `node tools/dryrun-engineering-contract-workspace.mjs`
- `node tools/dryrun-engineering-contract-structured-body.mjs`
- `node tools/dryrun-engineering-contract-management.mjs`
- `node tools/dryrun-engineering-contract-draft-review.mjs`
- `node tools/dryrun-engineering-contract-signing-web.mjs`
- `node tools/dryrun-engineering-contract-completion.mjs`
- `node tools/render-engineering-contract-structured-pdf-qa.mjs tmp/pdfs/engineering-contract-structured-qa.pdf`
- `node tools/check-upgrade-package.js AM-IMP-2026.0902.03`
- `node tools/audit-alignment.js`

Authenticated production checks:

- Starting V12 shows structured engineering, Party A/B, schedule, warranty, performance-bond, promissory-note, delay-penalty, and signing-date fields.
- V11 remains unchanged and immutable.
- Existing V11 documents, payments, acceptance criteria, and historic evidence remain carried forward.
- A synthetic PDF starts the legal body at Article 3 and contains no duplicated opening parties, Article 1, Article 2, or closing Word party block.
- Articles 7 through 10 and the later standard clauses remain present.
- The signing section distinguishes Party A electronic confirmation from Party B handwritten electronic signature.
- The contractor signature is present on the single-page promissory note.
- A signed PDF receives hash-verified front/back ID images and renders them in the protected appendix.
- No production contract version, LINE message, internal review, freeze, or signing action is triggered by verification.

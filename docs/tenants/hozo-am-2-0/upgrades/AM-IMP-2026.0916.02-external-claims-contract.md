# AM-IMP-2026.0916.02

Status: Deployed

This correction sends Rental's canonical source id and the exact opaque LINE
group reference with every external legacy claim action. It also gives external
applicants private, named templates without enrolling them in Finance V3 or
granting any administrator or bank-account capability.

Deployment order is Rental first and AM Platform second. Production verification
must not create a synthetic financial claim; a real external vendor is the final
submission and template canary.

Production deployment completed on 2026-09-16:

- Rental PR #283 merged as `ea2951e1cd1901a718e0c5f250a580cc9fc1bbbe`.
- Cloudflare Pages deployment run `35057287058` passed every regression and deploy step.
- Rental's formal claim and personal-template integration endpoints returned their expected HTTP 401 machine-authentication response in approximately one second, proving the new Worker was live without the earlier schema delay.
- AM Platform PR #172 merged as `ab0a2417ea2895a106c4037f483a2418998d4379`.
- Render deployment `dep-dal21te8bjmc73d8ciig` reached Live in 29 seconds on service `srv-d97s94utrd3s739lin30`.
- Production `/health` returned HTTP 200 with HOZO AM 2.0 authorized and the claims module loaded.

The remaining canary is a real external applicant saving a named template and
submitting a genuine claim; deployment verification did not create financial data.

## Production schema correction

The first production claim proved the canonical source correction, but also
revealed that the additive external-template table had not been created because
the existing database and runtime constant were both still at web schema v5.

The correction completed on 2026-09-16:

- Rental PR #284 merged as `2df8e0fac62d0c6181efafe375bbc17a0a0d91fa`.
- Cloudflare Pages deployment run `35063163576` passed and deployed the exact main revision.
- The runtime schema version is now v6 and has a regression test starting from a production-like v5 database without the external-template table.
- The additive production schema was applied from migration 0081; read-only verification confirmed schema v6, the table present, and zero external templates before user testing.
- The existing successful claim `CLM-202609-CL0EUW` remained in `waiting_review`.
- AM PR #174 merged as `1143d358e7ad1118edff46dff79230911d56ae2e` and Render deployment `dep-dal3av0jo6nc73audaog` reached Live, adding a diagnostic message that distinguishes schema availability from user permission.

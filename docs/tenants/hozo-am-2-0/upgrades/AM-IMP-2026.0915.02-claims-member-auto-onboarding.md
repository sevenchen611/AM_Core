# AM-IMP-2026.0915.02

Status: Deployed

HOZO claims authorization now follows the operational rule that a current member of an active, form-published LINE group may submit unless individually disabled. The Finance bridge can provision a claim-only external identity on first use, so vendor applicants do not need an internal portal account.

Production deployment completed on 2026-09-15:

- Rental PR #281 merged as `b9c9fdf928be477d117aee8b82f1f1e42c580eae`; Cloudflare Pages run `34989712762` passed, the Claim Web returned HTTP 200, and the unauthenticated machine bridge correctly returned 401.
- AM PR #168 merged as `41c686ac8a6991cab40362c42c0c4d042d37947c`; Render deploy `dep-dakmd8gae00c73dabqu0` reached Live.
- Production `/health` returned HTTP 200 with HOZO claims loaded, LINE configured, and authorization ready.

Bonnie should now retry from the original authorized LINE group. That real LINE login is the remaining user canary; no claim was submitted during deployment verification.

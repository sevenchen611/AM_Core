# AM-IMP-2026.0916.01

Status: Deployed

HOZO claim groups now have an explicit external or internal mode. External vendor groups keep only the safe, applicant-bound legacy claim flow and individual deny control; internal groups retain Finance Claims V3 identity and membership behavior.

The package also adds the explicit platform-owner RLS read policies required by notification recipient resolution while preserving forced tenant isolation for normal access.

Production deployment completed on 2026-09-16:

- AM Platform PR #170 merged as `e8383f0d23aee03e5c9298a6916cf8719f7e62a6`.
- Render deployment `dep-dal02t15efls73fl0q90` reached Live on service `srv-d97s94utrd3s739lin30`.
- Production health returned HTTP 200 with LINE configured, HOZO authorization ready, and the claims module loaded.
- The protected administration page was reauthorized and reloaded after deployment.
- `HOZO vs 葉綠宿` was set to `external_claim_only`; `HOZO 財務群組` remains `internal_v3`.
- The V3 assignment dialog showed the external group disabled and unselected, while the internal finance group remained the sole selected V3 group.

The remaining user canary is an actual vendor opening and submitting an eligible legacy form from the external LINE group; deployment verification did not create a claim.

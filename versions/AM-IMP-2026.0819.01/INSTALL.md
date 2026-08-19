# Install

1. Deploy the compatible Rental release first. It must accept `am-claims-v2`,
   validate line categories and business units, and expose the finance review
   preview.
2. Deploy the AM Platform runtime containing the updated `claims` module.
3. Configure `tenant.config.claims.businessUnits` with only valid Rental
   business-unit identifiers. Do not copy another tenant's project identifiers.
4. Keep the existing claims LIFF ID, Rental base URL, and token in the secure
   runtime environment; do not write them into this package.
5. Open a fresh signed claim link. Existing in-memory links may still render an
   older page and should be allowed to expire.

The Rental schema is additive and is created by its idempotent runtime schema
guard. Do not run an unapproved remote migration from this package.

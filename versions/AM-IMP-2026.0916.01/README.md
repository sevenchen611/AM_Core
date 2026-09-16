# Claims group modes

Claims administrators can classify each authorized LINE group as either:

- `external_claim_only`: vendor-facing legacy claim forms with no Finance V3 identity onboarding.
- `internal_v3`: employee-facing Finance V3 identity, membership and finance capabilities.

Both modes still require the exact authorized LINE group, the original applicant's LINE login, a short-lived selector session, an observed current member, and no individual denial. External mode does not grant employee, administrator, or bank-account privileges.

Existing groups default to `internal_v3` so deployment does not silently reduce authorization checks. Administrators explicitly switch vendor groups after deployment.

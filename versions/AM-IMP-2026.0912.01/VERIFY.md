# Verify

1. Confirm `discovered_groups`, `groups`, `members`, `events`, `outbox`, and
   `audit` exist; confirm RLS is both enabled and forced.
2. Confirm unbound shared-OA discovery is platform-owner-only before tenant assignment.
3. Confirm activation transitions `activating -> active` only after the V3 Finance source provisioner succeeds; failure is `needs_attention` and retry is idempotent.
4. Confirm a spoken member can receive exactly one V3 applicant-bound short-lived link only while group is active, OA present, and no manual deny applies.
5. Confirm deny persists across `memberLeft` and rejoin; confirm OA `leave` pauses the group.
6. Confirm shadow/enforce, missing tenant context, cross-tenant access, duplicate webhook, audit/outbox retry, and raw-ID redaction fail safely.
7. Confirm the fixed identity key is present only in the target secret store;
   ciphertext starts with `fixed-v1` and unsupported formats fail closed.
8. Confirm the admin page never sends raw LINE group/member IDs to the browser,
   requires authenticated roles, and requires CSRF validation on mutations.
9. Confirm outbox leases use `SKIP LOCKED`, retries back off, leases cannot be
   completed by another worker, and exhausted deliveries become `dead`.
10. Confirm “重新掃描已知群組” reads only the selected tenant's group-binding
    registry, verifies current OA membership through LINE group summary, and
    adds verified groups without exposing raw LINE IDs to the browser or logs.

Run locally:

```text
node tools/dryrun-claims-authority.mjs
node tools/dryrun-claims-authority-admin.mjs
node tools/dryrun-claims-authority-contract.mjs
node tools/dryrun-claims-authority-outbox.mjs
node tools/dryrun-claims-authority-postgres.mjs
node tools/dryrun-claims-authority-runtime.mjs
node tools/dryrun-claims-authority-v3.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0912.01
```

Run the package and alignment checks only after the target project installation is complete.

# AM-IMP-2026.0907.01 - Reliable LINE group onboarding confirmation

Status: Installed

## Engineering installation

- The Engineering AM binding command tolerates common LINE formatting
  variations without changing the authoritative group-ID boundary.
- The same tenant-local Notion binding workflow and cross-tenant duplicate
  checks remain in force.
- If the reply token fails after processing, the result is delivered through
  one idempotent push to the originating group.
- Reply and push failures are visible in service logs.

## Verification boundary

Local verification passes. Production deployment and one target-group retry
are pending; no group binding or LINE message was created by this package.

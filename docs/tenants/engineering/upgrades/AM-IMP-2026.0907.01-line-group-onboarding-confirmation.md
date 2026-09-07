# AM-IMP-2026.0907.01 - Reliable LINE group onboarding confirmation

Status: Deployed

## Engineering installation

- The Engineering AM binding command tolerates common LINE formatting
  variations without changing the authoritative group-ID boundary.
- The same tenant-local Notion binding workflow and cross-tenant duplicate
  checks remain in force.
- If the reply token fails after processing, the result is delivered through
  one idempotent push to the originating group.
- Reply and push failures are visible in service logs.

## Verification boundary

Local parser, reply/push-delivery, core, syntax, package and whitespace checks
passed. PR #122 was merged at commit `137a535`; Render deployment
`dep-daf6a695efls73ag57ig` reached Live. Production health returned HTTP 200,
reported build `engineering-group-onboarding-confirmation-2026-09-07`, and
confirmed Engineering LINE, Notion and group routing are ready. The target
group must resend its command once to complete the actual binding; deployment
verification did not create a binding or send a LINE message.

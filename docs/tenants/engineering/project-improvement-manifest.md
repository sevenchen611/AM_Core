# Engineering AM — Project Improvement Manifest

Tenant key: `engineering`  
Environment prefix: `ENG`  
Runtime target: `AM_PLATFORM`

| Version | Status | Capability | Scope | Notes |
| --- | --- | --- | --- | --- |
| AM-IMP-2026.0828.01 | Ready | Engineering contract management and immutable electronic-signing evidence | Graphical contract workspace, dedicated PostgreSQL evidence schema, additive Notion projection, Drive artifacts, LINE-group LIFF signing and evidence PDF | Runtime code, private PostgreSQL certificate pinning, restricted production role/schema, additive Notion fields, Drive verification, dedicated LIFF configuration, backup export, and production PDF renderer are verified. Signing remains disabled pending trusted-proxy request evidence, a restore/hash drill, and one controlled LINE-group pilot. |

## Tenant and evidence boundaries

- Engineering AM's graphical `/contracts?tenant=engineering` workspace is the
  primary internal management interface.
- PostgreSQL schema `engineering_contracts` is the authoritative workflow and
  signing-evidence store. Notion is a retryable management projection only.
- Contract files and generated evidence must remain below the existing
  Engineering Drive root. No Rental, HOZO, Seven, Forest, or Green Hotel data
  may be copied into this workflow.
- Invitations are sent to the contract project's active LINE group. Possession
  of the group-visible link is not signing authority; the designated LINE user,
  current group membership, LIFF identity, token, and frozen bundle hash must
  all match.

## Activation gate

`ENG_CONTRACTS_SIGNING_ENABLED` stays `0` until every remaining check in the
project-local upgrade record and package `VERIFY.md` passes. A deployed runtime
with signing disabled is not a completed signing deployment and must not be
recorded as `Deployed`.

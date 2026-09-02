# AM-IMP-2026.0902.14 - Individual Party A online signing

Status: Deployed

## Engineering installation

- Individual Party A contracts require separate, distinct Party A and Party B
  LINE signer assignments from the contract-bound group.
- The protected LINE signing page now opens a dedicated Party A signing field
  for the Party A account and keeps Party B identity fields out of that role.
- Group-member inspection remains read-only and displays both applicable roles.
- Final confirmation checks the private Party A online submission artifact
  before it confirms or archives the contract.
- Active individual sessions can bind Party A once without reissuing the frozen
  PDF. This installation does not automatically choose or bind a real person.
- Company Party A contracts remain unchanged and use their frozen company seal.

## Verification boundary

Core, web, issuance, outbox, completion, workflow API, workspace, runtime,
security, store, Party A profile, schema-v8 migration, syntax, package, and
whitespace checks passed locally.

Production verification completed on 2026-09-02:

- PR #111 merged as `76e2c86004423c07266d19cfdfa21df3e69920f2`.
- Render deploy `dep-dac2423bc2fs73f1p6dg` reached Live.
- The Engineering contract database migrated transactionally to
  `2026-09-02.engineering-contract-evidence.v8`; the restricted runtime role
  read the same version afterward.
- The temporary database-owner `CONNECT` and role-switch privileges used for
  migration were revoked and verified false after completion.
- A read-only production browser check confirmed the protected signing page
  contains the dedicated Party A canvas, consent control, and **送出甲方簽名**
  action. Existing sessions without a Party A assignment keep that panel hidden.
- HZ-CT-001 remained unchanged. No LINE message, signer assignment, contract
  signature, confirmation, or archive action was created during verification.

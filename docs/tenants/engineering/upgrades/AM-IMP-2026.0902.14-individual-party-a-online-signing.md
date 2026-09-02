# AM-IMP-2026.0902.14 - Individual Party A online signing

Status: Installed

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
whitespace checks passed locally. Production schema migration, deployment, and
read-only graphical verification remain pending. No LINE message, signer
assignment, contract signature, confirmation, or archive action was created
during local verification.

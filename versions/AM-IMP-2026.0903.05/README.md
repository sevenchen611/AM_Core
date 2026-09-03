# AM-IMP-2026.0903.05 — Engineering contract acceptance management

This package adds a controlled acceptance workflow for Engineering contracts.
The checklist is derived only from the immutable acceptance criteria inside a
frozen contract version. Each submission carries private evidence references
and hashes; each review and reopen is an append-only, hash-linked audit event.

The package does not send messages, create payment requests, close a contract,
or change any live Engineering record by itself. A project owner must approve
production installation and operational use.

## Included control rules

- A draft or mutable contract version cannot create an acceptance checklist.
- Evidence-required criteria cannot be submitted without at least one
  immutable evidence link and SHA-256 hash.
- Submit, review, and reopen each require a separate explicit role.
- Non-acceptance reviews and every reopen require a reason.
- Events are append-only and must form one contiguous hash chain per frozen
  contract version.
- Reopening never erases an accepted decision; it records a new event and
  returns the item to rework-required.

No customer evidence, tokens, Drive identifiers, or production data is included
in AMCore.

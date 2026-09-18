# Bank notification mention registry

Status: Deployed (recipient/delivery acceptance still pending).

The AM finance sender reads the existing exact-group encrypted claims member
registry. It does not grant membership, copy personnel, infer nickname ownership,
change notification payload identities, or perform bank actions. Existing failed
notices can retry unchanged when the unique recipient resolves. Missing identities
remain failures; actual delivery requires provider acceptance and durable receipt.

PR 181 merged as f4b0e649a2d2be48d5992a54ff2377302b891620. Both formal service
health URLs verified that exact commit and claims-group-members-v1 at
2026-09-18T04:49Z; LINE and HOZO claims were enabled. The original three notices
still have empty sent timestamps, and a post-deploy automatic retry returned
mention_not_resolved. Bank confirmations remain complete, reviews zero and
amounts paid zero. Static allowlisted resolution reason diagnostics are added
without weakening any guard or exposing member names/LINE identities.

Offline checks passed: bank mention registry, existing finance sender delivery
guards, all eight claims-authority dry runs, syntax and upgrade package validation.
The global standalone alignment audit has 113 existing failures on both clean
main dc69ea5 and this feature, with no new errors. This package installs only in
AM Platform's HOZO tenant, not standalone HOZO_AM/SevenAM; no global ecosystem
alignment is claimed. The focused target runtime and upgrade checks pass.
The user confirmed the AM_Core destination and requested deployment. Formal
authority records could not be independently inspected with local service
configuration; actual recipient resolution and original sent receipts remain
post-deployment acceptance checks, not facts proved by offline tests.

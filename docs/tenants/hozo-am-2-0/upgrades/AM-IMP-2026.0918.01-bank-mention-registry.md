# Bank notification mention registry

Status: Deployed (recipient/delivery acceptance still pending).

PR 184 main 7c581346d8c2813bd0fc572d3e9ce3458ddb998a was verified on both
formal URLs at 05:10:31Z. Original retry failed at delivery_identity, after the
reviewer resolved and textV2 assembled, before LINE push. Safe categories now
also distinguish driver connection/authentication/TLS/timeout and binding input
errors; this follow-up is Installed until verified. No receipt is assumed.

PR 183 receiver main d16ab93d5183f6b5979aa113175ec88670749f6b was verified
on both formal health URLs at 05:02:57Z. The Rental producer PR 290 was deployed
from c033c18756dc074a6bb7f1b635221e9ba49fcd0a by Actions at 05:05Z.
Post-rollout original retries changed from name lookup failure to the protected
generic finance_notification_failed. Static stage/category/allowlisted SQLSTATE
diagnostics distinguish registry, durable binding and provider/receipt failures
without any exception text or weakening delivery guards. Three receipts remain
unconfirmed; this diagnostic follow-up is Installed pending formal verification.

The next compatible receiver change accepts a v2 opaque reviewer reference.
Production name-only retries returned member_name_not_found after PR 182
(35f17792ee11c7cab9ca30e81d5e7295bad1bb09, formal health verified 04:54Z).
This is a profile-label mismatch, not loss of the existing finance verification.
The Rental producer must reuse its active approval policy's verified recipient;
AM matches only that reference within the canonical group. Missing legacy fields
require an existing explicit recipient binding; no name aliases or new grants.
Consumer-first rollout and original source-event conflicts prevent duplicates.
These follow-up changes remain Installed until the new formal commit is verified.

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

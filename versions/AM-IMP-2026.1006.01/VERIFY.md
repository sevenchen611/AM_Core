# Verify

Run the binding, IO and capture tests and the package check listed in upgrade.json.
They use synthetic identities and local PGlite. Cover explicit migration, wrong
account/sender/key, unaffected second group binding, private command filtering,
one-time replies, idempotent pushes, no mentions, profile failure, malformed
sources, unfollow suspension and restoration of the original exclusive group.

Verify the consumer accepts the pilot's exact direct source and rejects another
account, another sender and malformed source. Verify its UOF authorization is
present without printing tokens. A production smoke check may send the pilot a
pending-category menu, but must not approve a real document automatically.
Record actual deployed commits and account mode without storing private keys.

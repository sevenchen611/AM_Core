# Rollback

Redeploy the prior application commit and disable the acceptance-management UI
routes if they were added. Do not delete acceptance event rows, linked evidence,
or frozen contract versions: they are audit evidence.

The additive table, append-only trigger, and tenant policies can remain in
place safely. A future migration may mark the feature deprecated, but must not
erase the event chain or modify historic hashes. Production rollback remains a
project-owner decision.

# Rollback — AM-IMP-2026.0828.05

Roll back the application release to remove new draft-review creation and public review routes. Preserve all PostgreSQL review rows, append-only events, and private Drive artifacts already created.

Do not drop the v3 tables, delete evidence, revoke previously recorded responses, or overwrite contract versions. Existing review links may be disabled at the routing layer if needed. Formal signing remains governed by its separate activation gate.

If a LINE send fails before provider acceptance, the application revokes that newly created review session and a retry creates a fresh token. Do not reuse or reconstruct a raw token from its stored digest.

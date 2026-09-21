# Rollback

1. Roll AM Platform back to the previous production commit.
2. Confirm health and the existing internal claims flow.
3. Keep all authority registry, selector and claim records; this package has no schema or data migration to reverse.

Rolling back restores the duplicate Notion dependency for external legacy forms,
so affected vendors should pause submissions until the corrected version is live again.

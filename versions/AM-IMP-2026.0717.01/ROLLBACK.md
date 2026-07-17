# Rollback

1. Point the single LINE webhook back to the previous engineering service URL.
2. If required, point the engineering custom domain back to the previous service.
3. Leave all Notion data source IDs unchanged; both runtimes reference the same engineering data in place.
4. Inspect the cutover window for duplicate messages or notifications before retrying.
5. Keep the `ENG_*` settings in AM Platform for diagnosis; they contain no schema migration that needs reversal.

Rollback does not authorize deleting platform records or reverting unrelated AMCore work.

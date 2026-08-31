# Rollback

1. Do not delete the archive table or any generated Drive archive; they are evidence records.
2. Redeploy the preceding runtime only if necessary, then set `schema_meta.version` back to `2026-08-28.engineering-contract-evidence.v3` with the migration owner so the preceding runtime can pass its compatibility gate.
3. The additive v4 table may remain in place and must remain immutable.
4. Restore the v4 runtime and schema version before resuming archive or contract send actions.

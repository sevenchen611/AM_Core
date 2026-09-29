# Rollback

Set AMCORE_LINE_DIRECTORY_ENABLED=0 (or remove it) and remove directory:read / operator catalog client entries before reverting to API 1.1.0. Keep existing IO credentials, allowlists, subscriptions, tenant bindings and message RLS unchanged.

Retain directory metadata tables for recovery. Do not drop them as part of rollback. The disabled directory stops catalog observation and endpoints; existing IO input/output continues. Re-enabling requires the tables and runtime-role grants to remain valid. Restore a reviewed main commit through the normal production deployment workflow.

# Rollback — AM-IMP-2026.0828.03

Revert the runtime commit and redeploy. The additive V2 properties may remain; deleting them would discard configuration evidence.

Do not restore an older member map over newer webhook-observed identities. If an incorrect identity was added, correct only that tenant-local group-binding row after checking the source LINE event.

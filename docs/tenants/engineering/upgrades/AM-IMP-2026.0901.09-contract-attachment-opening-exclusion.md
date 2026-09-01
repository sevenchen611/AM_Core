# AM-IMP-2026.0901.09 - Contract attachment opening and immutable exclusion

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Installed

The protected attachment failure was reproduced as `PATH_BODY_REFERENCE_MISMATCH`: the route binder treated `attachmentId` and `archiveId` as aliases of `versionId`. Each identifier now has its own exact aliases, and regression coverage includes V4 attachment indices 0 through 5 plus archive binding.

Managers can exclude a duplicate from the current lineage using the × control. The action inserts the next draft with a persistent file-identity exclusion; it never rewrites the displayed version or deletes the private Drive source. Production deployment and authenticated read-only verification are pending.

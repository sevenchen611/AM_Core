# AM-IMP-2026.0901.09 - Contract attachment opening and immutable exclusion

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Deployed

The protected attachment failure was reproduced as `PATH_BODY_REFERENCE_MISMATCH`: the route binder treated `attachmentId` and `archiveId` as aliases of `versionId`. Each identifier now has its own exact aliases, and regression coverage includes V4 attachment indices 0 through 5 plus archive binding.

Managers can exclude a duplicate from the current lineage using the × control. The action inserts the next draft with a persistent file-identity exclusion; it never rewrites the displayed version or deletes the private Drive source.

Production evidence: PR #79 was squash-merged as `c933ce446c29170a421de211ebdd22ad612066d3`; Render deploy `dep-dabdp0mk1f9s73fig340` reached Live. Public root and health checks returned HTTP 200. Authenticated read-only verification showed all six V4 attachment exclusion controls, and the protected PDF, current JPG, and historical PNG attachment routes opened successfully. No attachment was excluded and no new contract version was created during verification.

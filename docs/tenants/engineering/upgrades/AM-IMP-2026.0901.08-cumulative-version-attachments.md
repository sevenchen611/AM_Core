# AM-IMP-2026.0901.08 - Cumulative contract-version attachments

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Deployed

Every new contract version reconstructs a cumulative attachment set from all earlier versions in the same Engineering contract. Current files remain the working contract body, drawings, and quotation; replaced files are retained as historical attachments with their original source-version number.

The change does not rewrite V1, V2, V3, or any other immutable stored version. If an older version omitted earlier files, the next version repairs that lineage by reading the whole version history before inserting its new immutable snapshot.

Production evidence: PR #77 was squash-merged as `a6e1a30dc5b01735de49dd435d84056d6af6f658`; Render deploy `dep-dabdbb0u01pc73ednoa0` reached Live. Public root and health checks returned HTTP 200, and the authenticated Engineering workspace served both cumulative-inheritance markers.

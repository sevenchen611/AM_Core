# AM-IMP-2026.0901.07 - Contractor details and contract PDF layout

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Installed

The formal signing page requires the contractor's legal name, identity number, and address before accepting a signature. These values join the identity photos and signature in immutable PostgreSQL evidence and are written into the final signed contract PDF. LINE status messages, public API responses, and draft-review pages do not expose the submitted values.

Word contract bodies now carry Mammoth's safe structural HTML into the trusted PDF renderer so original Word tables remain tables instead of collapsing into a repeated text list. The generated party, payment, acceptance, and attachment sections use bordered grids with reserved footer space and no orphan table headings.

No database DDL is required because the existing signed evidence snapshot is JSON and is already covered by its immutable SHA-256.

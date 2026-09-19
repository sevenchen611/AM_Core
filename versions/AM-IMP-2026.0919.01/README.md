# AM-IMP-2026.0919.01 — Contract selection from Phase 1 drawing library

Engineering contract owners can select drawing versions already stored in the same project's `階段一：審圖與圖面定版` library while creating V1 or the next contract draft. The existing direct-upload control remains available.

The browser receives only safe candidate metadata and opaque drawing-version IDs. On save, the server reloads the authorized contract, derives its project, resolves those IDs from that project's tenant-local drawing index, verifies private Drive storage, downloads within the contract attachment limit, and computes SHA-256. It then stores an immutable contract-version reference and source snapshot. The original drawing-library file is not copied, moved, overwritten or deleted.

No schema or environment migration is required. This package is Engineering-only; it contains no production files, customer data, tokens or database identifiers.

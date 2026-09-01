# AM-IMP-2026.0901.08 - Cumulative contract-version attachments

Every new Engineering contract version inherits the unique files recorded by every earlier version, not only the immediately previous version. A new current contract body, drawing, or quotation does not erase its predecessors: the older files become version-labelled historical attachments and remain independently openable, present in the canonical manifest, and available to draft/final evidence generation.

The server rebuilds the lineage from the complete PostgreSQL version history, so it repairs omissions produced by older browser code. File identity is deduplicated by immutable Drive file id, then SHA-256 or source URL when necessary.

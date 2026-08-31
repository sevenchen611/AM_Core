# AM-IMP-2026.0901.01 — Direct Finance Claims v3 owner

Moves Finance Claims v3 from a cross-service waiting gateway into the paid `am-platform` Render service. LINE commands are durably persisted before webhook acknowledgement, deduplicated by the original event, retried by stage, and delivered through the existing notification ledger.

The Rental notification outbox remains authoritative for approval and payment notifications. This package does not delete historical queue or delivery data.

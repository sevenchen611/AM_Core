# Durable bank LINE replies

Status: Installed locally; production verification is required before Deployed.

A registry-owned bank quote is saved with its original text, message/event IDs,
group, sender and timestamp before acknowledging LINE. Accounting forwarding
runs from tenant-isolated PostgreSQL processing jobs, with restart recovery,
bounded retries and fenced leases. The HOZO memory console shows receipt state
and retained failure evidence separately from financial reconciliation.

Reuse existing request documents and attachments. Clarification asks for the
correct accounting correspondence and permission to reconcile, never another
screenshot. An acknowledgement such as `已入帳` does not itself authorize matching.

This root HOZO adapter does not install into legacy standalone HOZO or Seven.
Historical replies whose original envelope was never retained cannot be
reconstructed from a fingerprint. Do not fabricate or replay those events.

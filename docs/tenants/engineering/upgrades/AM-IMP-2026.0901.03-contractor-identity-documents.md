# AM-IMP-2026.0901.03 — Contractor identity-document evidence

Tenant: `engineering`

Runtime target: `AM_PLATFORM`
Status: Installed

The formal contractor signing page now requires both identity-card sides. Images are locally resized, server-validated, stored in a private confidential Drive folder, SHA-256 hashed, and bound to the immutable signature snapshot. The completed PDF and evidence receipt show only verified receipt metadata and hashes; photos and private references do not enter LINE, draft review, or the PDF.

Deployment evidence will be recorded after Render reports the merge commit live and the production signing page is verified without submitting a real contract or personal document.

# AM-IMP-2026.0901.03 — Contractor identity-document evidence

Tenant: `engineering`

Runtime target: `AM_PLATFORM`
Status: Deployed

The formal contractor signing page now requires both identity-card sides. Images are locally resized, server-validated, stored in a private confidential Drive folder, SHA-256 hashed, and bound to the immutable signature snapshot. The completed PDF and evidence receipt show only verified receipt metadata and hashes; photos and private references do not enter LINE, draft review, or the PDF.

Deployment evidence: PR #69 merged as `daede2b89bf9704c8b022a48f16c3733e000e1a1`; Render deployment `dep-dab7e9dg1s2s73e7ph0g` reports the same commit Live. The production health endpoint returned HTTP 200. Verification did not create a signing session, upload a personal document, change a contract, or send a LINE message. Formal signing remains governed by the existing activation gate.

# AM-IMP-2026.0901.03 — Contractor identity-document evidence

This package makes contractor identity-document photos mandatory at the formal electronic-signature boundary. The signer must provide both the front and back of their identity card before the signature can be submitted.

The browser resizes each selected image locally, and the backend independently validates PNG/JPEG bytes and size. Both files are stored under the signing session's private `身分證件（機密）` Drive folder. PostgreSQL's immutable signature evidence stores each private file reference, SHA-256 hash, MIME type, byte size, and received time.

The photos are never shown on the draft-review page, sent to LINE, or embedded in the signed PDF. The signed PDF and evidence receipt contain only the verified received times and SHA-256 hashes. Authorized staff can inspect the private originals when identity, performance, or dispute review requires it.

Consent version `engineering-contract-consent-v2-id-documents` states the collection purpose and offers written verification as an alternative when the contractor does not consent to electronic provision.

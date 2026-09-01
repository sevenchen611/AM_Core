# Verify

1. The signing page shows separate 身分證正面 and 身分證反面 file controls and the privacy-purpose notice.
2. Missing either side prevents submission before signature, Drive, PostgreSQL, or LINE writes.
3. The backend accepts only byte-valid PNG/JPEG images and enforces per-file and request-size limits.
4. Both photos are stored below the private signing-session folder and a failed privacy audit blocks signing.
5. The signed event contains both hashes and received times; the immutable signature snapshot also retains private refs, MIME types, sizes, and hashes.
6. Completion downloads both private originals and recomputes their hashes before producing the signed PDF and evidence receipt.
7. The signed PDF contains only received times and hashes; no identity image, Drive reference, LINE credential, or raw token is exposed.
8. The receipt contains `identity_document_front` and `identity_document_back` hashes.
9. Consent version is `engineering-contract-consent-v2-id-documents`.
10. Existing draft-review pages and unsigned contract workflows continue to work without identity photos.

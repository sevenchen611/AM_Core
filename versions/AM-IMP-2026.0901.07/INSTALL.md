# Install

1. Deploy the updated signing page, signing service, contract store adapter, draft-review extraction, issuance, completion, and PDF renderer.
2. Keep formal signing under the existing activation gate.
3. No database DDL is required; the existing immutable signature evidence JSON stores the three contractor fields.
4. Generate draft, issued, and signed PDFs only from the SHA-256 verified contract-body source.
5. Run the signing-web, signing, store, draft-review, issuance, completion, and PDF-renderer dry-runs.
6. Render `output/pdf/engineering-contract-layout-preview.pdf` and inspect every page as PNG before deployment.

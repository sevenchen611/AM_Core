# AM-IMP-2026.0830.02 — Engineering contract inline attachment review

Status: Deployed

The public review page will display the complete merged draft directly: the extracted contract body is followed by every page of PDF construction drawings and scaled quotation images. It will also render one protected open/download control per original attachment.

Existing review records require no migration. Their stored immutable contract snapshot identifies the attachment file IDs and hashes; the review service audits Drive privacy and verifies each SHA-256 value before composing or returning content.

## Production verification

- PR #44 merged as `4f2c48b` and Render reported the deployment live.
- The production public page contains the merged-preview iframe and separate original-attachment controls.
- The production health endpoint returned HTTP 200 with Drive configured.
- Composite regression and visual QA confirmed that every page of a source PDF is appended and watermarked; PNG and JPEG input paths are covered by the same regression suite.
- No contract reissue, database migration, or duplicate LINE delivery was required.

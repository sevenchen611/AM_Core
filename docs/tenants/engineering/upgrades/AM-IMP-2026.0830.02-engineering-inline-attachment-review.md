# AM-IMP-2026.0830.02 — Engineering contract inline attachment review

Status: Ready

The public review page will display the complete merged draft directly: the extracted contract body is followed by every page of PDF construction drawings and scaled quotation images. It will also render one protected open/download control per original attachment.

Existing review records require no migration. Their stored immutable contract snapshot identifies the attachment file IDs and hashes; the review service audits Drive privacy and verifies each SHA-256 value before composing or returning content.

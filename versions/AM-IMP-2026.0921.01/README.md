# AM-IMP-2026.0921.01 — Contract signer identity attachments

Expose the signing party's original front/back identity-card images beside the final signed contract in the internal Engineering contract workspace.

The files remain in their existing private Drive evidence location. The server derives their references and SHA-256 hashes from the completed signing session, rechecks tenant/project scope and Drive privacy, verifies content type and hash, and streams them with private no-store headers. No sensitive file is copied, made public, embedded in a URL, or sent to LINE.

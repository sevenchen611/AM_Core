# AM-IMP-2026.0921.01 — Contract signer identity attachments

Status: Deployed.

Completed Engineering contracts display protected links for the signing party's original identity-card front and back images beside the final signed PDF. The runtime reuses the immutable private Drive references already captured during signing, so existing contracts need no re-signing or upload.

No production data, schema or environment migration was required. PR #190 merged as `be59b3dd6d65eb60e09d573ab399cf9b592b93ce`; production health returned HTTP 200 with the exact commit. A credential-free probe of the new identity-image endpoint returned HTTP 401, confirming the production authorization boundary. Local authenticated artifact/route dry-runs passed. Automated browser acceptance could not run because the Windows computer-use sandbox helper failed; no production identity image bytes were requested or displayed.

# AM-IMP-2026.0916.03 — Contract LINE files

Status: Installed (local verification; not deployed).

User evidence: Engineering contract owners requested that quotation/drawing files already uploaded to the bound LINE group appear with internal review documents, allowing explicit retention/removal and contractor access to retained contract attachments.

Implemented a tenant/project/group-scoped candidate list and preview, server-resolved selections, private Drive checks and SHA-256 capture. Retention creates a next draft rather than changing reviewed/frozen/signed packages. Existing exclusion controls preserve original files and source versions. Each retained attachment records its LINE message, sender, time, group and source attachment reference inside the project-local version.

Formal LINE contract links now list retained original files from their authorized issued session, not from any newer internal draft. PDF/images render on-page; Office/CAD originals download through the protected gateway. Attachment viewing cannot bypass the full-contract review consent gate.

No production contract data was modified, no files were deleted and no LINE messages were sent. No database migration or separate HOZO_AM/SevenAM installation is required for this Engineering-only target.

Verification: dedicated attachment dry-run, workspace browser-script compilation, workflow route/capability tests, signing web, draft-review, management and scope tests pass. Package validation passes. Legacy alignment audit still depends on separately configured HOZO_AM/SevenAM checkout paths; this record is not a claim of complete legacy alignment.

Initial rollout: PR #176 merged as `767cbf593f72f6222b260e9d4add0b95e5e77486`. Render `am-platform` deploy `dep-dalsnrjbc2fs738d6aeg` became Live on 2026-09-17 at 19:16 Asia/Taipei; health passed. The authenticated Engineering workspace displayed the new candidate panel and group-scoped records. This read-only check found that AI-renamed photo slugs had lost their display extension; the follow-up recovers supported extensions from the preserved original Notion file name, without relabeling explicitly unsupported formats.

Remaining: verify the original-name follow-up rollout; owner-approved Android LINE attachment viewing/download checks. Deployment verification and mobile device acceptance are recorded separately.

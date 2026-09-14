# AM-IMP-2026.0914.04 — Engineering LINE attachment Drive archive

Google Drive becomes the source of truth for every binary attachment received
in an active Engineering AM LINE group.

- Images, ordinary files, CAD files, archives, and videos are archived below
  the engineering tenant Drive root in `未歸檔/YYYY-MM-DD/`.
- Meeting audio keeps using `會議錄音/YYYY-MM-DD/` through the existing
  large-file-safe stream path, avoiding duplicate files.
- Unsupported Notion formats such as DWG, large files, and videos stream from
  LINE directly into Drive without loading the entire file into memory.
- Notion remains the attachment metadata and relation index. A preview is added
  only when the extension and direct-upload size are supported.
- The forced policy is group/room-only and is enabled only for Engineering AM.

Previously, ordinary files depended on Notion upload success while Drive backup
was limited to images. That produced filename-only rows such as
`明義街套房cad20260812.dwg`. This package removes Notion support from the
preservation decision.

No LINE content, files, Drive IDs, Notion IDs, records, or credentials are stored
in this package. Files missed before deployment are not automatically recovered.

# AM-IMP-2026.0609.09 - Task evidence media in User UI

This upgrade makes media preservation a required User UI rule for task pages.

When a task page displays LINE conversation evidence, the User UI must also show
the images, photos, files, PDFs, videos, or attachment links that belong to the
same evidence messages when those media records are available in the project.

The rule applies to both shared AMCore templates and project-local generated User
UI pages. It does not copy live LINE media into AMCore. Each project keeps its
own messages, attachment records, media preview files, and Notion links.

Expected behavior:

- LINE conversation pages show message media as thumbnails or file links.
- Task evidence cards reuse the same message media renderer.
- Evidence media can be matched from message media, message ids, LINE message
  ids, message URLs, or project-local attachment records.
- If the media file is unavailable, the User UI still shows the source message
  metadata and media placeholder so the missing visual evidence is auditable.

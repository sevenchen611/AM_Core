# Install AM-IMP-2026.0630.02

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-30-AM-IMP-2026.0630.02.md`.

## Changes To Apply

- `listQueuedAttachments` now also reads `LINE 訊息 ID` into the attachment.
- New `appendParseBelowMessage()` + `findMessageBlockId()`: the conversation's
  image block carries the LINE message id as its `caption` (set by
  `server.js` `imageBlock(fileUploadId, messageId)`), so each attachment is
  matched to its image block by message id and the parse content is inserted
  `after` that block. Files match by attachment-page link; image-upload-failed
  text blocks match by the message id in their text. Fallback to the previous
  bottom append if no block is found (content is never lost).
- Parse content rendered as a gray callout (`🔍 圖片解析：<summary>`) plus a
  collapsible toggle `📄 圖片文字內容（OCR）` holding the full extracted text.
- Removed the unused `findConversationAnchor`. Added `calloutBlock`/`toggleBlock`.

## Environment Variables (names only)

None.

## Data Isolation Check

SevenAM Notion only. No cross-project data.

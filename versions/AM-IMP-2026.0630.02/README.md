# AM-IMP-2026.0630.02 Inline attachment parse placement

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-30-AM-IMP-2026.0630.02.md`.

## Summary

Attachment parse content is now placed **directly below its own message** in the
conversation master page, instead of being appended at the bottom of the whole
conversation. Reviewing a thread, the image's OCR/summary sits right under the
image, so you can see what each image says at a glance.

## Changes

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

## Type

Conversation UI / Attachment

## Project Status At Backfill

- HOZO AM: Installed
- 7AM: Installed

## Registry Note

Parse content (image OCR/summary, file text) is inserted directly below its own message in the conversation master (matched by LINE message id in the image block caption), not appended at the bottom. Gray callout summary + collapsible OCR toggle. Fixes a stale anchor (`LINE 對話記錄` vs `LINE】對話記錄`).

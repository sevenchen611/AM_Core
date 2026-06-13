# AM-IMP-2026.0612.10 Attachment parsing pipeline

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.10.md`.

## Summary

Images, PDFs, and Office files from LINE are parsed automatically (vision OCR / document blocks / text extraction) up to 5MB; larger files and private-conversation images require approval. Parse summaries are written to attachment pages and appended to conversation timelines so extraction can use attachment content as evidence.

## Changes

- Added scripts/parse-attachments.js (15-min cron, mammoth/xlsx/jszip for Office).
- server.js now creates attachment records for images with privacy gate; 轉檔狀態 select vocabulary registered programmatically.
- Auto-created attachment properties: 解析摘要, 解析時間.

## Type

Content intake

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Images, PDFs, and Office files from LINE are parsed automatically (vision OCR / document blocks / text extraction) up to 5MB; larger files and private-conversation images require approval

# AM-IMP-2026.0831.04 — Engineering contract LINE conversation archives

Engineering AM automatically captures the bound vendor LINE group's stored conversation interval immediately before each draft-review send and final formal issue. Each interval becomes an immutable, screenshot-style PDF with sender, time, content, message ID, media metadata, source-manifest hash, and PDF hash.

Archives are independently openable in the contract workspace and are appended to draft, issued, and signed PDFs. A management-only backfill action reconstructs existing draft intervals from the durable review `sent_at` boundaries without resending LINE messages.

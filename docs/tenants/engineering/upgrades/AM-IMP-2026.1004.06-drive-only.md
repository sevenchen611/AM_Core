# AM-IMP-2026.1004.06: engineering

Status: Deployed.

Verified production runtime commit: 129dc97cf297fb3b8b11b92de43893987e7f35dc. Contract: drive-only-line-attachments-v2. The tenant uses its existing configured Drive root and Notion attachment data source. Additive schema and production health are ready; no pending transfer, retry or migration backlog remains.

Available-source migration completed: 248 managed Notion originals moved/reused after verification; 249 saved indexes now have Drive links, SHA256 and MD5, including one explicitly synthetic 40,647,423-byte verification PDF. Notion binary references: 0. Historical records requiring re-upload: 11; these are not claimed recovered.

The storage canary used a synthetic Notion-managed original, not a real LINE webhook. Its indexed bytes, SHA256 and MD5 match the known synthetic payload and its Notion file property is empty. Root/ownership checks, source hashing and streaming integrity verification run in the production archive. LINE provider redelivery setting remains unverified because the management login is pending; this is separate from completed Drive storage configuration.

Regression: 33 attachment tests, 18 LINE I/O tests, webhook acknowledgement test, core 19 checks, direct routing 17 checks and meeting 41 checks passed, with CI green. Alignment audit retains pre-existing 113 errors and 34 warnings for unavailable standalone project paths; no standalone project alignment/deployment claim. Customer messages, originals, source record IDs, Drive roots and credentials stay outside AMCore.

# AM-IMP-2026.1004.07: engineering

Status: Deployed.

Shared Platform retrieval service uses this tenant's existing own message/attachment data sources and Google Drive root. Exact LINE quotes and complete filenames retrieve only a unique original from the current conversation. Older context-only indexes use explicit filenames; unavailable originals require re-upload. Existing sharing rights remain unchanged. Private originals stay with the original private sender. Requests are preserved as general conversation, not tasks, and reserved from transport assistants.

Reviewed PR #234 merged to main; CI passed and the production health commit and retrieval contract were verified. No customer records, original filenames, source IDs or credentials are stored here.

Local verification: 21 retrieval tests, 33 retention tests, 19 LINE I/O tests, real-server quote routing, core 19 checks and private routing 17 checks passed. Read-only production index identification was verified independently in this tenant; local Drive credentials are unavailable, so this is not a live Drive/reply claim. Alignment audit retains 113 errors and 34 warnings for unavailable standalone project paths. CI passed and the reviewed main runtime is live.

Verified production commit: e92dc4caf14c4f769c280d6969eae0187f3ec540. Verified at: 2026-10-04T07:11:14.971Z. Retrieval contract: line-quoted-drive-original-v1; delivery: google-drive-link. This tenant archive reports ready with no pending transfer/retry backlog. End-user LINE reply and recipient Google access remain explicit acceptance checks; no unsolicited production message was sent.

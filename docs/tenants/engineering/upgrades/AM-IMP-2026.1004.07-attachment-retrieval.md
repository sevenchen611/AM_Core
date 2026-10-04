# AM-IMP-2026.1004.07: engineering

Status: Installed.

Shared Platform retrieval service uses this tenant's existing own message/attachment data sources and Google Drive root. Exact LINE quotes and complete filenames retrieve only a unique original from the current conversation. Older context-only indexes use explicit filenames; unavailable originals require re-upload. Existing sharing rights remain unchanged. Private originals stay with the original private sender. Requests are preserved as general conversation, not tasks, and reserved from transport assistants.

Local regression and package verification precede deployment; production evidence will be added after reviewed main is live. No customer records, original filenames, source IDs or credentials are stored here.

Local verification: 21 retrieval tests, 33 retention tests, 19 LINE I/O tests, real-server quote routing, core 19 checks and private routing 17 checks passed. Read-only production index identification was verified independently in this tenant; local Drive credentials are unavailable, so this is not a live Drive/reply claim. Alignment audit retains 113 errors and 34 warnings for unavailable standalone project paths. CI and live main commit verification are pending.

# AM-IMP-2026.1004.06: Drive originals and Notion links

All runtime-enabled tenants preserve every authorized LINE image, document, video and recording in their own configured Google Drive root. Group, room, private member chats and authorized transport bindings share durable intake. There is no application file-size or extension cutoff for preservation. Provider limits and available Drive quota still apply; failures remain visible and retryable.

Notion is a metadata index and retry queue. It receives no new attachment binaries. Historical managed Notion originals migrate automatically: verify tenant Drive ancestry and independently hash the Notion original, reuse a matching existing Drive file or upload a verified original, then clear only that attachment's Notion binary property. Renamed files are supported. Missing originals are never claimed recovered.

Private routing requires one active tenant membership or a verified transport binding. Existing personal-assistant command authorization is unchanged. Tenant or user ambiguity fails closed. Meeting analysis reuses the canonical preserved recording.

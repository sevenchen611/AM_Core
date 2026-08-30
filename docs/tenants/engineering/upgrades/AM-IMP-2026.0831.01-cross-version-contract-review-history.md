# AM-IMP-2026.0831.01 — Engineering cross-version contract review history

Status: Deployed

Completed review responses are loaded from the existing Engineering contract review table, ordered by version and response time, and filtered so a link never reveals feedback from a later version.

The public V2 page displays V1 feedback under `歷次審閱意見`. The complete merged draft PDF dynamically appends the same history after the contract and attachments. Reviewer names, decisions, response times, and notes are included; IP addresses and user agents remain internal evidence.

PR #54 merged as `ed1e353` and Render deployed the change. Production returned the new `歷次審閱意見` section, the non-overwrite explanation, and the updated merged-PDF description with `no-store`. Existing HZ-CT-001 V1/V2 records and links require no migration or reissue; the user can reopen the existing V2 link to inspect the stored V1 response and download the PDF appendix.

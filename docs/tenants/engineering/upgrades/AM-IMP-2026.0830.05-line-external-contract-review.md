# AM-IMP-2026.0830.05 — Engineering LINE external-browser contract review

Status: Deployed

New Engineering draft-review LINE messages use LINE's documented `openExternalBrowser=1` URL parameter. The protected token remains after `#token=` and is therefore excluded from the initial HTTP request.

Legacy review messages remain valid. If LINE opens an old URL in its embedded browser, the review page detects the LINE user agent and presents a protected external-browser handoff link.

PR #50 merged as `baafe84` and Render deployed the change. Production returned HTTP 200 with `no-store` and contained both the external-browser fallback and the protected `openExternalBrowser=1#token=` link construction. Final Android/iOS handoff behavior remains controlled by the installed LINE and operating-system versions and should be confirmed from a newly issued message on each platform.

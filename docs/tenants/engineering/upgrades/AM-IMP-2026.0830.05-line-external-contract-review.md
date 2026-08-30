# AM-IMP-2026.0830.05 — Engineering LINE external-browser contract review

Status: Installed

New Engineering draft-review LINE messages use LINE's documented `openExternalBrowser=1` URL parameter. The protected token remains after `#token=` and is therefore excluded from the initial HTTP request.

Legacy review messages remain valid. If LINE opens an old URL in its embedded browser, the review page detects the LINE user agent and presents a protected external-browser handoff link.

Production deployment and device verification are pending.

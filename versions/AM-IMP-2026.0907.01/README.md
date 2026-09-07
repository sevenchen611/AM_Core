# AM-IMP-2026.0907.01 - Reliable LINE group onboarding confirmation

Engineering AM group onboarding now accepts common LINE text variations such
as surrounding quotation marks, invisible formatting characters, full-width
Latin letters, and an omitted space after `綁定`.

When a normal LINE reply token has expired or otherwise fails after the Notion
binding operation, AM Platform sends the same success or error message back to
the originating group through an idempotent push fallback. Failures are logged
instead of being silently discarded.

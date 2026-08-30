# Engineering contract inline attachment review

This package turns the public Engineering draft-review page into a complete review surface. The draft contract PDF is displayed directly on the page and dynamically includes the verified construction-drawing PDF pages and quotation PNG/JPEG pages after the contract body. Every original attachment also has its own token-protected open or download control.

Google Drive files remain private. Every request resolves the review token, rechecks expiry and review state, audits Drive privacy, downloads the immutable source, and verifies its SHA-256 hash before returning or composing content.

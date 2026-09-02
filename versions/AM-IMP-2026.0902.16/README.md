# Mobile inline contract PDF signing

The protected contract signing page now renders the frozen PDF directly inside
the same page. It no longer opens an `about:blank` child window or asks LINE's
Android WebView to display a protected Blob PDF.

Successful inline loading records a document-version-specific review marker in
the browser session and unlocks the applicable Party A or Party B consent and
submit controls. The marker survives a same-browser reload or LINE OAuth return,
but it is removed after successful signing and never contains the PDF or a
signature.

When a signer prefers an external browser, the page uses LIFF's supported
external-window API and carries the protected token only in the URL fragment.
The token remains absent from HTTP query strings, server logs, and referrers.


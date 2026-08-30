# AM-IMP-2026.0830.05 — LINE external-browser contract review links

Engineering draft-review invitations now ask LINE to open the protected review page in the phone's external browser. Existing links remain usable and receive an in-page external-browser fallback when opened inside LINE.

The opaque review token remains in the URL fragment. It is not sent to the server in the initial GET request and is still exchanged through the existing protected POST APIs.

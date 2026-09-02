# AM-IMP-2026.0902.10 - Contract LIFF login-loop recovery

The Engineering AM signing page now preserves LINE OAuth callback parameters
until `liff.init()` has consumed them. Previously the page removed the callback
query before LIFF could restore the authenticated session, which could trigger
another LINE Login redirect and eventually lose the fragment-only signing
token.

The page also permits only one automatic login redirect per fresh signing-link
open. If LINE still cannot restore the login, the page stops and tells the user
to reopen the original group message instead of entering a redirect loop.
Verified non-signing group members continue to receive read-only contract
access, while only the designated signer receives signing controls.

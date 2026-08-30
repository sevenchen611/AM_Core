# Install

1. Deploy the updated Engineering contract draft-review runtime.
2. Keep `ENG_PUBLIC_BASE_URL` unchanged.
3. No database migration or environment-variable change is required.
4. New LINE review messages will use `/contract-review?openExternalBrowser=1#token=...`.

Previously sent review links remain valid. When LINE opens one in its in-app browser, the page offers an external-browser link carrying the same fragment token.

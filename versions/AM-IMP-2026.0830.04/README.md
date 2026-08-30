# Mobile contract PDF attachment opening

This package replaces the embedded PDF iframe and blob URL on the public draft-review page with attachment-style file cards. Tapping the complete merged draft or an original attachment submits the review token in a POST form targeting a new window, so mobile browsers and LINE webviews receive the real file response directly.

The token is not placed in the query string or exposed as a Drive URL. Existing token, expiry, state, Drive privacy, and SHA-256 checks remain in force.

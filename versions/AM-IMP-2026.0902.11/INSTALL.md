# Install

1. In LINE Developers Console, identify the Messaging API channel used by the
   runtime for group delivery and member-profile lookup.
2. Select an existing published LINE Login channel under that exact provider,
   or create one there if none exists.
3. Add a Full-size LIFF app with the production contract-signing HTTPS endpoint,
   `openid` and `profile` scopes, and the add-friend option disabled.
4. Update the project-local contract LIFF environment variable with the new
   LIFF ID. Do not commit the value.
5. Rebuild and deploy the project-local runtime.
6. Keep the previous LIFF app available until the corrected production flow has
   passed verification, then retire it through the owning LINE project if the
   project owner chooses.

Do not change the Messaging API token, contract token pepper, group binding,
signer, or issued signing session as part of this correction.

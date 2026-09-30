# Verify

- Run `node --test tools/test-line-bindings.mjs tools/test-line-io.mjs tools/test-line-directory.mjs`.
- Confirm an HTTP URI action is retained in the generated Flex button and an
  HTTPS URI action remains compatible.
- Confirm credentials, unsupported schemes, oversized URIs, invalid actions,
  and foreign recipients are rejected without a LINE push.
- After a reviewed-main deployment, verify `/health` reports the deployed
  commit and `reviewCardsEnabled:true`. Use a read-only link in a test card to
  confirm LINE opens its in-app browser; do not submit or approve a UOF case.

# Verify

- Run `node --test tools/test-line-io.mjs tools/test-line-bindings.mjs tools/test-line-directory.mjs`.
- Run the SQL adapter suite and package checker in CI.
- Confirm old text sends and action confirmations retain their idempotency hashes.
- Confirm changed card text/actions conflicts, foreign recipients remain denied,
  disabled controls have no action, and invalid/oversized inputs do not push.
- Production health must report the reviewed commit and `reviewCardsEnabled:true`.
- Use a user's actual read-only query to validate the LINE rendering and navigation;
  provider acceptance alone is not proof of rendering or UOF approval.

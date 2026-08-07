# Verify

Run from the AMCore checkout:

```text
node --check modules/claims/index.js
node --check modules/personal-assistant/index.js
node tools/dryrun-claims.mjs
node tools/dryrun-personal-line-routing.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0807.01
```

Production verification:

1. Confirm `/health` reports both `personal-assistant` and `claims` as requested
   and loaded for `hozo-am-2-0`.
2. From a known allowlisted partner's one-to-one 葉小蝸 chat, tap `我要請款`.
3. Confirm LINE returns one Flex card with `開啟請款單` and states that the link
   is valid for 15 minutes.
4. Open the card and confirm LINE identity verification succeeds and the form
   shows the expected source group.
5. Stop before `確認送出請款`; this verification must not create a financial
   record.
6. Confirm an unknown, unapproved, ambiguous, or multi-source identity receives
   a fail-closed explanation instead of a form link.

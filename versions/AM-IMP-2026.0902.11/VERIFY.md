# Verify

Run:

```text
node tools/check-upgrade-package.js AM-IMP-2026.0902.11
```

Production checks:

1. Confirm the contract page embeds the new LIFF ID after deployment.
2. Open the existing group-visible signing link as a known current group member
   who is not the designated signer.
3. Confirm LINE Login completes once and the page reports verified read-only
   group membership.
4. Confirm the protected PDF control is visible and all identity/signature
   controls remain absent or disabled.
5. Confirm an account outside the bound group still fails closed.
6. Confirm no new invitation, signing event, contract transition, or group
   message was created by the verification.

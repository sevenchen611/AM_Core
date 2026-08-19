# Verify

Run locally:

```text
node --check modules/claims/index.js
node tools/dryrun-claims.mjs
node tools/dryrun-claims-governance.mjs
node tools/check-upgrade-package.js AM-IMP-2026.0819.01
node tools/audit-alignment.js
```

Production canary:

1. Open a new HOZO AM 2.0 claim form and confirm the claim type starts blank.
2. Enter `5、6、7月份電費`; verify the suggestion is `電費支出`, not water.
3. Enter an unknown description; verify submission is blocked until a category
   is selected.
4. Enter `寓見逢甲七月份工務費`; verify the suggestions are `工務費` and
   `寓見｜逢甲櫻桃`.
5. Enter `發票稅額`; verify the form shows the intercompany warning and requires
   a counterparty.
6. Submit a non-payment canary only if an item-level financial test is expressly
   authorized. Otherwise inspect the rendered form and server logs without
   creating a claim.
7. In Rental finance review, confirm the type, line category, month, business
   unit, amount, and accounting preview agree before approval.

Do not claim `Deployed` until the Rental release is live first and the current
AM production revision serves the new form.

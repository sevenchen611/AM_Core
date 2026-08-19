# AM-IMP-2026.0819.01 — Claim Line Accounting Classification V2

This package changes the claim form from a form-type-driven posting model to a
line-classification model. The claim type describes the workflow; each line's
confirmed category determines its accounting account.

The form requires a service month and a tenant-configured business unit for
every line. It offers editable suggestions for common utilities, work,
cleaning, repair, and intercompany invoice-tax wording. An unknown description
does not fall back to social insurance.

`公司間往來－代開發票稅額` means an intercompany amount awaiting settlement.
It does not assert that the claimant owns deductible input VAT. Later settlement
requires an actual transaction, agreement, and valid supporting documents.

No claim row, payment, tax filing, credential, LINE identity, or production
financial record is included in this package.

# AM-IMP-2026.0811.05 Claim bank-review source-group notice

This package extends the secured Rental claims event channel with a structured
`bank_review_approved` event. AM Platform resolves the original claim binding
and sends that binding's LINE group a fixed-format notice containing the claim
title, reviewed amount, and scheduled bank payment date when one exists.

The event cannot choose an arbitrary LINE group or provide arbitrary message
text. The receiver still resolves the exact active, claim-enabled binding in
the HOZO AM 2.0 tenant. A bank review is not a funds-release action, so the
message explicitly states that the payment has not necessarily been released
or credited.

## Status

`Ready`: implementation and local dry-run verification are complete. Mark this
package `Deployed` only after AM Platform production health confirms the claims
module is loaded from the deployed commit.

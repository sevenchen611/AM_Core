# Rollback

1. Stop the Rental `bank_review_approved` emitter first.
2. Revert this package's claims event status, safe fields, and fixed message.
3. Redeploy the previous AM Platform revision.
4. Keep all existing claim bindings, claims, audit records, and Rental outbox
   rows. Do not delete or replay financial records during rollback.

Existing claim submitted, approval, payment-processing, and paid notifications
remain unchanged.

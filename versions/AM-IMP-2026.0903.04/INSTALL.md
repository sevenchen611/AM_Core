# Install

1. Deploy the dual-party control read model and task-bridge interfaces first.
2. Review the Engineering contract database capability migration with the
   database owner. Apply the additive schema with ON_ERROR_STOP=1; do not
   update schema_meta independently of the matching runtime/store release.
3. Wire the storage adapter required by contract-payments.js:
   getContractPaymentContext, findPaymentIdempotency, createPaymentClaim,
   getPaymentClaim, recordPaymentReview, recordPaymentApproval, and
   appendPaymentEvent.
4. Map server-owned authorization to the three roles in PAYMENT_ROLES. Do not
   read actor, tenant, scope, or permissions from request JSON.
5. Mount the optional API adapter behind authenticated, CSRF-protected
   Engineering routes. Do not expose it to public signing pages.
6. Keep actual bank payment outside this module. A later finance integration
   may only record verified payment evidence after the responsible owner
   confirms it.

No live claim should be migrated, approved, scheduled, or paid by installation.

# Rollback — AM-IMP-2026.0828.01

Rollback stops new authority; it never deletes signed evidence.

## Immediate kill switch

1. Set `ENG_CONTRACTS_SIGNING_ENABLED=0` and deploy the target service.
2. Stop the contract invitation/outbox worker.
3. Keep the protected contract list and evidence download read-only if safe.
4. With an Engineering contract-admin Portal identity, call
   `POST /contracts/api/v2/signing-sessions/{sessionId}/revoke` for every
   `issued`, `sent`, or `opened` session. This emergency endpoint remains
   available while signing is disabled and records server actor, reason, and a
   signing event. Do not delete token digests or session rows.
5. A `signed` or `confirmed` session is legal evidence and cannot be revoked.
   Place it on incident/legal hold and choose either protected completion or a
   separately authorized administrative-void record; never rewrite its hash or
   signature.
6. If a token or credential may be exposed, rotate
   `ENG_CONTRACTS_TOKEN_PEPPER`, LINE/Drive/database credentials as
   appropriate, and require reissue for unfinished contracts.

## Application rollback

Deploy the last known-good runtime while keeping:

- schema `engineering_contracts`;
- every issued version and source document;
- all signing sessions and events;
- all signatures, PDFs, receipts, and hashes;
- all Notion projection fields and existing rows;
- all Drive contract folders.

The legacy `/contracts` register may remain available for read-only management,
but it must not allow a manual `已簽約` status to masquerade as electronic
signature evidence.

## Database rollback

Do not run `DROP SCHEMA`, `TRUNCATE`, `DELETE`, or a down migration in production.
The schema is additive and retaining it is the safe rollback.

For a disposable pre-production database only, the migration owner may remove
the entire database after verifying that it contains no real contract or signer
data. This is not a production rollback procedure.

## Projection rollback

Stop the Notion outbox worker and leave additive properties in place. Do not
delete project, budget, group, or contract relations. If a bad projection was
written, rebuild it from PostgreSQL after repair and append an administrative
evidence event where the correction affects a legal/status display.

## Re-enable gate

Re-enable only after:

1. the incident cause is documented;
2. affected sessions are revoked or reissued;
3. event-chain and artifact hashes verify;
4. LIFF, group membership, exact-user, project, and seven-day token checks pass;
5. pending outbox items are reconciled without duplicates;
6. the project owner approves the repaired pilot.

During rollback, record the target manifest as `Blocked` when the implementation
cannot safely operate, or `Ready` when it has been removed before installation.
Never mark rollback state as `Deployed`.

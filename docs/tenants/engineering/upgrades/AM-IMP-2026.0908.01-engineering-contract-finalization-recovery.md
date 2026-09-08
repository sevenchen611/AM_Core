# Engineering contract finalization recovery — 2026-09-08

Status: Ready

## Scope

- Keep the final PDF renderer idempotency key within its 240-character contract.
- Preserve deterministic retry from the durable `confirmed` state.
- Hide Party A assignment controls after assignment or signing is complete.
- Refresh authoritative signing state after a partial workflow failure.
- Hide the finalization action after the session reaches `completed`.

## Production evidence before repair

`HZ-CT-001` has both Party A and Party B signing evidence and has already
reached `confirmed`, but the final PDF renderer rejected the 266-character
idempotency key with HTTP 400. No signed PDF, evidence receipt, or completed
event was created. The existing signatures remain authoritative and do not need
to be repeated.

## Safety boundary

Deployment verification is read-only. Completing the existing contract is a
separate contractual production action and requires explicit user approval.
This package needs no schema migration or temporary database owner access.

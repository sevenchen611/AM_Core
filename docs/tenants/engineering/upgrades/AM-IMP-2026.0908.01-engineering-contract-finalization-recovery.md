# Engineering contract finalization recovery — 2026-09-08

Status: Deployed

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

## Deployment record

- PR: `#126`
- Production commit: `90a0505b8ef96d0fc83a88e73d8bc2ae7e184227`
- Render deploy: `dep-dafp3ps9v7es73catsjg` (`Live` on 2026-09-08)
- Production UI verification: `HZ-CT-001` shows both parties signed and the
  durable `confirmed` state as "我方已確認，待歸檔". The completed Party A
  assignment control is absent, while the only remaining action is "繼續產生最終歸檔".
- No finalization action was executed during verification, so the existing
  signatures and contract records were not changed.
- The package check, JavaScript syntax checks, `npm run check`, and all 18
  Engineering dry-run suites passed. The repository-wide alignment audit still
  reports pre-existing external project-path and historical manifest gaps.

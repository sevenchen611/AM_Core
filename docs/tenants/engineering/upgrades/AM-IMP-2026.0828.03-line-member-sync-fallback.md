# AM-IMP-2026.0828.03 — LINE member synchronization fallback

Tenant: `engineering`  
Runtime target: `AM_PLATFORM`  
Status: Deployed

## Deployment evidence

- GitHub PR: `https://github.com/sevenchen611/AM_Core/pull/35`
- Production merge commit: `8bbf2e795d019e8f1dfb613003bf37311c6c70d9`
- Production URL: `https://am.hozorental.com`
- Verified at: `2026-08-28T18:45:00+08:00`
- Render deployment reached `live` for the merge commit.
- Engineering Group Bindings V2 schema patch completed and verified 11 properties.
- The production group console reports `群組綁定 v2 已就緒`.
- Production member sync for an unverified LINE OA returns limited-mode guidance instead of a 403 failure and preserves the current member map.

## Verification completed

- `node tools/dryrun-groups.mjs` — 5/5 checks passed
- `node tools/dryrun-core.mjs` — 16/16 checks passed
- `node tools/check-upgrade-package.js AM-IMP-2026.0828.03`
- Syntax checks passed for `modules/groups/index.js`, `core/group-onboarding.js`, and `server.js`.
- Production deployment and limited-mode UI behavior were verified in the Engineering group console.

The repository-wide alignment audit still reports the pre-existing unavailable
legacy project paths under `D:\Codex_project`; those baseline errors are
unrelated to this tenant-local deployment.

## Operator action for a new group

LINE permits full group-member enumeration only for verified or premium
Official Accounts. For the current account, each member who must appear in
`成員對照` must send one message in that LINE group. AM then records the webhook
display name and stable LINE user ID automatically. Re-running the Engineering
onboarding command also records the command sender without changing the bound
project or other operational settings.

## Rollback

Follow the package `ROLLBACK.md`. Keep the additive schema and accumulated
member evidence; do not replace it with another tenant's or group's member map.

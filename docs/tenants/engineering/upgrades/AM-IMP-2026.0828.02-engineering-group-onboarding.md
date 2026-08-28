# AM-IMP-2026.0828.02 — Engineering AM LINE group self-onboarding

Tenant: `engineering`  
Runtime target: `AM_PLATFORM`  
Status: Deployed

## Deployment evidence

- GitHub PR: `https://github.com/sevenchen611/AM_Core/pull/32`
- Production merge commit: `fe132c027f9a16f10d50ccba1c5efb30b48b260a`
- Production URL: `https://am.hozorental.com`
- Verified at: `2026-08-28T18:14:31+08:00`
- Production health: `ok=true`
- Build marker: `engineering-group-onboarding-2026-08-28`
- LINE connection: configured
- Engineering runtime: enabled and authorization-ready
- Engineering Notion and group routing: configured and enabled
- Engineering modules loaded: `collect`, `meetings`, `meeting-terms`, `media`, `triage`, `queue`, `tasks`, `reminders`, `construction`, and `groups`

## Verification completed

- `node --check core/group-onboarding.js`
- `node --check server.js`
- `node tools/dryrun-core.mjs` — 15/15 checks passed
- `node tools/dryrun-groups.mjs` — 4/4 checks passed
- `node tools/check-upgrade-package.js AM-IMP-2026.0828.02`
- Production `/health` returned the new build marker from the live AM Platform service.

The clean deployment worktree's cross-project alignment audit could not resolve
the legacy local `D:\Codex_project\HOZO_AM` and `SevenAM` project paths. Those
pre-existing path and manifest errors are unrelated to this tenant-local
onboarding change; feature-specific, package, syntax, and production health
checks passed.

## Operator action

From the target LINE group, send:

```text
綁定 工程 AM 群組：<群組名稱>
```

The successful reply will direct the operator to Engineering AM's Notion
`群組綁定` data source. Select the correct `專案` relation and review
`群組角色`, `工種`, `啟用功能`, and `狀態` before relying on formal task
control.

## Rollback

Follow the package `ROLLBACK.md`. A rollback may stop new self-onboarding but
must not delete an existing tenant-local binding or its source/audit evidence.

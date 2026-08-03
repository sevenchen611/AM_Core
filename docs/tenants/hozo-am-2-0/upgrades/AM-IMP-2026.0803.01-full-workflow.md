# AM-IMP-2026.0803.01 - HOZO AM 2.0 full workflow activation

Date: 2026-08-03  
Tenant: `hozo-am-2-0`  
Status: Deployed

## Purpose

Enable HOZO AM 2.0 as a formal AM Platform tenant instead of a shadow-only intake tenant.

## Enabled capabilities

- Formal LINE group routing for active HOZO AM 2.0 bindings.
- Formal task creation through the `tasks` module.
- Reminder ticks and reminder APIs through the `reminders` module.
- Confirmation queue and task workflow surfaces through the `queue` module.
- Group administration and member sync through the `groups` module.
- Meeting record review and formal task creation through the `meetings` module.
- Operational memory switched from declared shadow mode to declared enforce mode.

## Runtime changes

- `authorizationReady=true`.
- Loaded modules now include `triage`, `queue`, `tasks`, `reminders`, and `groups`.
- `config.meetings.formalTasksEnabled=true`.
- `config.meetings.rolloutCeiling=review_and_create`.
- Meeting review identity is supplied at runtime from `HZ2_MEETINGS_LIFF_ID` or the shared fallback `AMCORE_MEETINGS_LIFF_ID`.
- New HOZO AM 2.0 LINE group onboarding defaults to:
  - `狀態=啟用`
  - `啟用功能=訊息收集, 待辦, 會議, 案件狀態, 照片, 提醒`
  - `會議待辦模式=完整確認`

## Existing group bindings

Rows created before this activation may still be shadow rows. A shadow row is intentionally clamped by meeting policy to record-only behavior, even when the tenant is fully enabled.

To activate an existing group binding, update the group binding row to:

- `狀態=啟用`
- `啟用功能=訊息收集, 待辦, 會議, 案件狀態, 照片, 提醒`
- `會議待辦模式=完整確認`

## Verification

- `node --check` passes for the edited runtime files.
- Core dry run passes.
- Task, reminder, queue, group and meeting dry runs pass.
- Production `/health` shows build `hozo20-full-workflow-2026-08-03`.
- Production `/health` shows HOZO AM 2.0 `authorizationReady=true`.
- Production `/health` shows HOZO AM 2.0 modules loaded for queue, tasks, reminders and groups.

## Rollback

To return HOZO AM 2.0 to shadow-only intake:

1. Set `authorizationReady=false`.
2. Remove `triage`, `queue`, `tasks`, `reminders`, and `groups` from the tenant module list.
3. Set `config.meetings.formalTasksEnabled=false`.
4. Remove `config.meetings.rolloutCeiling`.
5. Set HOZO AM 2.0 onboarding defaults back to `狀態=影子記錄` and limited capabilities.

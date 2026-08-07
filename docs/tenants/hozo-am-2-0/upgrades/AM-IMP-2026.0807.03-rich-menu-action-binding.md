# AM-IMP-2026.0807.03 Rich Menu action binding

Date: 2026-08-07

Status: Installed

Scope:

- Calendar direct commands now accept the current Rich Menu button labels:
  `我的今日`, `我的行事曆`, `新增待辦`, and `昨日未完成`.
- Personal assistant now accepts `身份設定` and `身分設定` as identity-status entry points.
- Claims keeps ownership of `我要請款`.
- The package includes a non-secret LINE Rich Menu action contract and optional apply script.

Verification:

- `node tools/dryrun-calendar-line-operations.mjs`
- `node tools/dryrun-personal-line-routing.mjs`
- `node versions/AM-IMP-2026.0807.03/scripts/apply-rich-menu-actions.mjs versions/AM-IMP-2026.0807.03/config/hozo-rich-menu-actions-v1.json`

Production note:

Live LINE Rich Menu API application requires the project-local
`LINE_CHANNEL_ACCESS_TOKEN`. No token was present in the local Codex workspace, so
this record is not marked `Deployed`.

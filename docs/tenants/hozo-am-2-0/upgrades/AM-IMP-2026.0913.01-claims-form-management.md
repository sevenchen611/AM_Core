# AM-IMP-2026.0913.01 — Claims form management catalog

Status: `Installed`

## Installed scope

- Added 「請款功能工具」 to the protected `/claims-authority` console.
- Added the 「請款單管理」 navigation button.
- Unified the page heading and browser title as 「請款功能管理」.
- Added a server-configured 「返回財務後台」 link.
- Added a read-only, legacy-to-current inventory of three LIFF modes and one V3
  standard form.
- Kept group/member authorization, source binding, feature gates, and finance
  records unchanged.

## Verification

- `node --check core/claims-authority-admin.js`
- `node tools/dryrun-claims-authority-admin.mjs`
- `node tools/check-upgrade-package.js AM-IMP-2026.0913.01`

Production merge, deployment, and UI canary are not part of this local install.

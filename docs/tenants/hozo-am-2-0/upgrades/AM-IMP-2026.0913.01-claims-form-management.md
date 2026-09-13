# AM-IMP-2026.0913.01 — Claims form management catalog

Status: `Deployed` (2026-09-13)

## Deployed scope

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

## Production verification

- GitHub PR `#144` merged to `main` as `b3c25b7`.
- The protected production page loaded with both its browser title and H1 set to
  「請款功能管理」.
- 「請款單管理」 displayed exactly the three legacy LIFF modes and the V3
  standard form.
- 「返回財務後台」 navigated successfully to
  `https://rental.hozorental.com/admin-finance.html`.

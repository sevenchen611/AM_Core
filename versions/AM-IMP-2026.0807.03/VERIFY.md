# Verify

1. Run `node tools/dryrun-calendar-line-operations.mjs`.
2. Run `node tools/dryrun-personal-line-routing.mjs`.
3. Run `node versions/AM-IMP-2026.0807.03/scripts/apply-rich-menu-actions.mjs versions/AM-IMP-2026.0807.03/config/hozo-rich-menu-actions-v1.json` and confirm the dry-run output lists six areas.
4. After deployment, tap each Rich Menu button from a bound HOZO AM 2.0 direct LINE user.
5. Confirm `新增待辦` only replies with examples and creates nothing until a dated command is confirmed.
6. Confirm `我的行事曆` returns the weekly list and does not mention an unsupported monthly view.
7. Confirm `我要請款` still returns the signed claims card.
8. Confirm `身份設定` returns identity status and clearly says notification settings are not open yet.


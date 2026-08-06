# AM-IMP-2026.0806.01 - Claims shortcut card

Date: 2026-08-06  
Tenant: `hozo-am-2-0`  
Status: Deployed

## Purpose

Make the HOZO AM 2.0 claims entry easier to use from LINE groups by returning a visible button card instead of only a plain LIFF URL.

## Behavior

- Supported group commands:
  - `請款`
  - `我要請款`
  - `請款按鈕`
  - `開啟請款`
  - `#請款 <草稿內容>`
- Eligible groups receive a LINE Flex card with a primary `開啟請款單` URI button.
- The same message also includes a quick-reply URI button for clients that surface quick replies prominently.
- Draft commands still create a signed short-lived session and open the same LIFF form with the draft text attached.

## Safety Boundaries

- This does not create a permanent LINE group-level button. LINE quick replies are message-scoped, and rich menus are account/user scoped rather than group-scoped.
- The button still uses the existing signed LIFF session.
- The session remains valid for 15 minutes and is restricted to the original LINE submitter.
- Group eligibility still requires:
  - Active group binding.
  - `請款` capability.
  - A submitter LINE user ID listed in the group binding allowlist.
  - Runtime claims LIFF and Rental integration settings.

## Verification

- `node --check core/line.js`
- `node --check modules/claims/index.js`
- `node tools/dryrun-claims.mjs`
- `node tools/dryrun-claims-governance.mjs`
- `node tools/verify-line-push-timeout.mjs`

## Rollback

Revert the Flex-card response in `modules/claims/index.js` to the previous plain-text LIFF URL response. Keep the claims governance and LIFF integration settings intact unless the claim feature itself must be disabled.

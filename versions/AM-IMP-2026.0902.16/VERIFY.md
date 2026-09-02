# Verify

- Run every script listed in `upgrade.json.requiresScripts`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.16`.
- Confirm the protected page contains no `window.open('about:blank')` or Blob
  navigation flow.
- Confirm both PDF.js module assets return JavaScript from the same origin with
  immutable cache headers and `Cross-Origin-Resource-Policy: same-origin`.
- On Android LINE, open the existing protected signing link and load the PDF in
  the same page. Confirm every page is visible and the applicable consent box
  becomes enabled only after loading succeeds.
- Confirm reload/back restores the reviewed state only for the same signing
  session and frozen document hash.
- Confirm **在外部瀏覽器開啟簽署頁** opens a complete fragment-token URL and
  does not produce **簽署連結不完整**.
- Confirm Party A and Party B controls remain role-restricted and non-signers
  remain read-only.
- Production verification must not submit a real signature, send LINE content,
  or change a contract unless the project owner separately authorizes it.


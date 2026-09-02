# Verify

- Run every script listed in `upgrade.json.requiresScripts`.
- Run `node tools/check-upgrade-package.js AM-IMP-2026.0902.17`.
- Confirm the original issued PDF is downloaded and SHA-256 verified before any
  staged PDF is rendered.
- Confirm the Party A signature file hash, byte size, MIME type, session,
  contract version, profile type, frozen bundle hash, and timestamp are checked.
- Confirm an existing session with Party A signed serves a PDF containing
  **甲方個人簽名**, **甲方已簽署／乙方待簽**, and the Party A signature hash.
- Confirm the Party B signature box remains visibly pending.
- Confirm the staged PDF does not replace `documentRef` or `documentHash` and
  cannot be labeled as the final dual-party completion PDF.
- Confirm Party B sees the staged-PDF explanation before signing.
- Production verification may open the protected document read-only but must
  not submit or repeat a signature, send LINE content, or change contract state.


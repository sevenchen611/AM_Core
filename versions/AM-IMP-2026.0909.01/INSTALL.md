# Install

1. Apply the module change to the AM Platform repository that serves
   `am.hozorental.com`; do not install it in the deprecated standalone HOZO
   webhook sender.
2. Keep the existing Rental machine credential. Do not add a caller-controlled
   LINE group id or user id setting.
3. In the HOZO AM 2.0 group-binding data source, verify exactly one binding is
   canonically named `HOZO 財務群組`, its canonical `LINE 群組 ID` property has
   exactly one `C` plus 32 hexadecimal rich-text value, and its `成員對照`
   rich-text field contains one exact reviewer-name mapping.
4. Update Rental to create one stable `sourceNotificationId` per notification
   event in the exact form `bank-draft-notification:v1:<UUID>`. Reuse it only
   for an identical replay; distinct events require distinct ids even if their
   text matches. Send it with `mentionName` and the required source-and-content-
   bound `retryKey` described in the module README. Consider a notification delivered
   only when the HTTP response is exactly 200 and contains `ok: true`,
   `mention.resolved: true`, and `mention.delivered: true`.
5. Run the verification commands in `VERIFY.md` before merge or deployment.

Do not paste group bindings, member mappings, LINE targets, or secret values
into source control, test output, PR text, or deployment notes.

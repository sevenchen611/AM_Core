# Install

Install only in the OA webhook runtime requested by the owner. Use the existing channel's LINE adapter; do not copy another project's tokens, bindings or data. Wire `createWorkJournalEntry` before pause/UOF/calendar/task intake, after validating the entire webhook signature and event array. Handle only the claimed journal events after the acknowledgement, and leave the other events on their existing routes.

For AM Platform, merge reviewed code to GitHub main before deployment. There are no schema/environment or Rich Menu changes. Check the active menu's `工作日誌` URI action with the target channel's own credentials, outside the shared repository. Production health must expose `workJournalEntry.contract=line-work-journal-rich-menu-entry-v1` while the personal assistant stays paused and the existing calendar/UOF contracts remain present.

Run the package, navigation and webhook regression checks documented in VERIFY.md. Store production receipts outside AMCore and mark the target manifest Deployed only after live main/health verification. Legacy HOZO/Seven runtimes are not automatically changed by this package.

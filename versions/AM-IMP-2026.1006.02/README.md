# Silent fallback for private assistant text

Status: Ready. Target: AM Platform tenants with the personal-assistant module enabled.

Previously, any unrecognized private text received the same capabilities guide. The guide lived in `responseFor()` in `modules/personal-assistant/index.js`; `onDirectMessage()` called it after command matching failed.

Unrecognized private text now finishes without a reply, task creation or task update. It remains handled so `core/direct-line.js` does not send its own fallback. Explicit identity queries and existing task, calendar and claims commands keep their current routing. This supports conversation control by avoiding misleading command responses to ordinary conversation.

No LINE Official Account setting, schema, environment variable or project data change is required. The tenant's `personalAssistant.enabled` setting enables the whole assistant and should remain enabled when only cancelling the repetitive guide.

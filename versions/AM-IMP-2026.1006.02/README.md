# Pause the entire one-to-one private assistant

Status: Ready. Target: root AM Platform one-to-one LINE user events.

The fixed capabilities guide originates in `responseFor()` in `modules/personal-assistant/index.js`. The requested final behavior is to pause the entire private assistant, including supported commands and identity/fallback replies.

`PERSONAL_ASSISTANT_ENABLED=false` in `core/direct-line.js` is the platform pause switch. The signed webhook excludes one-to-one user events before transport intake, finance, attachment archive/retrieval, identity lookup or module dispatch. Direct route callers also stop before lookup. Text, binary messages, follow/unfollow and postbacks receive no assistant reply. Group and room events retain their existing routes, including transport-managed personal groups. Existing records are retained. This prevents private control commands from running while the assistant is paused.

`/health` exposes `personalAssistant.enabled=false` and contract `private-assistant-pause-v1`. No LINE Official Account setting, schema, environment variable or tenant record change is required. Resume requires changing the platform switch to true in a reviewed main deployment; existing tenant-level enablement still applies.

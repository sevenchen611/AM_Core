# Pause the entire one-to-one private assistant

Status: Ready. Target: root AM Platform one-to-one LINE user events.

The fixed capabilities guide originates in `responseFor()` in `modules/personal-assistant/index.js`. The requested final behavior is to pause the entire private assistant, including supported commands and identity/fallback replies.

`PERSONAL_ASSISTANT_ENABLED=false` in `core/direct-line.js` is the platform pause switch. The signed webhook excludes AM one-to-one user events before transport intake, finance, attachment archive/retrieval, identity lookup or module dispatch. Private-only requests return HTTP 200 without running intake. Direct route callers also stop before lookup. Text, binary messages, follow/unfollow and AM postbacks receive no assistant reply. Group/room events and explicitly owned independent LINE IO transport (including the UOF direct pilot) retain their existing routes. Only events already owned by that separate transport bypass the pause; command text alone cannot bypass it. Existing records are retained.

`/health` exposes `personalAssistant.enabled=false` and contract `private-assistant-pause-v1`. No LINE Official Account setting, schema, environment variable or tenant record change is required. Resume requires changing the platform switch to true in a reviewed main deployment; existing tenant-level enablement still applies.

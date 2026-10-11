# Calendar creation with confirmed timing

Status: Deployed in the root AM Platform runtime, verified 2026-10-11. Reviewed PR #283 passed full CI and main `44ae19cbfa82a0d6f41fdcf75eff2dd8e0aace42` is healthy on both production origins.

Calendar creation requires a valid, unambiguous date/start time and a valid end or disclosed duration. Venue, title and content are optional. Preserve approximate venue text; leave absent venue/content empty and use 活動 when a title is absent. Optional questions appear as red, nonblocking notes. Only temporal questions prevent confirmation. The shared DailyLog API already accepts empty location/content.

Dated, timed text can enter extraction without a venue or title. Extraction rejects background, recaps and cancellation. Existing trusted owner identity, direct-chat scope, tenant RLS, exact revision, explicit confirmation and immutable retry request remain unchanged.

The versioned card refresh moves legacy optional blockers into notes without re-extracting source or changing its time. A separate, explicit single-draft operator action can requeue the original owner's completed confirmation control when it was rejected solely for optional details. It requires unchanged current/prompted revision, active unconfirmed draft, matching sender/fingerprint and original postback, no queued confirmation and no time blocker. The normal worker rechecks identity and performs the write; no synthetic confirmation is created.

Raw production records and identifiers stay on the target host. Standalone HOZO_AM and SevenAM adoption remains separate.

19 calendar and 14 central archive tests passed with private-assistant pause, syntax, package and whitespace checks. LINE's non-sending validation returned HTTP 200 for a card with optional vague venue and absent title/content. One specifically requested prior owner click passed the guarded dry run and was requeued once. The normal worker successfully saved the Google event; read-only evidence confirms original owner confirmation, unchanged venue text, cleared optional blockers and provider-accepted success notification with completed archival. No remaining active legacy cards require refresh in the configured target. Tenant enrollment is unchanged. The legacy standalone audit retains 113 pre-existing errors, including missing configured checkout paths; standalone alignment/deployment is not claimed.

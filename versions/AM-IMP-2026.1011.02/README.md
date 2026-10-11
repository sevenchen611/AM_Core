# Calendar creation with confirmed timing

Status: Installed in the root AM Platform runtime; production verification pending.

Calendar creation requires a valid, unambiguous date/start time and a valid end or disclosed duration. Venue, title and content are optional. Preserve approximate venue text; leave absent venue/content empty and use 活動 when a title is absent. Optional questions appear as red, nonblocking notes. Only temporal questions prevent confirmation. The shared DailyLog API already accepts empty location/content.

Dated, timed text can enter extraction without a venue or title. Extraction rejects background, recaps and cancellation. Existing trusted owner identity, direct-chat scope, tenant RLS, exact revision, explicit confirmation and immutable retry request remain unchanged.

The versioned card refresh moves legacy optional blockers into notes without re-extracting source or changing its time. A separate, explicit single-draft operator action can requeue the original owner's completed confirmation control when it was rejected solely for optional details. It requires unchanged current/prompted revision, active unconfirmed draft, matching sender/fingerprint and original postback, no queued confirmation and no time blocker. The normal worker rechecks identity and performs the write; no synthetic confirmation is created.

Raw production records and identifiers stay on the target host. Standalone HOZO_AM and SevenAM adoption remains separate.

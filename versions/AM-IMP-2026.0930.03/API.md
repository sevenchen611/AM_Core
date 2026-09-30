# API contract

`POST /api/v1/line/replies` accepts the existing scoped bearer key and a JSON
body containing `eventId`, `groupId`, `notifyUserId`, `text`, and optionally
`cards`, `actions`, or `includeText:true` with `cards`. The event must be a
captured message/postback from that exact authorized group member. The gateway
never returns the reply token. Success returns `status:accepted`, `method:reply`,
and `eventId`; a repeated identical request returns `replayed:true` without a
new LINE message. `reply_token_expired`, `reply_payload_changed`, and
`reply_outcome_unknown` are terminal for that event. A new user interaction
provides a new event and a new reply opportunity.

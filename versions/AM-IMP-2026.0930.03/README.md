# One-use LINE replies for UOF interactions

Status: Ready. Adds an opt-in `/api/v1/line/replies` endpoint to the existing
personal LINE transport. A webhook's reply token is encrypted with a key derived
from the existing channel secret and retained only at the gateway. The UOF
backend refers to the event ID and can deliver up to five message objects in one
Reply API request. Accepted, uncertain, and expired reply events never fall back
to a quota-consuming Push automatically. Daily and other proactive reports keep
using the existing messages API.

The sealed token is kept in a private field of the existing LINE event row;
the event feed always strips that field. No database migration is required.
The endpoint is enabled with `AMCORE_LINE_IO_REPLY_ENABLED=1`. The existing scoped UOF transport key and
`messages:write` permission remain in use; no new LINE key is needed.

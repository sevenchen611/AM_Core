# LINE activity confirmation → DailyLog Google Calendar

Package status: Ready. End-user activation requires a valid production DailyLog calendar key and a one-time LINE pairing.

Verified one-to-one LINE text about a dated meeting or activity is extracted into activity name, Taiwan date/time, location and main content. The assistant shows a confirmation card. Only the bound owner can confirm; incomplete or ambiguous data needs clarification and edits require a new preview. Confirmation creates an event through DailyLog's dedicated `/api/integrations/leaf-snail/calendar/events` API, using the exact calendar fixed by that user's key. An omitted end time defaults to one hour and is disclosed in the preview.

Private drafts, original source, supplements, confirmation evidence, immutable request IDs, frozen API JSON, leases and results are durable in tenant-local PostgreSQL. Restart, repeated buttons and uncertain timeouts do not regenerate the approved JSON or create a new identifier. Forced RLS separates tenants; every action query additionally checks the LINE owner. Ordinary private chats remain quiet and the general AM private assistant remains paused. Independent UOF transport and groups retain their existing routes.

API keys are accepted only by a purpose-specific authenticated setup endpoint, encrypted at rest with AES-GCM and tenant-associated data, and never sent to AI or printed. A ten-minute single-use code lets the human bind the key to their own signed LINE identity. Changing keys invalidates older drafts. Channel-secret rotation requires re-pairing. The setup authorization and encryption keys are separately derived from the existing channel secret using distinct purposes; no broad Portal credential is exposed.

Scope: text messages, single-instance timed activities, up to five separate activities per message. The supplied API does not support all-day/recurring entries, attendees or modifying/deleting saved Google events. No Google event is created by installation or enrollment validation.

# AM-IMP-2026.1006.02 — Pause entire one-to-one private assistant

Status: Ready. Production deployment pending.

`PERSONAL_ASSISTANT_ENABLED=false` in `core/direct-line.js` pauses all one-to-one LINE user events before transport/finance/attachment intake, identity lookup and module dispatch. The assistant sends no identity, task, claims or default replies while paused.

Group/room routing and explicitly owned independent LINE IO transport (including UOF direct commands) remain active. Existing tenant settings and records remain available for resumption. No database, environment or tenant configuration change is needed. Verification is recorded in the shared package's VERIFY.md; production status requires the deployed reviewed main revision and `/health` pause contract/state.

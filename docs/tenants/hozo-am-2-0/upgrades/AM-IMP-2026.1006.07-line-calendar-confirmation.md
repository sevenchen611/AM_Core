# AM-IMP-2026.1006.07 — LINE activity confirmation

Status: Ready. The runtime extracts four activity fields and asks the owner before creating an event through DailyLog. One shared encrypted service key is installed by the administrator. The actor account comes only from the existing verified UOF direct LINE binding, revalidated before execution; individual calendar keys are not required. Existing DailyLog Google authorization and selected calendar are reused.

Local tests cover confirmation, owner and tenant isolation, account override protection, stale edits, expiry, immutable retries, restart, lease fencing, shared key encryption and signed webhook ACK ordering. Production schema/main rollout and shared configuration verification remain pending. No calendar entry is created during installation/auth validation. Follow shared INSTALL/VERIFY/ROLLBACK; records and secrets remain tenant-local. Legacy standalone HOZO/Seven projects are not changed by this platform rollout.

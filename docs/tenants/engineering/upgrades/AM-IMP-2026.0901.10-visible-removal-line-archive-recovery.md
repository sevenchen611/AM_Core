# AM-IMP-2026.0901.10 - Visible attachment removal and LINE archive recovery

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Deployed

The V5 workspace contained all expected attachment-exclusion buttons, but desktop CSS left them transparent until a precise hover. The controls are now permanently visible, larger, and keyboard-focused clearly.

HZ-CT-001 has three sent draft reviews and zero LINE archives because those sends occurred before archive activation. The workspace now reports this gap and exposes a prominent one-time backfill action. The existing idempotent service partitions V1, V2, and V3 using their recorded send times and does not resend any LINE message.

Production evidence: PR #82 introduced the visible controls and archive recovery callout; PR #83 fixed the zero-count display. Commit `bd019ef966ee7f3a071159441bb5d2a143d4c4f4` reached Live as Render deploy `dep-dabe46gu01pc73ees0g0`. Authenticated V5 verification found eight visible 24px red × controls, the exact 3-sent/0-archive status, and the green three-version backfill action. No attachment exclusion or archive backfill was executed during verification.

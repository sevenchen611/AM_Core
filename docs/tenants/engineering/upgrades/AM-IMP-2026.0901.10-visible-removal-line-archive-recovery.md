# AM-IMP-2026.0901.10 - Visible attachment removal and LINE archive recovery

Tenant: `engineering`

Runtime target: `AM_PLATFORM`

Status: Installed

The V5 workspace contained all expected attachment-exclusion buttons, but desktop CSS left them transparent until a precise hover. The controls are now permanently visible, larger, and keyboard-focused clearly.

HZ-CT-001 has three sent draft reviews and zero LINE archives because those sends occurred before archive activation. The workspace now reports this gap and exposes a prominent one-time backfill action. The existing idempotent service partitions V1, V2, and V3 using their recorded send times and does not resend any LINE message. Production deployment and user-authorized backfill remain pending.

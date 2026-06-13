# SevenAM Two-Way Google Calendar Sync And Invite Confirmation

**Version:** `AM-IMP-2026.0613.05`
**Status:** Proposed (design stage)
**Install target:** `SEVEN_AM` only. **HOZO_AM: not in scope** by request.

> This is a **SevenAM-specific** feature. It is recorded in AMCore as the design
> standard so it can be ported to other AM projects later if needed, but it must
> not be installed into HOZO_AM unless explicitly requested. It follows the same
> SevenAM-only pattern as `AM-IMP-2026.0608.20` (08:00 Calendar agenda).

## Goal

Make the controller's Google Calendar (their Gmail calendar) the single place
they see and get reminded about everything SevenAM tracks:

1. **Project schedule sync** — SevenAM project deadlines, checkpoints, and
   "must-confirm-by" time points become calendar events with reminders.
2. **LINE invitation capture** — meetings, appointments, friend/event invites
   that appear in the controller's LINE conversations are detected.
3. **Auto-create with confirmation gate**:
   - (a) If an invitation was discussed in a group **and** the controller
     accepted it, SevenAM creates the calendar event automatically.
   - (b) If acceptance is uncertain, SevenAM does **not** create the event yet;
     it asks the controller in preset reminder windows, and only creates the
     event once accepted (or auto-expires if the time passes with no answer).

## Builds On (do not duplicate)

- `AM-IMP-2026.0608.20` — read-only 08:00 Calendar agenda (event JSON input).
  This feature upgrades that from passive JSON to a live, two-way connection.
- `AM-IMP-2026.0612.02` — LLM conversation→task extraction. The same timeline
  pass also emits **calendar candidates** (a new output type).
- `AM-IMP-2026.0612.14` — Planned messages / Next Action 15-min scheduler with
  dead-man-switch reminder semantics. The confirmation chase reuses this engine
  rather than inventing a second scheduler.
- `AM-IMP-2026.0612.12` — controller-only command gate. Only the controller's
  own acceptance counts; group members cannot confirm on their behalf.

## Data Model (SevenAM-local Notion: a new "行事曆事件" data source)

| Field | Purpose |
| --- | --- |
| `標題` | Event title (人物/主題, no technical IDs — per 0608.15). |
| `開始時間` / `結束時間` | Event datetime; all-day allowed. |
| `地點` | Location or meeting link. |
| `來源` | `專案排程` or `LINE邀約`. |
| `關聯任務` / `關聯專案` | Relation to the total-control task/project that spawned it. |
| `來源對話` | Link to the LINE 對話主檔 thread (evidence). |
| `確認狀態` | `已接受` / `待確認` / `已婉拒` / `已過期`. |
| `Google事件ID` | The created Google Calendar event id (for update/delete). |
| `下次確認時間` | One-shot timer for the next confirmation window (reuses 0612.14 semantics). |
| `提醒設定` | Reminder offsets written to the calendar event. |

Calendar event **content** lives in SevenAM's own Notion + the controller's own
Google Calendar. AMCore stores only this schema/standard, never event data.

## Confirmation State Machine

```
detected (LINE invite or project checkpoint)
   │
   ├─ acceptance explicit by controller ──────────────► 已接受 ──► create Google event (+reminders)
   │
   └─ acceptance uncertain ──► 待確認 ──► chase in reminder windows
                                   │  (each window: SevenAM asks the controller,
                                   │   one-shot 下次確認時間, dead-man-switch)
                                   ├─ controller says yes ──► 已接受 ──► create event
                                   ├─ controller says no  ──► 已婉拒 ──► no event
                                   └─ event start time passes, still no answer ──► 已過期 ──► no event, log only
```

Project schedule items (deadlines/checkpoints) that the controller already owns
are treated as `已接受` directly — they are the controller's own commitments,
not third-party invites.

## Default Reminder / Confirmation Windows (proposed — confirm before build)

- **Confirmation chase** (for `待確認` invites): at detection, then **T-24h** and
  **T-3h** before the event start; stop at start time → `已過期`.
- **Event reminders** (written onto the created Google event): **T-1 day** and
  **T-30 min** (popup).

These are defaults; the controller can override per event.

## Acceptance Detection Policy

An invitation is `已接受` only when the **controller** (Seven 陳聖文) gives an
explicit accept in their own conversation/control channel — e.g. 「好」「OK」
「我會到」「可以」 in direct reply to that invite thread. Group members'
messages, or the controller merely reading the invite, never count as acceptance
(reuses the controller-only gate from `AM-IMP-2026.0612.12`). Ambiguous replies
(「再看看」「可能」) stay `待確認`.

## Google Calendar Connection (the one blocking decision)

SevenAM is a Node service. Writing events needs Google Calendar API write access
to the controller's calendar. This is the only part that cannot be defaulted —
it requires the controller's Google authorization. Candidate approaches:

1. **OAuth refresh token (recommended for an autonomous service)** — the
   controller authorizes once via a consent screen; SevenAM stores a refresh
   token as a Render secret and creates/updates events 24/7 without Claude.
2. **Service account + calendar share** — a Google service account the
   controller shares their calendar with; no consent screen, but Workspace-only
   nuances and the service account "owns" created events.
3. **Claude-assisted (no service write)** — SevenAM only *proposes*; event
   creation happens through Claude's Calendar tool when the controller runs a
   session. Simplest, but not autonomous.

Whichever is chosen, secrets stay in SevenAM's own environment; AMCore and other
projects never receive them.

## Data Isolation

- Uses only SevenAM's own LINE channel, Notion workspace, Render service, and the
  controller's own Google account.
- No Google tokens, event data, or calendar IDs are stored in AMCore or copied
  from/to HOZO_AM.

## Locked Decisions (2026-06-13)

1. **Connection approach: OAuth refresh token.** The controller authorizes once;
   SevenAM stores the refresh token as its own Render secret and writes events
   autonomously 24/7. (Approach 1 above.)
2. **Target calendar: a dedicated "SevenAM" calendar**, created via the API on
   first run; never the controller's primary calendar. Auto-events stay isolated
   from personal entries and can be toggled off as one calendar.
3. **Windows: proposed defaults accepted.**
   - Confirmation chase (待確認 invites): at detection, **T-24h**, **T-3h**;
     past start with no answer → `已過期`.
   - Event reminders on created events: **T-1 day** and **T-30 min** (popup).
4. **Project sync scope: explicit-date items AND soft "should-confirm-by"
   checkpoints.** Items without a firm time become `待確認` checkpoints that are
   chased in the same windows until a time is set or they expire.

### Required SevenAM environment variables (names only)

```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN
SEVEN_CALENDAR_ID            (filled after first-run calendar creation)
```

The controller creates a Google Cloud OAuth client (Calendar API enabled) once
and runs the one-time auth helper to mint the refresh token. No Google secret is
ever stored in AMCore or shared with HOZO_AM.

## Definition Of Done (when built into SevenAM)

- SevenAM holds a live, authorized two-way Google Calendar connection (writes).
- The LLM extraction pass emits calendar candidates from LINE threads.
- Accepted invites and owned project checkpoints create Google events with reminders.
- Uncertain invites are chased in the configured windows and only created on accept.
- SevenAM Notion records every event with confirmation state and source evidence.
- HOZO_AM is untouched; AMCore stores only this standard, no event data.

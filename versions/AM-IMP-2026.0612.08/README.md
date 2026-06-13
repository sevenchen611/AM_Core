# AM-IMP-2026.0612.08 Dynamic task review pages

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.08.md`.

## Summary

Daily and follow-up report pages are server-rendered from live Notion data with six sections: extraction verdicts, waiting-reply chase (send/edit/snooze 1-7d), in-progress status+notes, unclassified project assignment, attachment approval, and project proposals. Submissions extend /control/reports/approve; decided items disappear on reload.

## Changes

- Added src/report-pages.js; control-api serves dynamic pages with static-prototype fallback.
- Approve API: followupSends, snoozes, taskNotes, projectAssigns, attachmentDecisions, projectProposalDecisions.
- Dismissals no longer set 確認狀態=已確認 (calibration corruption fix); chase sends auto-snooze 2 days; notes carry report-source labels and feed 最新備註 for AI context.
- Auto-created task properties: 追蹤暫緩至, 最新備註.

## Type

Reporting / UI

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Daily and follow-up report pages are server-rendered from live Notion data with six sections: extraction verdicts, waiting-reply chase (send/edit/snooze 1-7d), in-progress status+notes, unclassified project assignment, attachment approval, and project proposals

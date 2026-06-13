# AM-IMP-2026.0612.16 Case-separation judgment standard

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.16.md`.

## Summary

Case-separation judgment standard: when one LINE conversation or meeting discusses multiple distinct properties/owners/cases, each case gets its own tasks, each task's evidence/summary/next-step quotes only messages directly relevant to that case, and different cases belong to different projects. Cross-case messages may be quoted in both tasks with an explicit cross-case note.

## Changes

- Active rule in `Seven 判斷規則庫` (Applies To: SEVEN_AM, user-directed 2026-06-12): 「同一對話討論多個案件時，任務與證據必須按案件分開」.
- Applied retroactively: 仁美/大甲旅館投資評估案 split out of 溪頭 / 南投鹿谷旅館投資評估案 as a new official project; two Renmei tasks moved with parent-child relation intact and move notes appended.
- Rule injected into every extraction run via the existing Active-rules loader.

## Type

Governance / Judgment rule

## Project Status At Backfill

- HOZO AM: Proposed
- 7AM: Deployed

## Registry Note

One conversation discussing multiple properties/owners yields separate tasks per case; evidence quotes only case-relevant messages; cases live in their own projects.

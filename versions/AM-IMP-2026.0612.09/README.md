# AM-IMP-2026.0612.09 Project governance and proposals

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-12-AM-IMP-2026.0612.09.md`.

## Summary

Controlled project vocabulary: extraction only uses official projects (schema enum) or 未分類; AI never invents project names. A daily proposal engine watches unclassified clusters, unassigned groups, and parent tasks with 3+ children, creating candidate projects (狀態=候選, 啟用=false) that require user approval before entering the vocabulary.

## Changes

- Extraction and report pages load official projects excluding 候選/封存.
- Added scripts/propose-projects.js with conservative LLM proposal (max 3) and LINE notification.
- Review page section 六 with approve (規劃中+啟用) / reject (封存).
- render.yaml seven-jr-project-proposals cron (22:20 Taipei).

## Type

Governance

## Project Status At Backfill

- HOZO AM: Installed (deploy pending)
- 7AM: Deployed

## Registry Note

Controlled project vocabulary: extraction only uses official projects (schema enum) or 未分類; AI never invents project names

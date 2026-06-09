# Current Version Matrix

This file records the current visible version state from the project manifests and shared registry on 2026-06-08.

Editable control table:

- [AM_VERSION_CONTROL_TABLE.md](AM_VERSION_CONTROL_TABLE.md)
- [AM_VERSION_CONTROL_TABLE.xlsx](AM_VERSION_CONTROL_TABLE.xlsx)

| Version | Improvement | HOZO AM | 7AM | Integration Note |
| --- | --- | --- | --- | --- |
| `AM-IMP-2026.0608.01` | Project data isolation guard | Installed | Deployed | HOZO Render verification still appears pending. |
| `AM-IMP-2026.0608.02` | Scheduled report multi-recipient rule | Installed | Deployed | HOZO Render verification still appears pending. |
| `AM-IMP-2026.0608.03` | LINE task-query reply command | Installed | Installed | HOZO deploy pending; 7AM live command test still needs confirmation. |
| `AM-IMP-2026.0608.04` | Cron report deployment verification | Proposed | Proposed | Should become a real upgrade package before either project installs it. |
| `AM-IMP-2026.0608.05` | Improvement manifest and upgrade records | Installed | Installed | Governance baseline exists in both projects. |
| `AM-IMP-2026.0608.06` | Event-conclusion daily report and follow-up task synthesis | Installed | Installed | Package should preserve scripts and verification steps before future rollout. |
| `AM-IMP-2026.0608.07` | Five-slot goal recognition and confirmation workflow | Installed | Installed | Both projects now have local records; production deploy verification remains separate. |
| `AM-IMP-2026.0608.08` | Hierarchical responsibility owner narrowing workflow | Installed | Installed | Must be converted into a complete package with database schemas and scripts. |
| `AM-IMP-2026.0608.09` | Immediate LINE command conversation mode | Installed | Deployed | HOZO has local install; production deploy verification remains pending. |
| `AM-IMP-2026.0608.10` | Notion database view layout registry | Installed | Installed | LINE group options Default view layout is defined in AMCore and applied to both project-local Notion databases. |
| `AM-IMP-2026.0608.11` | Report intervention action standard | Ready | Ready | AMCore package is ready; install separately into each project's report UI and Notion decision fields before marking Installed. |
| `AM-IMP-2026.0608.13` | Judgment calibration knowledge base | Ready | Installed | 7AM has project-local calibration databases and can send task reviews to `Seven 陳聖文`; HOZO AM not yet installed. |
| `AM-IMP-2026.0608.14` | Meeting checkbox task standard | Ready | Ready | AMCore package is ready; install separately into each project's meeting sync so checkbox items enter task tracking without extra confirmation. |
| `AM-IMP-2026.0608.15` | Total-control task title hygiene | Installed | Installed | Removes Notion/LINE technical IDs from task titles; SevenAM cleaned 45 existing titles and HOZO AM had no matching titles to clean. |
| `AM-IMP-2026.0608.16` | Project dossier and task relation architecture | Installed | Installed | Adds formal `總控專案` task relation and reciprocal `關聯任務` project relation; project pages become case dossiers with process evidence in the body. |
| `AM-IMP-2026.0608.17` | Task dossier and subtask hierarchy architecture | Installed | Installed | Adds `母任務` / `子任務` self-relations in each project-local task database; task pages become execution dossiers with child tasks, source evidence, files, and completion gates. |
| `AM-IMP-2026.0608.19` | Total-control task table source text hide rule | Installed | Installed | Hides `來源原文` from total-control task table headers while keeping the property and existing evidence available. |
| `AM-IMP-2026.0608.20` | SevenAM 08:00 Google Calendar agenda section | 未列入 | Installed | SevenAM-only report upgrade; HOZO AM intentionally not installed. |

## Immediate Integration Priorities

1. Convert `AM-IMP-2026.0608.08` into a complete upgrade package because it requires databases, scripts, and schema.
2. Convert `AM-IMP-2026.0608.06` into a package because it affects reporting behavior and follow-up task creation.
3. Convert `AM-IMP-2026.0608.09` into a package before installing into HOZO_AM.
4. Turn `AM-IMP-2026.0608.04` from `Proposed` into a real package, because deployment verification is needed by both projects.
5. Install `AM-IMP-2026.0608.11` into HOZO_AM and SevenAM report candidates so controller decisions can be recorded with the same action keys.
6. Install `AM-IMP-2026.0608.13` into HOZO_AM and SevenAM when the controller is ready to receive judgment review tasks in LINE.
7. Install `AM-IMP-2026.0608.14` into HOZO_AM and SevenAM meeting sync when each project is ready to treat meeting checkboxes as confirmed tasks.
8. Backfill `AM-IMP-2026.0608.16` relations for historical tasks by matching legacy project select values to project records.
9. Backfill `AM-IMP-2026.0608.17` parent-child task hierarchy for active multi-step tasks, keeping unrelated sibling tasks under the project relation.

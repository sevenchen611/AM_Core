# AM-IMP-2026.0608.14 Meeting Checkbox Task Standard

This package standardizes how AM-style projects recognize tasks in meeting records.

If a meeting record contains a checkbox item, the text after the checkbox is a confirmed task and should be added directly to project-local task tracking.

## What This Package Defines

- Checkbox items in meeting records are explicit meeting tasks.
- Checkbox tasks do not need extra confirmation before entering task tracking.
- Keyword-based action detection remains available for non-checkbox meeting lines.
- Notion to-do blocks and Markdown checkbox lines are both accepted.
- Project-local duplicate checks should use meeting reference plus task text.
- AMCore stores only the shared rule and reference behavior, not live meeting or task data.

## Applies To

- HOZO_AM
- SEVEN_AM
- Future AM projects with meeting-record task sync

## Install Status

This package is ready to install separately into each project. Do not mark a project as `Installed` until its own meeting sync path has been updated and verified.

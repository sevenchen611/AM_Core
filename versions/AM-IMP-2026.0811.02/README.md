# AM-IMP-2026.0811.02 Multi-Space Work Item Creation

This package extends engineering dashboard work-item creation so one operation
can target multiple spaces in the selected project.

The work-item form provides individual space checkboxes plus `全選所有空間` and
`清除選取`. The server validates every selected space before writing and then
creates one tenant-local Notion Work Item per space. This preserves independent
status tracking and keeps the existing Gantt and space-by-trade matrix model.
Gantt labels include the related space so repeated work-item names remain clear.

Existing work items with the same name and space are skipped, so a retry after a
partial Notion failure safely continues with the remaining spaces. Single-space
API payloads remain supported for backward compatibility.

## Status

`Ready`: implementation and mock verification are complete. Mark this package
`Deployed` only after the AM Platform Render service and live dashboard UI are
verified.

# AM-IMP-2026.0811.04 Editable Engineering Gantt Items

This package makes both the work-item label and time bar in the engineering
dashboard Gantt chart clickable.

Clicking either surface opens an editor for the Work Item name, planned start,
planned end, and status. Saving writes the changes to the tenant-local Notion
Work Item page, appends an audit note, and refreshes the project Gantt and
space-by-trade matrix.

The server revalidates project scope, Work Items data-source ownership, and the
Work Item-to-project relation before every edit. A rename that would duplicate
another Work Item in the same space is rejected.

## Status

`Ready`: implementation and mock verification are complete. Mark this package
`Deployed` only after the AM Platform Render service and live edit modal are
verified.

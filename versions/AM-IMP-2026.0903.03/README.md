# Engineering contract action-task bridge

This package turns one actionable Engineering contract control state into one deterministic, reviewable task intent. It closes the gap between a control page saying what must happen and a project-local task system carrying the accountable follow-up.

The bridge is pure code. It does not write Notion, send LINE, or mutate a production task. A project-local adapter must explicitly apply the returned intent after tenant authorization and owner review.

## Controls

- The same tenant, project, contract and action use the same semantic key.
- The same semantic key plus unchanged authoritative state is deduplicated.
- A formal intent requires both a project-goal link and at least one project-local contract evidence reference.
- Missing goal or evidence produces a candidate pending confirmation, never a silent formal task.
- Each create or update instruction contains status-change evidence and applied-rule trace.
- Contractual actions remain owner-confirmation-sensitive; this package does not close a task.

No contract records, signing tokens, LINE identities, Notion database IDs, or production credentials are included.

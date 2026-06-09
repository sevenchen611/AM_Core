# Verify

Verify separately in each project.

## Documentation Checks

- Project `AGENTS.md` describes the 08:00-22:00 hourly LINE check as task
  reconciliation.
- The description says the core decision is whether a new message extends an
  existing task or creates a new event.
- The description requires checking same-group conversation context before task
  creation.
- The description requires searching active total-control tasks before creating
  a new task.

## Config Checks

- `config/hourly-line-task-reconciliation.json` exists in the project.
- The JSON parses successfully.
- The schedule window is 08:00 through 22:00.
- The decision outputs include existing-task update, new-event task, and no-task
  background/duplicate outcomes.

## Data Boundary Checks

- The config does not contain project messages.
- The config does not contain task records.
- The config does not contain Notion data source IDs.
- The config does not contain LINE IDs, tokens, or Render secrets.


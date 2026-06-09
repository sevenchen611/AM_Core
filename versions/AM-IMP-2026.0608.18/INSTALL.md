# Install

Install separately in each AM-style project.

## Steps

1. Copy `config/hourly-line-task-reconciliation.json` into the project-local
   `config/` folder.
2. Update the project-local `AGENTS.md` scheduled/hourly section to state that
   the hourly LINE judgement job must perform task reconciliation.
3. Confirm the project's hourly LINE judgement cron runs between 08:00 and
   22:00 in the project timezone.
4. Do not copy LINE messages, total-control task records, customer data,
   Notion IDs, Render values, or secrets into AMCore.

## Expected Runtime Behavior

The existing judgement script may continue to run, but its intended behavior is
now defined as:

```text
new message -> same conversation context -> related active tasks -> update existing task or create new event task
```

Creating a task directly from a single message should be the fallback, not the
default path.


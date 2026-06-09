# Rollback

This package is a governance/specification package.

To roll back in a project:

1. Remove or ignore `config/hourly-line-task-reconciliation.json`.
2. Revert the project-local `AGENTS.md` paragraph that points hourly LINE
   judgement at the reconciliation contract.
3. Keep raw LINE messages and task records untouched.
4. Do not delete tasks merely because this spec is rolled back.


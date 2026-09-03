# Rollback — AM-IMP-2026.0903.03

Remove the caller integration or roll back the application release to stop producing new task intents. Preserve every already-created project-local task, its contract evidence, and the recorded idempotency keys.

Do not delete source evidence or rewrite task history merely because this bridge is disabled. Existing contractual tasks still require project-owner confirmation under the project-local workflow.

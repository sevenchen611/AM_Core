# Rollback

1. Revert the Engineering AM entry and supported example in `core/group-onboarding.js`.
2. Restore the previous `GROUP_ONBOARDING_BUILD` value and deploy the prior AM Platform revision.
3. Re-run the core dry run and confirm the other supported tenant commands still work.

Rollback stops new Engineering AM self-onboarding commands. It must not delete existing tenant-local group bindings, LINE records, messages, meetings, tasks, project relations, or credentials.

If a group created during this rollout must stop routing, change that Engineering AM binding's status to `停用` in the engineering tenant's own Group Bindings data source. Preserve the row and its audit evidence unless the project owner separately approves deletion.

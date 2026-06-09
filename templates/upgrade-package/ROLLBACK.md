# Rollback

Describe how to safely disable or undo this version.

Rollback must not affect another project.

## Steps

1. Disable new behavior if feature flag exists.
2. Revert code changes if needed.
3. Keep newly created Notion databases unless user explicitly requests cleanup.
4. Document rollback result in the project upgrade record.


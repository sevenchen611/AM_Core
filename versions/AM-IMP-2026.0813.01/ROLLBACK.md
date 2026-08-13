# Rollback

Rollback is non-destructive.

1. Remove `task-control` from the affected tenant's enabled module list and
   deploy the runtime.
2. Keep all task fields, task event blocks, completed statuses, keywords, and
   LINE-source evidence intact.
3. Do not delete Notion fields or historical task updates as part of rollback.
4. Record the reason in the target tenant's upgrade record and change its
   manifest status to `Blocked` or `Ready` as appropriate.

The normal task read/write path continues to work after this module is disabled;
only interactive LINE task-control actions stop.

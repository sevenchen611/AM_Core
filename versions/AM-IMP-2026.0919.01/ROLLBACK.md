# Rollback

Revert the release commit and redeploy the previous reviewed `main` commit. This removes the drawing picker and its API while leaving existing direct uploads and all previously saved contract versions untouched.

Do not delete Phase 1 drawing records, Drive files, contract versions or source evidence. No schema rollback is required because this package adds no database objects.

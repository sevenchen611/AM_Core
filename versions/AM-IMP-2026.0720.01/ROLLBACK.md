# Rollback

1. Revert the target project runtime to the prior `modules/meetings/index.js`.
2. Redeploy the project service.
3. Pending review links will stop working after rollback.
4. Meeting records already created remain valid.
5. Formal tasks already created by finalized or skipped reviews should not be deleted unless the project owner explicitly requests cleanup.

Rollback restores the previous behavior: meeting todos are written to the formal task database immediately after meeting-record generation.

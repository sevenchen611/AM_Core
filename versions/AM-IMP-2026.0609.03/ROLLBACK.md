# Rollback

Rollback is display-only and does not erase project data.

To roll back:

1. Restore the previous project-local `scripts/build-user-ui-connected-preview.js`, if the project had one.
2. Restore the previous AMCore generator from version control or backup.
3. Regenerate the User UI pages.
4. Mark the project manifest status as `Deprecated` or `Blocked` for this version.

Do not delete Notion task evidence, LINE messages, meeting records, or attachments.


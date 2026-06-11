# Rollback

Rollback is project-local.

1. Revert only the child project's User UI generator changes for this package.
2. Regenerate the child project's User UI pages.
3. Keep all project data, Notion records, LINE messages, and meeting pages
   untouched.
4. Update the project-local manifest and upgrade note to mark this package as
   rolled back.

Do not roll back by deleting meeting tasks or meeting records. This package only
controls how task-page evidence is classified and displayed.

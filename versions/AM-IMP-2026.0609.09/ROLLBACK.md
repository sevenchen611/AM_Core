# Rollback

Rollback is documentation-only unless a project changed its generator after this
package.

To roll back:

1. Remove the task evidence media section from `docs/USER_UI_ARCHITECTURE.md`.
2. Remove this package's manifest rows and project-local upgrade notes.
3. Keep project-local media and attachment records unchanged.

Do not delete live LINE media, attachment records, task records, or generated
User UI pages unless the project owner explicitly requests it.

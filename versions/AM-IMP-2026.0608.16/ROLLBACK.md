# Rollback

If the relation architecture causes problems:

1. Stop writing new values to `總控專案`.
2. Continue using the legacy `專案` select temporarily.
3. Do not delete `總控專案` or `關聯任務` until project-local records have been reviewed.
4. Remove dossier body templates only from pages where they were incorrectly applied.
5. Update the project manifest to `Blocked` if the project cannot safely migrate yet.

Rollback must not delete source conversations, attachments, project records, or task records.

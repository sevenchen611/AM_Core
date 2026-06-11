# Rollback

1. Remove the manual rule form from the project-local User UI generator.
2. Remove `POST /control/judgment-rules/create` from the project-local control API.
3. Regenerate the User UI.
4. Update the project manifest entry from `Installed` to the chosen status.

Existing project-local judgment rule records should not be deleted automatically. Review them manually if a mistaken rule was created.


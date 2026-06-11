# Install

1. Update the project-local User UI generator so the `任務判斷規則` page renders the manual rule form after the rule groups.
2. Update the project-local control API with `POST /control/judgment-rules/create`.
3. Configure the project-local judgment rules data source environment variable:
   - `SEVEN_JUDGMENT_RULES_DATA_SOURCE_ID` for SevenAM.
   - `HOZO_JUDGMENT_RULES_DATA_SOURCE_ID` for HOZO AM.
4. Configure project-local User UI credentials:
   - `SEVEN_USER_UI_USERNAME` and `SEVEN_USER_UI_PASSWORD`.
   - `HOZO_USER_UI_USERNAME` and `HOZO_USER_UI_PASSWORD`.
5. Regenerate the project User UI.
6. Update the project-local `docs/project-improvement-manifest.md`.
7. Add a project-local upgrade record under `docs/upgrades/`.

Do not copy judgment rule records between projects.


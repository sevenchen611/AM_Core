# Install

Install this package separately in each project.

1. Open the project-local `reports/followup-confirmation-prototype.html`.
2. Add the `today-completed` and `active-tasks` sections before the follow-up decision sections.
3. Add read-only render support for `completedTasks` and `activeTasks`.
4. Remove any `確認規則` navigation link and section from the report UI.
5. Keep any functional goal-confirmation controls only if the project already writes those choices back.
6. Update the project-local `docs/project-improvement-manifest.md`.
7. Add a project-local upgrade record under `docs/upgrades/`.

Do not copy completed tasks, active tasks, candidate messages, LINE content, Notion page IDs, or secrets from one project to another.


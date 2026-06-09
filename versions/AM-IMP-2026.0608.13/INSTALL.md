# Install

Install this package separately in HOZO AM and 7AM.

## 1. Create Project-Local Databases

Create these Notion databases inside the target project's own workspace:

- Judgment calibration cases
- Judgment rules

Use the schema template:

```text
D:\Codex_project\AM_Core\versions\AM-IMP-2026.0608.13\notion-schemas\judgment-calibration-databases.json
```

Store the resulting data source IDs only in the target project environment.

## 2. Configure Project-Local Environment

Use project-specific values only.

For HOZO AM, use HOZO-prefixed values such as:

```text
HOZO_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID=
HOZO_JUDGMENT_RULES_DATA_SOURCE_ID=
HOZO_CONTROL_API_KEY=
CONTROL_LINE_PUSH_URL=
```

For 7AM, use SEVEN-prefixed values such as:

```text
SEVEN_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID=
SEVEN_JUDGMENT_RULES_DATA_SOURCE_ID=
SEVEN_CONTROL_API_KEY=
CONTROL_LINE_PUSH_URL=
```

Do not store these values in AMCore.

## 3. Select Review Candidates

Add a project-local workflow that selects tasks for review when they are uncertain, high-risk, cross-project, repeated, or likely to be misclassified.

The workflow should produce one review message per task or a small batch of up to five tasks.

## 4. Send Review Messages To LINE

Use the existing project-local LINE push path, such as:

```text
npm run line:push -- <user|group|room> <project-local-target-id> "<message>"
```

Build messages with:

```text
D:\Codex_project\AM_Core\versions\AM-IMP-2026.0608.13\templates\line-review-message-template.md
```

The target ID must come from the project's own LINE group options or environment.

## 4A. Enable LINE Command Mode

Register project-local command words in the LINE webhook:

```text
Seven Junior，我們開始做任務校準
Seven Junior，任務校準暫停
Seven Junior，任務校準狀態
```

The start command should send the next task only when calibration is active and no older review item is waiting for reply.

Each outgoing review item must include:

```text
【判斷校準】{current}/{total}
已校準：{completed}｜尚未校準：{remaining}
```

When the controller replies to an active review item, the project should update the case, update the source task, extract a rule when possible, and then send the next item. When paused, controller messages should not automatically trigger another item.

## 5. Capture Controller Replies

When the controller replies in LINE:

1. Link the reply to the review ID.
2. Update the source task with the controller direction.
3. Create or update a calibration case.
4. Draft a generalized judgment rule when the case teaches a reusable pattern.

Use these templates:

```text
D:\Codex_project\AM_Core\versions\AM-IMP-2026.0608.13\templates\judgment-case-template.md
D:\Codex_project\AM_Core\versions\AM-IMP-2026.0608.13\templates\judgment-rule-template.md
```

## 6. Update Project Records

After installation in each project:

1. Update `docs/project-improvement-manifest.md`.
2. Create a project-local record under `docs/upgrades/`.
3. Mark status `Installed` only after local verification passes.
4. Mark status `Deployed` only after production LINE and Notion behavior has been verified.

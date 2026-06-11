# Install

Install this package separately into each AM project.

## Shared AMCore

1. Update the AM User UI source-evidence rule so meeting-derived tasks are
   treated as meeting evidence before LINE evidence fallback.
2. Update the meeting checkbox task standard so meeting checkbox tasks retain
   the meeting page as their task-page source.
3. Keep this package and verifier in AMCore for future child-project installs.

## Required Generator Behavior

The connected User UI generator must:

1. Load meeting records with page id, name, date, Notion URL, summary, and body
   content preview.
2. Detect meeting-derived tasks from `meeting-checkbox`, `meeting-action`, or
   `同步識別碼：meeting:<meetingPageId>:<itemId>`.
3. Render the task source block as:
   - `資料來源：會議記錄`
   - `關聯頁面：<source meeting Notion URL>`
   - `會議：<meeting name>`
   - `會議日期：<meeting date>`
   - `會議記錄內文：<useful meeting body excerpt>`
4. Preserve `行動項目`, `來源標記`, and `同步識別碼`.
5. Use LINE conversation source wording only for LINE-derived tasks.

## HOZO AM

1. Apply the generator behavior to HOZO AM's project-local User UI generator.
2. Regenerate HOZO AM User UI pages.
3. Verify a meeting-checkbox task page no longer shows
   `來源對話群組：LINE 對話群組`.
4. Update the HOZO AM project manifest and create a project-local upgrade note.

## SevenAM

1. Apply the same generator behavior to SevenAM's project-local User UI
   generator.
2. Regenerate SevenAM User UI pages.
3. Verify a meeting-checkbox task page no longer shows
   `來源對話群組：LINE 對話群組`.
4. Update the SevenAM project manifest and create a project-local upgrade note.

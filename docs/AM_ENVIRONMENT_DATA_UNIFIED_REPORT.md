# AM EnvironmentData Unified Report

Generated: 2026/6/9 下午11:01:43

This report merges SevenAM and HOZO AM EnvironmentData keys into one AMCore canonical field list. Secret values are masked.

欄位規則：`**必填**` 表示此欄位是 AM 標準運作必要欄位，必須有值。

## Summary

| Item | Count |
| --- | ---: |
| Unified AM fields | 46 |
| Required AM fields | 29 |
| SevenAM required fields missing or empty | 1 |
| HOZO AM required fields missing or empty | 2 |
| SevenAM missing fields | 11 |
| HOZO AM missing fields | 5 |
| SevenAM empty values | 4 |
| HOZO AM empty values | 2 |

## Unified AM EnvironmentData

| Type | Required | AM field | SevenAM key | Seven status | HOZO AM key | HOZO status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Credential | **必填** | **`PROJECT_USER_UI_PASSWORD`** | `SEVEN_USER_UI_PASSWORD` | 有值 |  | 缺欄位 | HOZO AM 必填欄位需補值。 |
| Credential | **必填** | **`PROJECT_USER_UI_USERNAME`** | `SEVEN_USER_UI_USERNAME` | 有值 |  | 缺欄位 | HOZO AM 必填欄位需補值。 |
| Secret | **必填** | **`LINE_CHANNEL_ACCESS_TOKEN`** | `LINE_CHANNEL_ACCESS_TOKEN` | 有值 | `LINE_CHANNEL_ACCESS_TOKEN` | 有值 | 一致 |
| Secret | **必填** | **`LINE_CHANNEL_SECRET`** | `LINE_CHANNEL_SECRET` | 有值 | `LINE_CHANNEL_SECRET` | 有值 | 一致 |
| Secret | **必填** | **`NOTION_TOKEN`** | `NOTION_TOKEN` | 有值 | `NOTION_TOKEN` | 有值 | 一致 |
| Secret | **必填** | **`PROJECT_CONTROL_API_KEY`** | `SEVEN_CONTROL_API_KEY` | 有值 | `HOZO_CONTROL_API_KEY` | 有值 | 一致 |
| Secret | 選用 | `PROJECT_REPORT_APPROVAL_KEY` |  | 缺欄位 | `HOZO_REPORT_APPROVAL_KEY` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Notion ID | **必填** | **`PROJECT_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID`** | `SEVEN_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` | 有值 | `HOZO_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_ATTACHMENTS_DATA_SOURCE_ID`** | `SEVEN_ATTACHMENTS_DATA_SOURCE_ID` | 有值 | `HOZO_ATTACHMENTS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_CODEX_COMMANDS_DATA_SOURCE_ID`** | `SEVEN_CODEX_COMMANDS_DATA_SOURCE_ID` | 有值 | `HOZO_CODEX_COMMANDS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_CONVERSATIONS_DATA_SOURCE_ID`** | `SEVEN_CONVERSATIONS_DATA_SOURCE_ID` | 有值 | `HOZO_CONVERSATIONS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID`** | `SEVEN_DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID` | 有值 | `HOZO_DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID`** | `SEVEN_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID` | 有值 | `HOZO_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_JUDGMENT_RULES_DATA_SOURCE_ID`** | `SEVEN_JUDGMENT_RULES_DATA_SOURCE_ID` | 有值 | `HOZO_JUDGMENT_RULES_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_LINE_GROUP_MEMBERS_DATA_SOURCE_ID`** | `SEVEN_LINE_GROUP_MEMBERS_DATA_SOURCE_ID` | 有值 | `HOZO_LINE_GROUP_MEMBERS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_LINE_GROUP_OPTIONS_DATA_SOURCE_ID`** | `SEVEN_LINE_GROUP_OPTIONS_DATA_SOURCE_ID` | 有值 | `HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_MEETINGS_DATA_SOURCE_ID`** | `SEVEN_MEETINGS_DATA_SOURCE_ID` | 有值 | `HOZO_MEETINGS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_MESSAGES_DATA_SOURCE_ID`** | `SEVEN_MESSAGES_DATA_SOURCE_ID` | 有值 | `HOZO_MESSAGES_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_PROGRESS_REPORTS_DATA_SOURCE_ID`** | `SEVEN_PROGRESS_REPORTS_DATA_SOURCE_ID` | 有值 | `HOZO_PROGRESS_REPORTS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_PROJECTS_DATA_SOURCE_ID`** | `SEVEN_PROJECTS_DATA_SOURCE_ID` | 有值 | `HOZO_PROJECTS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_RESPONSIBILITY_DATA_SOURCE_ID`** | `SEVEN_RESPONSIBILITY_DATA_SOURCE_ID` | 有值 | `HOZO_RESPONSIBILITY_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | **必填** | **`PROJECT_TASKS_DATA_SOURCE_ID`** | `SEVEN_TASKS_DATA_SOURCE_ID` | 有值 | `HOZO_TASKS_DATA_SOURCE_ID` | 有值 | 一致 |
| Notion ID | 選用 | `NOTION_CONTAINER_PAGE_ID` |  | 缺欄位 | `NOTION_CONTAINER_PAGE_ID` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Notion ID | 選用 | `PROJECT_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` |  | 缺欄位 | `HOZO_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Notion ID | 選用 | `PROJECT_DATA_SOURCE_PARENT_BLOCK_ID` |  | 缺欄位 | `HOZO_DATA_SOURCE_PARENT_BLOCK_ID` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Notion ID | 選用 | `PROJECT_DATA_SOURCE_PARENT_PAGE_ID` |  | 缺欄位 | `HOZO_DATA_SOURCE_PARENT_PAGE_ID` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Notion ID | 選用 | `PROJECT_RISK_DECISIONS_DATA_SOURCE_ID` |  | 缺欄位 | `HOZO_RISK_DECISIONS_DATA_SOURCE_ID` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Database ID | 選用 | `CONTROL_LINE_EVENTS_DATABASE_ID` | `CONTROL_LINE_EVENTS_DATABASE_ID` | 有值 |  | 缺欄位 | HOZO AM 未使用此欄位時可保留空白模板。 |
| LINE | **必填** | **`LINE_CHANNEL_ID`** | `LINE_CHANNEL_ID` | 有值 | `LINE_CHANNEL_ID` | 有值 | 一致 |
| LINE | 選用 | `CONTROL_LINE_PUSH_URL` | `CONTROL_LINE_PUSH_URL` | 有值 | `CONTROL_LINE_PUSH_URL` | 有值 | 一致 |
| Report | **必填** | **`PROJECT_REPORT_TARGET_ID`** | `SEVEN_REPORT_TARGET_ID` | 有值 | `HOZO_REPORT_TARGET_ID` | 有值 | 一致 |
| Report | **必填** | **`PROJECT_REPORT_TARGET_NAME_KEYWORD`** | `SEVEN_REPORT_TARGET_NAME_KEYWORD` | 有值 | `HOZO_REPORT_TARGET_NAME_KEYWORD` | 有值 | 一致 |
| Report | **必填** | **`PROJECT_REPORT_TARGET_TYPE`** | `SEVEN_REPORT_TARGET_TYPE` | 有值 | `HOZO_REPORT_TARGET_TYPE` | 有值 | 一致 |
| Report | 選用 | `CRON_JOB_NAME` | `CRON_JOB_NAME` | 空值 |  | 缺欄位 | HOZO AM 未使用此欄位時可保留空白模板。 選用欄位存在但目前空值。 |
| Report | 選用 | `DAILY_REPORT_URL` | `DAILY_REPORT_URL` | 空值 | `DAILY_REPORT_URL` | 空值 | 選用欄位存在但目前空值。 |
| Report | 選用 | `FOLLOWUP_CONFIRMATION_URL` | `FOLLOWUP_CONFIRMATION_URL` | 空值 |  | 缺欄位 | HOZO AM 未使用此欄位時可保留空白模板。 選用欄位存在但目前空值。 |
| Report | 選用 | `MORNING_BRIEF_URL` | `MORNING_BRIEF_URL` | 空值 | `MORNING_BRIEF_URL` | 空值 | 選用欄位存在但目前空值。 |
| Report | 選用 | `PROJECT_CRON_ALERTS_ENABLED` | `SEVEN_CRON_ALERTS_ENABLED` | 有值 | `HOZO_CRON_ALERTS_ENABLED` | 有值 | 一致 |
| Report | 選用 | `PROJECT_REPORT_CC_NAME_KEYWORDS` |  | 缺欄位 | `HOZO_REPORT_CC_NAME_KEYWORDS` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| URL | **必填** | **`PROJECT_PUBLIC_BASE_URL`** | `SEVEN_PUBLIC_BASE_URL` | 有值 | `HOZO_PUBLIC_BASE_URL` | 有值 | 一致 |
| URL | 選用 | `CONTROL_API_URL` |  | 缺欄位 | `CONTROL_API_URL` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Runtime | **必填** | **`PORT`** | `PORT` | 有值 | `PORT` | 有值 | 一致 |
| Config | **必填** | **`NOTION_VERSION`** |  | 缺欄位 | `NOTION_VERSION` | 有值 | SevenAM 必填欄位需補值。 |
| Config | **必填** | **`PROJECT_JUDGMENT_REVIEW_TARGET_NAME_KEYWORD`** | `SEVEN_JUDGMENT_REVIEW_TARGET_NAME_KEYWORD` | 有值 | `HOZO_JUDGMENT_REVIEW_TARGET_NAME_KEYWORD` | 有值 | 一致 |
| Config | 選用 | `PROJECT_CODEX_COMMAND_TRIGGERS` |  | 缺欄位 | `HOZO_CODEX_COMMAND_TRIGGERS` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |
| Config | 選用 | `PROJECT_OUTGOING_ACTOR_NAME` |  | 缺欄位 | `HOZO_OUTGOING_ACTOR_NAME` | 有值 | SevenAM 未使用此欄位時可保留空白模板。 |

## Value Snapshot (masked)

| Required | AM field | SevenAM value | HOZO AM value |
| --- | --- | --- | --- |
| **必填** | **`PROJECT_USER_UI_PASSWORD`** | •••••••••••••••• |  |
| **必填** | **`PROJECT_USER_UI_USERNAME`** | Seven |  |
| **必填** | **`LINE_CHANNEL_ACCESS_TOKEN`** | •••••••••••••••• | •••••••••••••••• |
| **必填** | **`LINE_CHANNEL_SECRET`** | •••••••••••••••• | •••••••••••••••• |
| **必填** | **`NOTION_TOKEN`** | •••••••••••••••• | •••••••••••••••• |
| **必填** | **`PROJECT_CONTROL_API_KEY`** | •••••••••••••••• | •••••••••••••••• |
| 選用 | `PROJECT_REPORT_APPROVAL_KEY` |  | •••••••••••••••• |
| **必填** | **`PROJECT_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID`** | 727d16ff-9ef0-47ed-a83d-bbfd3bf4fb1b | 4ce26dc1-0b90-49ad-8e96-73f3a8f23a1f |
| **必填** | **`PROJECT_ATTACHMENTS_DATA_SOURCE_ID`** | 623a3d80-d00c-4076-b3b4-a5ee153641d5 | 37551c68-6dac-81bb-97de-000bebacea77 |
| **必填** | **`PROJECT_CODEX_COMMANDS_DATA_SOURCE_ID`** | c4eee8de-e596-4d64-906b-1405d79e721c | 6a500d4c-43ae-4523-bd76-c19a80697bb3 |
| **必填** | **`PROJECT_CONVERSATIONS_DATA_SOURCE_ID`** | edd151eb-587d-4b70-a1a9-525e6b9af78d | 37451c68-6dac-8163-b4fa-000b17271536 |
| **必填** | **`PROJECT_DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID`** | 8f7f95a5-7428-4490-9327-7943499a0e22 | 607884fd-afa2-4ddc-8319-70daeb31c549 |
| **必填** | **`PROJECT_JUDGMENT_CALIBRATION_CASES_DATA_SOURCE_ID`** | 9714e599-5677-4071-afe4-3e577e1c412e | d46acd97-f0c1-41ee-b046-a6982a025616 |
| **必填** | **`PROJECT_JUDGMENT_RULES_DATA_SOURCE_ID`** | 5dc0f7d1-7776-4724-8104-6b3e131dd972 | 9cf2b88d-8d13-4cea-a477-88d12b34674b |
| **必填** | **`PROJECT_LINE_GROUP_MEMBERS_DATA_SOURCE_ID`** | 979949aa-bac3-45ac-a4cc-a38585addb89 | 685ddbd8-a7da-42a3-b526-07f335c1bb9e |
| **必填** | **`PROJECT_LINE_GROUP_OPTIONS_DATA_SOURCE_ID`** | b6cfffbf-e7b2-4da4-b21d-d055bc68af69 | bdab58cf-be1f-4e10-85bd-3ab1b9d5e527 |
| **必填** | **`PROJECT_MEETINGS_DATA_SOURCE_ID`** | fd551c68-6dac-830d-81bf-879f0a9582ba | fd351c68-6dac-8298-8f0e-87ab1eb6027c |
| **必填** | **`PROJECT_MESSAGES_DATA_SOURCE_ID`** | 63758b44-f3c4-4215-8c6e-208f7a492bf0 | 37451c68-6dac-8187-a6bc-000bbd69c364 |
| **必填** | **`PROJECT_PROGRESS_REPORTS_DATA_SOURCE_ID`** | fc5e4e21-6af6-4de2-9380-aa95126ee13e | add70895-645c-4268-9763-3e4bcb2b5b95 |
| **必填** | **`PROJECT_PROJECTS_DATA_SOURCE_ID`** | 2d4e4e80-09e6-447f-b2e2-36269ff1ac5c | 6395278e-53e8-4b47-917a-36d88802324e |
| **必填** | **`PROJECT_RESPONSIBILITY_DATA_SOURCE_ID`** | e8c2f582-edbe-42ab-9d7f-ba063bbf8b99 | 5d06662d-47a6-49d2-86dd-f2f59d497077 |
| **必填** | **`PROJECT_TASKS_DATA_SOURCE_ID`** | 0bdc0de5-46ee-482c-b8d7-cdf6ec958467 | 9c9e34ff-45af-4543-a3ae-11c5cd432b36 |
| 選用 | `NOTION_CONTAINER_PAGE_ID` |  | 35d51c686dac802c81e6c71b560c0498 |
| 選用 | `PROJECT_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` |  | 5f7a870d-5a34-44a2-b1c8-a17171b6353a |
| 選用 | `PROJECT_DATA_SOURCE_PARENT_BLOCK_ID` |  | 35f51c68-6dac-805f-88b4-e1cf5a86bbc1 |
| 選用 | `PROJECT_DATA_SOURCE_PARENT_PAGE_ID` |  | 35d51c68-6dac-802c-81e6-c71b560c0498 |
| 選用 | `PROJECT_RISK_DECISIONS_DATA_SOURCE_ID` |  | 1f6ef6e0-3f5f-49fb-8b80-add787898d7d |
| 選用 | `CONTROL_LINE_EVENTS_DATABASE_ID` | d88eaaf7-07af-4370-95e4-17ec45db0baf |  |
| **必填** | **`LINE_CHANNEL_ID`** | 2010309641 | 2009385650 |
| 選用 | `CONTROL_LINE_PUSH_URL` | https://line-oa-webhook-nn5j.onrender.com/control/line/push | https://hozo-am-line-oa-webhook.onrender.com/control/line/push |
| **必填** | **`PROJECT_REPORT_TARGET_ID`** | U09dc6553016c78d89c515522be9b74f6 | U480627aaad7650bdd40117714fa69bc1 |
| **必填** | **`PROJECT_REPORT_TARGET_NAME_KEYWORD`** | Seven | Maggie |
| **必填** | **`PROJECT_REPORT_TARGET_TYPE`** | user | user |
| 選用 | `CRON_JOB_NAME` | (空值) |  |
| 選用 | `DAILY_REPORT_URL` | (空值) | (空值) |
| 選用 | `FOLLOWUP_CONFIRMATION_URL` | (空值) |  |
| 選用 | `MORNING_BRIEF_URL` | (空值) | (空值) |
| 選用 | `PROJECT_CRON_ALERTS_ENABLED` | true | true |
| 選用 | `PROJECT_REPORT_CC_NAME_KEYWORDS` |  | Seven陳聖文,Seven 陳聖文 |
| **必填** | **`PROJECT_PUBLIC_BASE_URL`** | https://line-oa-webhook-nn5j.onrender.com | https://hozo-am-line-oa-webhook.onrender.com |
| 選用 | `CONTROL_API_URL` |  | https://hozo-am-line-oa-webhook.onrender.com/control/reports/send |
| **必填** | **`PORT`** | 3002 | 3005 |
| **必填** | **`NOTION_VERSION`** |  | 2025-09-03 |
| **必填** | **`PROJECT_JUDGMENT_REVIEW_TARGET_NAME_KEYWORD`** | Seven 陳聖文 | Maggie |
| 選用 | `PROJECT_CODEX_COMMAND_TRIGGERS` |  | HOZO Junior,HOZ Jr.,HOZO Jr. |
| 選用 | `PROJECT_OUTGOING_ACTOR_NAME` |  | HOZO Jr. |

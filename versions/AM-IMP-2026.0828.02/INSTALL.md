# Install

1. Deploy the updated AM Platform files:

```text
core/group-onboarding.js
server.js
tools/dryrun-core.mjs
```

2. Confirm the production AM Platform has the existing engineering tenant settings and LINE connection:

```text
ENG_NOTION_PARENT_PAGE_ID
ENG_GROUP_BINDINGS_DATA_SOURCE_ID
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
```

3. Confirm the shared LINE OA is a member of the target group and can read the group summary.

4. From the target LINE group, send:

```text
綁定 工程 AM 群組：<群組名稱>
```

5. Open the newly created row in Engineering AM's tenant-local Group Bindings data source. Select the correct `專案` relation and review `群組角色`, `工種`, `啟用功能`, and `狀態` before using the group for formal project control.

Do not copy a binding row, project relation, LINE group ID, or environment value from another tenant.

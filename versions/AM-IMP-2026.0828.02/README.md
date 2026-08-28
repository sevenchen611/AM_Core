# Engineering AM LINE group self-onboarding

This package adds `工程 AM` to the AM Platform LINE group-onboarding allowlist. A user can now send the following command from the target LINE group:

```text
綁定 工程 AM 群組：<群組名稱>
```

The aliases `工程AM`, `BuildAM`, and `Build AM` are also accepted. The LINE group ID remains the authoritative binding key, and the stored display name is resolved from the current LINE group summary rather than trusted from the command text.

## Engineering defaults

New engineering bindings are created with:

- status `啟用`;
- capabilities `訊息收集`, `待辦`, `會議`, `案件狀態`, `照片`, and `提醒`;
- meeting mode `完整確認`;
- temporary role `內部` and trade `其他`;
- status-update policy `總管`.

The command binds the LINE group to the `engineering` tenant. It does not guess the engineering project from the group name. After onboarding, an administrator must select the tenant-local `專案` relation and correct the group role and trade before relying on formal engineering task control.

The success reply includes this project/role/trade follow-up so the group is not mistaken for a fully configured engineering control channel.

## Isolation

No LINE group ID, Notion page ID, project record, conversation, credential, or environment value is stored in AMCore. The existing onboarding handler still checks every configured tenant for duplicate group IDs, rejects cross-tenant rebinding, and writes only to the resolved tenant's Group Bindings data source.

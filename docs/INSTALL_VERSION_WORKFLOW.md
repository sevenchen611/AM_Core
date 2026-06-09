# Install Version Workflow

Use this workflow when installing an AM_Core upgrade package into HOZO_AM, SevenAM, or another AM project.

## Standard Request

```text
請使用 shared-version-upgrade Skill，讀取 AM_Core 的 Upgrade Package，將指定版本安裝到目前專案。

請直接建立該建的本案資料庫、安裝該安裝的 script、更新該更新的設定與紀錄，並完成驗證。

注意：只能使用目前專案自己的 .env、Notion、LINE、Render、GitHub 設定，不能複製其他專案的資料或私鑰。

版本：
AM-IMP-YYYY.MMDD.NN
```

## Installer Steps

1. Identify the current project.
2. Read `D:\Codex_project\AM_Core\config\projects.json`.
3. Read the target package in `D:\Codex_project\AM_Core\versions`.
4. Read the current project's manifest.
5. Create or verify required Notion databases using the current project's credentials only.
6. Install required scripts into the current project.
7. Update `.env.example` and deployment checklist. Do not print secret values.
8. Run local checks.
9. Update the current project's `docs/project-improvement-manifest.md`.
10. Create or update the current project's upgrade record.
11. If deployed, verify Render production and mark `Deployed`; otherwise mark `Installed`.

## Status Meaning

| Status | Meaning |
| --- | --- |
| `Proposed` | Version idea exists but package is incomplete. |
| `Ready` | Package is complete but not installed in this project. |
| `Installed` | Project has the code/config/schema and local verification passed. |
| `Deployed` | Production service is verified using the installed version. |
| `Blocked` | Installer cannot proceed because a required local project value or permission is missing. |

## Do Not Stop At Questions

If a package says a database, script, JSON file, or schema is required, the installer should create or install it directly when credentials and permissions are available.

Ask the user only when:

- A secret value is missing.
- A Notion/Render/LINE permission is unavailable.
- The current project cannot be identified.
- The action would affect another project's data.


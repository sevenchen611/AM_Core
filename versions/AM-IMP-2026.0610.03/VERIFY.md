# Verify AM-IMP-2026.0610.03

Run package checks from AMCore:

```text
node --check D:\Codex_project\AM_Core\tools\apply-task-body-evidence-log-standard.js
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0610.03
```

After installing in HOZO_AM or SevenAM, verify project-local task output:

- A new LINE-derived task body contains `# 任務控制紀錄`.
- It contains `## 證據與處理紀錄`.
- Each source-driven task creation or update has its own `### 紀錄`.
- Each record contains `#### 來源原文`, `#### 證據摘要`,
  `#### AM 判斷`, `#### 處理結果`, and `#### 下一步`.
- LINE-derived records use a clickable `來源位置` link to the project-local LINE
  conversation master page.
- LINE source original blocks preserve the LINE conversation master format.
- Image messages show the image directly inside the matching `來源原文`.
- Document/file messages show the file name and attachment link.
- The separate `來源原文` property is not the only place where new raw evidence
  is stored.

Before calling cross-project alignment complete, run:

```text
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```

The alignment audit may require both project manifests to include this package.

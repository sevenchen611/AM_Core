# Verify

Run syntax checks:

```text
node --check scripts/build-user-ui-connected-preview.js
node --check src/control-api.js
```

Regenerate the User UI and confirm the generated HTML contains:

```text
手動加入任務判斷規則
manualJudgmentRuleForm
/control/judgment-rules/create
```

Check the AMCore package:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.07
```

Check cross-project status:

```text
node D:\Codex_project\AM_Core\tools\compare-project-manifests.js
node D:\Codex_project\AM_Core\tools\audit-alignment.js
```


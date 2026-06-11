# Verify

Run these checks after installation:

```text
node -e "const fs=require('fs'); for (const file of process.argv.slice(1)) { const html=fs.readFileSync(file,'utf8'); for (const m of html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)) new Function(m[1]); console.log('OK', file); }" <project>/reports/followup-confirmation-prototype.html
```

Then confirm:

- The report contains `today-completed`.
- The report contains `active-tasks`.
- The report does not contain `確認規則`.
- The report does not contain `#rules`.
- Any displayed task data comes only from the current project.

AMCore package checks:

```text
node D:\Codex_project\AM_Core\tools\check-upgrade-package.js AM-IMP-2026.0609.04
node D:\Codex_project\AM_Core\tools\audit-alignment.js
node D:\Codex_project\AM_Core\tools\compare-project-manifests.js
```


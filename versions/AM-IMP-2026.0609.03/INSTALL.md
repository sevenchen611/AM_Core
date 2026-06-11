# Install

Install this package separately into each AM project.

## Shared AMCore

1. Update `D:\Codex_project\AM_Core\tools\build-user-ui-connected-preview.js`.
2. Ensure task detail pages use the accepted source format:
   - source summary links to conversation or meeting source;
   - LINE archive messages render with metadata header and next-line body;
   - legacy standalone evidence cards are not rendered.

## SevenAM

1. Copy the AMCore generator into:
   `D:\Codex_project\SevenAM\line-oa-webhook\scripts\build-user-ui-connected-preview.js`
2. Regenerate all SevenAM User UI pages:

```text
node D:\Codex_project\SevenAM\line-oa-webhook\scripts\build-user-ui-connected-preview.js --projectRoot D:\Codex_project\SevenAM\line-oa-webhook --name "SevenAM" --prefix SEVEN --output D:\Codex_project\SevenAM\line-oa-webhook\docs\user-ui-connected-preview.html
```

3. Update the SevenAM project manifest and create a project-local upgrade note.

## HOZO AM

1. Copy the AMCore generator into:
   `D:\Codex_project\HOZO_AM\line-oa-webhook\scripts\build-user-ui-connected-preview.js`
2. Regenerate all HOZO AM User UI pages:

```text
node D:\Codex_project\HOZO_AM\line-oa-webhook\scripts\build-user-ui-connected-preview.js --projectRoot D:\Codex_project\HOZO_AM\line-oa-webhook --name "HOZO AM" --prefix HOZO --output D:\Codex_project\HOZO_AM\line-oa-webhook\docs\user-ui-connected-preview.html
```

3. Update the HOZO AM project manifest and create a project-local upgrade note.


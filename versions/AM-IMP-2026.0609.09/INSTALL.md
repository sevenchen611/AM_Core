# Install

Install this package separately into each AM project.

## Shared AMCore

1. Update `docs/USER_UI_ARCHITECTURE.md` with the task evidence media rule.
2. Keep the connected User UI generator behavior aligned:
   - task evidence cards call the shared message renderer;
   - the message renderer includes media from message records and attachment
     records;
   - image media renders as clickable thumbnails;
   - file media renders as clickable links.
3. Add and run the media verifier.

## SevenAM

1. Verify `scripts/build-user-ui-connected-preview.js` keeps task evidence media
   rendering enabled.
2. Regenerate SevenAM User UI pages when project data is available.
3. Update the SevenAM project manifest and create a project-local upgrade note.

## HOZO AM

1. Verify `scripts/build-user-ui-connected-preview.js` keeps task evidence media
   rendering enabled.
2. Regenerate HOZO AM User UI pages when project data is available.
3. Update the HOZO AM project manifest and create a project-local upgrade note.

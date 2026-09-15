# AM-IMP-2026.0915.01 — Design drawing upload success-flow hotfix

This hotfix corrects the Engineering dashboard flow after a design drawing has
already been stored in Google Drive and indexed in Notion.

The drawing branch uses its dedicated binary upload endpoint. It must not then
fall through to the generic JSON management endpoint, whose undefined path
caused `Cannot read properties of undefined (reading 'includes')` and displayed
a false failure alert after an HTTP 201 upload.

No Drive file, Notion row, project record, or production identifier is copied
into AMCore. Existing successfully uploaded versions remain unchanged.

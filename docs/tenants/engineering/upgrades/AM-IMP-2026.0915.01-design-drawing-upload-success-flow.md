# AM-IMP-2026.0915.01 — Design drawing upload success-flow hotfix

Status: Deployed

The production browser returned a false failure after a real HTTP 201 design
drawing upload. The binary upload and Notion index succeeded, but the drawing
branch then fell through to the generic management API with an undefined path.

This hotfix guards that generic call to non-drawing forms. Existing Drive and
Notion records require no migration or cleanup.

PR #166 merged as `4ccdbc7` and Render deployment
`dep-dakl1c67bikc7398pnpg` is Live. Production health passed, the authenticated
page contains the guard, and the existing V1 PDF version appears after reload.
No test upload, deletion, or project-data mutation was performed during
verification.

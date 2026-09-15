# AM-IMP-2026.0915.01 — Design drawing upload success-flow hotfix

Status: Ready

The production browser returned a false failure after a real HTTP 201 design
drawing upload. The binary upload and Notion index succeeded, but the drawing
branch then fell through to the generic management API with an undefined path.

This hotfix guards that generic call to non-drawing forms. Existing Drive and
Notion records require no migration or cleanup.

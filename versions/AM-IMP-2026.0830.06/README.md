# AM-IMP-2026.0830.06 — Contract review page script hotfix

Fixes the Engineering contract review page failure that displayed `i is not defined` before loading any V1 or V2 content.

The failure was caused by a regular-expression escape being interpreted while the browser script was generated from a server-side template literal. The LINE user-agent check now uses a literal lowercase substring comparison instead.

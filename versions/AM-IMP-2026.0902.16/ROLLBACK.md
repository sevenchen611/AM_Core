# Rollback

1. Revert the runtime commit and redeploy the previous contract signing page.
2. Keep signing evidence, active sessions, and contract records unchanged.
3. The added `pdfjs-dist` package may remain installed; it has no database or
   signing side effect when the old page does not request its asset routes.
4. If a signing-integrity problem is suspected, use the existing signing kill
   switch before rollback. Do not revoke active sessions without authorization.


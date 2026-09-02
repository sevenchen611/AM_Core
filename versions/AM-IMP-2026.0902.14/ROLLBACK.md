# Rollback

1. Disable new contract signing invitations with the existing production kill
   switch if a signing-integrity issue is suspected.
2. Revert the runtime and workspace commit. Do not delete signing events,
   signature artifacts, or active contract sessions.
3. Leave schema v8 installed. The additional event values are backward
   compatible and preserve append-only audit history.
4. For active two-party sessions, revoke through the existing administrative
   flow only when the project owner authorizes it; never silently substitute an
   internal or reusable Party A signature.

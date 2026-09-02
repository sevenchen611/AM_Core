# Rollback

1. Revert the runtime and renderer commit and redeploy the previous service.
2. Leave the original issued PDF, Party A signature artifact, session events,
   and all hashes untouched.
3. After rollback, protected links again show the original issued PDF until the
   existing final completion flow produces the dual-party signed PDF.
4. Never delete or replace the already submitted Party A signature as part of
   rollback.


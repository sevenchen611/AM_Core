# Rollback

Revert only the shared runtime compatibility change. Do not roll back schema
v9 or delete authority evidence. If the runtime is reverted, the application
will fail closed for unsupported schemas; record that availability impact in
the project-local manifest.

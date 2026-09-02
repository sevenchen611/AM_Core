# Rollback

1. Redeploy the Engineering AM service at the commit immediately before this package.
2. Do not delete or rewrite any version that already contains `documentPackage.contractFields`.
3. No database rollback is required.
4. Earlier runtimes preserve unknown version-package fields even though they do not render them.
5. Existing signatures, ID documents, hashes, PDFs, LINE archives, and evidence receipts remain immutable.

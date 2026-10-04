# Rollback

Revert reviewed runtime commits through main and redeploy if regressions occur. Keep additive schema fields, Drive originals, index links, digests and source identity records. Stop migration by rolling back the migration worker; do not delete stored originals or rewrite tenant ownership.

Already cleared Notion binary references are not automatically restored by code rollback. Drive remains the verified original; reconstruct an optional Notion copy only from the independently verified own-tenant Drive original if policy requires it. Historical source bytes and private audit exports must remain project-local, outside AMCore. Retry and needs-resend records must survive rollback.

# Install

1. Deploy the updated signing page, runtime evidence storage, signing service, PostgreSQL adapter, completion service, and PDF renderer.
2. Keep the existing Engineering Drive root private. The runtime creates `工程合約管理/簽署證據/{sessionId}/身分證件（機密）` automatically.
3. Do not add public Drive sharing, LINE attachment delivery, or draft-review exposure for identity images.
4. No database DDL is required. The existing immutable `signatures.evidence_snapshot` JSON stores both identity-document evidence objects and is covered by the existing evidence SHA-256.
5. Run the signing-web, signing, runtime, store, completion, and PDF-renderer dry-runs.
6. Deploy to the AM Platform Render service and verify the public signing page contains two required private image inputs while formal signing remains governed by the existing activation gate.

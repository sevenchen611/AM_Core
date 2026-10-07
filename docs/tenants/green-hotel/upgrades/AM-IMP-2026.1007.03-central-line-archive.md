# Central LINE evidence archive

Status: Deployed

The shared root runtime captures the selected OA before business routing. The owner archive has one database per group/room/private conversation and stores binary originals only in a deployment-selected Drive root.

Tenant business data sources and historical originals remain in place. New tenant attachment indexes reference central verified originals; quote retrieval still checks the exact source conversation. No project-specific IDs or messages are stored in this record.

Validation: real disposable PostgreSQL tests, private-pause webhook checks, original attachment retention/retrieval tests, and target-local storage readback. Production main f816b6d was verified live on 2026-10-07 with central capture enabled, Notion ready, the selected Google account checked and Drive originals readable. A real signed empty webhook returned 200 and an invalid signature returned 401. An explicitly labelled disposable Notion test retained more than 5,000 characters exactly and was archived after readback. History backfill, source gaps and aggregate counts remain in the deployment-local owner archive; no customer records or deployment IDs are stored here.

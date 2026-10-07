# Central LINE evidence archive

Status: Installed

The shared root runtime captures the selected OA before business routing. The owner archive has one database per group/room/private conversation and stores binary originals only in a deployment-selected Drive root.

Tenant business data sources and historical originals remain in place. New tenant attachment indexes reference central verified originals; quote retrieval still checks the exact source conversation. No project-specific IDs or messages are stored in this record.

Validation: real disposable PostgreSQL tests, private-pause webhook checks, original attachment retention/retrieval tests, and target-local storage readback. Production activation and completed history counts must be recorded after verification.

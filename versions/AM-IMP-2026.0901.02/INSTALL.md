# Install

1. Deploy the reviewed AM Platform `main` commit to the existing HOZO Render service.
2. Keep the existing Finance Claims v3 environment variables and PostgreSQL data unchanged.
3. Do not replay an old LINE event; request a fresh claim entry from the authorized finance group.
4. Verify the private message title is `HOZO 費用申請` without the canary marker.

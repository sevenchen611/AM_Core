# Rollback

Revert the package commit and redeploy the previous verified AM Platform
revision.

No database rollback or data cleanup is required. Do not delete or recreate any
contract version, signing session, signature, signing event, signed PDF,
evidence receipt, LINE message, Notion record, or Drive file.

After rollback, completed artifacts remain safely stored but the Engineering
workspace will again lack the direct final-artifact read controls, and the old
control-detail projection defect will return.

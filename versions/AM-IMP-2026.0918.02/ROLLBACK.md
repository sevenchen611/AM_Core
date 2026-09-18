# Rollback

Disable Rental automatic writes first; retain its issues and outbox. Revert this PR through main and normal Render deployment. Do not delete operational-memory receipt history; pending dedicated events fail visibly and remain for manual reconciliation until support is restored. Existing payment-draft notifications remain compatible.

BEGIN;

-- Party A signing uses the same append-only event chain as Party B. Extend the
-- existing event type constraint without changing or rewriting historical rows.
DO $do$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'engineering_contracts.signing_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%event_type%issued%sent%'
  LOOP
    EXECUTE format('ALTER TABLE engineering_contracts.signing_events DROP CONSTRAINT %I', item.conname);
  END LOOP;
END
$do$;

ALTER TABLE engineering_contracts.signing_events
  DROP CONSTRAINT IF EXISTS engineering_contract_signing_event_type_check;
ALTER TABLE engineering_contracts.signing_events
  ADD CONSTRAINT engineering_contract_signing_event_type_check CHECK (event_type IN (
    'issued', 'sent', 'delivery_ack', 'first_opened', 'signed',
    'submission_received', 'confirmed', 'completed', 'revoked', 'expired',
    'party_a_signer_assigned', 'party_a_first_opened', 'party_a_signed',
    'party_a_submission_received',
    'version_created', 'version_reviewed', 'version_issued',
    'line_send_requested', 'line_send_accepted', 'line_send_failed',
    'link_opened', 'liff_verified', 'group_membership_verified',
    'identity_verified', 'identity_rejected', 'signature_submitted',
    'signature_rejected', 'signed_pdf_stored', 'evidence_receipt_stored',
    'contract_signed', 'signer_declined', 'session_expired',
    'session_revoked', 'contract_voided', 'notion_projection_succeeded',
    'notion_projection_failed', 'administrative_correction'
  )) NOT VALID;
ALTER TABLE engineering_contracts.signing_events
  VALIDATE CONSTRAINT engineering_contract_signing_event_type_check;

UPDATE engineering_contracts.schema_meta
   SET version = '2026-09-02.engineering-contract-evidence.v8', installed_at = clock_timestamp()
 WHERE singleton;

COMMIT;

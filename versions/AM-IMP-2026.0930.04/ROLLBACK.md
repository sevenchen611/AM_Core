# Rollback

First restore the UOF caller's previous three-action layout so no expanded cards
are sent. Revert the reviewed gateway commit on main and deploy that reviewed
main revision. No database or key rollback is required. Existing LINE messages
remain unchanged; preserve original payloads for replay.

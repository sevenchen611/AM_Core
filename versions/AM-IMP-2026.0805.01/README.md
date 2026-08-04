# Detailed claim notification and reviewer mention

This package upgrades the claims submission receipt sent back to the source LINE group.

The notification contains the claim number, source, group, submitter, type, period, due date,
all line items, company expense, employee recovery, total, note, attachments, approval stage,
assigned reviewer, and a deep link to the Rental finance claim.

Rental remains the authority for reviewer assignment. Its machine response supplies the
reviewer username, display name, and LINE user ID; AM uses that data to create a real LINE
mention without storing Rental credentials or copying finance records into AM.

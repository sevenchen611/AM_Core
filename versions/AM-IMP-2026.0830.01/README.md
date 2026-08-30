# Engineering draft-review status hotfix

This package fixes the PostgreSQL draft-review transitions used after LINE accepts an invitation and when a reviewer opens the public draft. The target review table is now referenced explicitly, avoiding an ambiguous `status` column introduced by the joined contract-version query.

Existing provider-accepted reviews that remained in `created` may be repaired to `sent` with an append-only `line_send_accepted` event. The repair must reuse the original provider evidence and must not send a second LINE message.

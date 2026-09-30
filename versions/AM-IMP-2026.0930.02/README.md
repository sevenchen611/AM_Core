# Clickable URLs in UOF review cards

Status: Ready. Allows bounded review-card URI actions to open HTTP and HTTPS
links embedded in UOF form content. Each link is presented as a clearly labelled
LINE button; URLs are never executed as markup, and credentials in a URL remain
rejected. HTTP links are not encrypted, so the caller should identify them to
the reviewer before opening.

No database, secret, permission scope, or stored UOF data changes.

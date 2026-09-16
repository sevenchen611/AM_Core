# External claims canonical source and private templates

External vendor claim sessions now carry Rental's canonical claim source id and
the opaque LINE group reference from the authorized selector. Rental verifies
both values before accepting a claim, so it no longer mistakes the AM authority
binding page id for a Rental source id.

External applicants may also keep named personal templates without receiving a
Finance V3 identity, source membership, administrator role, or bank-account
permission. Template ownership is an irreversible hash of the applicant's
opaque LINE reference and remains scoped to the exact tenant, source and form.


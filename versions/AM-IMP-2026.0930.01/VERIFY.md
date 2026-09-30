# Verify

The existing main-branch workflow checks gateway identity, membership, idempotency,
cards, bindings and directory behavior. After deployment, health must report the
reviewed main commit and LINE I/O version 1.5.0. Confirm a newly issued personal
query sends a card or text without a preceding owner mention; confirm a static
client still mentions its configured recipient. Do not use an old idempotency key
to observe the behavior change because an already accepted event is not resent.

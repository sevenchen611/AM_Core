# Install

Merge the companion Rental receiver fix first. It must return `saved: true` only
after its audit record commits; existing 200/handled responses are insufficient.
Then merge this reviewed root AM Platform PR to main and let Render deploy main.
No remote migration, new credential or copied tenant data is required.

Existing processing_jobs schema and tenant configuration are reused. New bank
notifications retain trusted group ownership; legacy notification route digests
continue to recognize the designated reviewer without Notion lookup. Other
legacy senders require a successful group binding lookup before intake.

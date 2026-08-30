# Install

1. Deploy the updated `core/contract-store.js` runtime.
2. Run the contract-store and draft-review dry runs.
3. For each confirmed provider-accepted row still in `created`, atomically change it to `sent` and append the matching `line_send_accepted` event. Do not resend LINE.

# Rollback

1. Roll back the runtime to the prior release. Existing contract versions remain
   readable because the profile snapshot is additive JSON.
2. Leave `party_a_profiles` and its private Drive files in place during rollback;
   deleting them would remove source records that may be referenced by audit
   history.
3. If the UI must be disabled, remove the Party A navigation and API routes while
   preserving the table and files.
4. Do not delete profile rows or signing assets until every referencing contract
   version has passed a retention and legal review.

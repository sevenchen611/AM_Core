# Party A profile constraint forward repair

Production schema v8 retained the original `party_a_profiles_check` from schema
v6, so PostgreSQL still required a reusable signature asset for an individual
Party A profile even though the current application correctly submits an empty
asset object.

This forward-only schema v9 repair removes the stale check, preserves the
company-large-seal rule, and permits an individual identity-only profile with
empty assets. It also restores the contract-bound Party A signature artifact
constraint and confirmation trigger that schema v7 introduced, without
changing the schema v8 online signing event values.

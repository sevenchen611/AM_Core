# Rollback

Revert this package's gateway code and tests in a reviewed commit on main, then
deploy that main revision. The prior gateway uses sequential identity and group
checks with the same API, durable records, configuration, keys and bindings.
Do not reset cursors or delete send records; keep duplicate suppression intact.

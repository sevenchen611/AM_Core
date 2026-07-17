# Rollback

1. Remove `groups` from the affected tenant's `modules` list, or change its `homeRoute` back to the prior page.
2. Do not remove the v2 Notion columns during an incident; existing rows and the Core router safely ignore empty optional values.
3. If a particular group setting was incorrect, restore that row's previous values in Notion and save it through the group page to clear the route cache.
4. Do not change the shared LINE webhook, delete group bindings, or copy another tenant's values as part of rollback.

# Rollback

If the controller wants `來源原文` visible in the table again:

1. Open the project-local total-control task database.
2. Add `來源原文` back to the affected table view display properties.
3. Keep the data source property unchanged.
4. Update the project-local manifest entry from `Installed` to the chosen status.

No data restore is required because this package does not delete or erase `來源原文`.

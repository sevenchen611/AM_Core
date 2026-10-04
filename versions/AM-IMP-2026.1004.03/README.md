# Internal mobile expense claim form

Adds `mobile_expense_entry` to claim form management. HOZO internal staff open the existing Rental mobile page in claim mode and submit to the legacy review workflow. Rental verifies its own admin session and property access. Other tenants and external groups keep their existing forms.

The runtime startup applies the additive form-key constraint expansion. It creates no group assignments and no finance records.

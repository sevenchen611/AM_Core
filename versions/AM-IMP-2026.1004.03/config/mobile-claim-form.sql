BEGIN;
-- Expand accepted form keys. Existing rows, tenant policies and assignments remain.
ALTER TABLE am_claims.group_forms DROP CONSTRAINT IF EXISTS group_forms_form_key_check;
ALTER TABLE am_claims.group_forms ADD CONSTRAINT group_forms_form_key_check CHECK(form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense','mobile_expense_entry'));
ALTER TABLE am_claims.form_selection_sessions DROP CONSTRAINT IF EXISTS form_selection_sessions_selected_form_key_check;
ALTER TABLE am_claims.form_selection_sessions ADD CONSTRAINT form_selection_sessions_selected_form_key_check CHECK(selected_form_key IS NULL OR selected_form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense','mobile_expense_entry'));
ALTER TABLE am_claims.form_availability DROP CONSTRAINT IF EXISTS form_availability_form_key_check;
ALTER TABLE am_claims.form_availability ADD CONSTRAINT form_availability_form_key_check CHECK(form_key IN ('legacy_social_insurance','legacy_shared_operating','legacy_other','employee_expense','mobile_expense_entry'));
COMMIT;

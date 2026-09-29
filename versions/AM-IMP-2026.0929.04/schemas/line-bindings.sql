CREATE SCHEMA IF NOT EXISTS line_bindings;
CREATE TABLE IF NOT EXISTS line_bindings.bindings (
  id uuid PRIMARY KEY,
  tenant_key text NOT NULL,
  client_id text NOT NULL,
  external_user_id text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_line','pending_confirmation','bound','suspended','expired','revoked')),
  code_hash text UNIQUE,
  expires_at timestamptz NOT NULL,
  group_id text,
  user_id text,
  group_name text,
  user_name text,
  event_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  checked_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS personal_group_owner ON line_bindings.bindings(group_id)
  WHERE status IN ('pending_confirmation','bound','suspended');
CREATE UNIQUE INDEX IF NOT EXISTS personal_account_owner ON line_bindings.bindings(tenant_key,client_id,external_user_id)
  WHERE status IN ('bound','suspended');
CREATE UNIQUE INDEX IF NOT EXISTS personal_pending_account ON line_bindings.bindings(tenant_key,client_id,external_user_id)
  WHERE status IN ('pending_line','pending_confirmation');

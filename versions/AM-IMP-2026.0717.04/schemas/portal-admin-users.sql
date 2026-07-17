-- Reference schema only. The Portal worker applies these idempotently in ensureAuthSchema().
ALTER TABLE admin_users ADD COLUMN am_access TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_users ADD COLUMN authz_version INTEGER NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS am_authz_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  authz_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

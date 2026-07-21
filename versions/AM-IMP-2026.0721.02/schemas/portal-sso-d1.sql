-- AM-IMP-2026.0721.02
-- Portable additive Portal D1 schema reference.
-- Store SHA-256 URL-safe Base64 token hashes only; never store raw tokens.

CREATE TABLE IF NOT EXISTS am_sso_handoffs (
  token_hash TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  next_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_am_sso_handoffs_expiry
  ON am_sso_handoffs(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS am_sso_sessions (
  token_hash TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_am_sso_sessions_expiry
  ON am_sso_sessions(expires_at);

CREATE SCHEMA IF NOT EXISTS central_archive;
CREATE TABLE IF NOT EXISTS central_archive.conversations (
  key text PRIMARY KEY, bot_id text NOT NULL, source_kind text NOT NULL,
  source_id text NOT NULL, display_name text NOT NULL DEFAULT '',
  database_id text, data_source_id text, drive_folder_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bot_id,source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS central_archive.jobs (
  key text PRIMARY KEY, conversation_key text NOT NULL REFERENCES central_archive.conversations(key),
  event_at timestamptz NOT NULL, payload jsonb NOT NULL,
  has_binary boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}', error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS central_archive_pending ON central_archive.jobs(state,next_at);
CREATE TABLE IF NOT EXISTS central_archive.replies (
  token_hash text PRIMARY KEY, conversation_key text NOT NULL REFERENCES central_archive.conversations(key),
  expires_at timestamptz NOT NULL
);

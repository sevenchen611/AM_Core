BEGIN;
CREATE SCHEMA IF NOT EXISTS line_directory;
CREATE TABLE IF NOT EXISTS line_directory.groups (
  group_id text PRIMARY KEY CHECK (group_id ~* '^C[0-9a-f]{32}$'),
  name text NOT NULL DEFAULT '',
  presence text NOT NULL DEFAULT 'unknown' CHECK (presence IN ('unknown','present','left')),
  state_at bigint NOT NULL DEFAULT 0,
  last_seen_at bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS line_directory.members (
  group_id text NOT NULL REFERENCES line_directory.groups(group_id),
  user_id text NOT NULL CHECK (user_id ~* '^U[0-9a-f]{32}$'),
  display_name text NOT NULL DEFAULT '',
  membership text NOT NULL DEFAULT 'unknown' CHECK (membership IN ('unknown','present','left')),
  state_at bigint NOT NULL DEFAULT 0,
  last_seen_at bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id,user_id)
);
REVOKE ALL ON SCHEMA line_directory FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA line_directory FROM PUBLIC;
COMMIT;

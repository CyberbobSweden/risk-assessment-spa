-- ==========================================================================
-- Cyber Asset Inventory & Risk Assessment — D1 schema
-- Run with: wrangler d1 execute risk_assessment_db --file=./migrations/schema.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  customer     TEXT DEFAULT '',
  project      TEXT DEFAULT '',
  consultancy  TEXT DEFAULT '',
  consultant   TEXT DEFAULT '',
  created_by   TEXT DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Each system is stored as a JSON blob (the same object shape the frontend already
-- uses) plus a couple of indexed columns for fast filtering/sorting server-side.
CREATE TABLE IF NOT EXISTS systems (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  data          TEXT NOT NULL,      -- full system object as JSON
  risk_score    INTEGER DEFAULT 0,
  risk_level    TEXT DEFAULT 'Låg',
  created_by    TEXT DEFAULT '',
  updated_by    TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_systems_workspace ON systems(workspace_id);

CREATE TABLE IF NOT EXISTS action_status (
  workspace_id  TEXT NOT NULL,
  action_id     TEXT NOT NULL,
  completed     INTEGER DEFAULT 0,
  updated_by    TEXT DEFAULT '',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, action_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- Per-workspace access isolation: only listed emails can see/open a workspace.
-- The creator is added automatically when a workspace is created.
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id  TEXT NOT NULL,
  email         TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_email ON workspace_members(email);

-- User accounts (email + salted PBKDF2 password hash). Login issues a signed
-- JWT (see functions/_jwt.js) instead of relying on a shared site password.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  iterations     INTEGER NOT NULL DEFAULT 100000,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Per-workspace overrides of the default effect/cost ratings shown for
-- recommended actions, so a consultant can tune them per customer engagement
-- instead of using the generic 1-5 defaults baked into the frontend.
CREATE TABLE IF NOT EXISTS action_overrides (
  workspace_id  TEXT NOT NULL,
  action_id     TEXT NOT NULL,
  effect        INTEGER,
  cost          INTEGER,
  note          TEXT DEFAULT '',
  updated_by    TEXT DEFAULT '',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, action_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

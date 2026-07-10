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

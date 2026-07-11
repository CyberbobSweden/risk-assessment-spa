-- ==========================================================================
-- Migration 0004: per-workspace action effect/cost overrides
-- Run with:
--   wrangler d1 execute risk_assessment_db --remote --file=./migrations/0004_action_overrides.sql
-- ==========================================================================

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

-- ==========================================================================
-- Migration 0002: workspace membership (per-workspace access isolation)
-- Run with:
--   wrangler d1 execute risk_assessment_db --remote --file=./migrations/0002_members.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id  TEXT NOT NULL,
  email         TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_email ON workspace_members(email);

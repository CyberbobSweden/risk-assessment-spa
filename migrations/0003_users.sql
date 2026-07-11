-- ==========================================================================
-- Migration 0003: user accounts (real login instead of shared-password gate)
-- Run with:
--   wrangler d1 execute risk_assessment_db --remote --file=./migrations/0003_users.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  iterations     INTEGER NOT NULL DEFAULT 100000,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- v15 Migration: Usage tracking table for API proxy
-- Run this in the Supabase SQL Editor after 001_v14_auth_tables.sql

-- ============================================================
-- 1. USAGE TABLE — tracks every proxied API call
-- ============================================================
CREATE TABLE IF NOT EXISTS builder_usage (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  tokens_in   INT DEFAULT 0,
  tokens_out  INT DEFAULT 0,
  cost_cents  NUMERIC(10,4) DEFAULT 0,
  endpoint    TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_user ON builder_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON builder_usage(user_id, created_at DESC);

-- RLS: users can read their own usage; proxy function inserts via service_role
ALTER TABLE builder_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_owner_read ON builder_usage;
CREATE POLICY usage_owner_read ON builder_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own usage (proxy inserts with service_role bypass)
DROP POLICY IF EXISTS usage_owner_insert ON builder_usage;
CREATE POLICY usage_owner_insert ON builder_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. DAILY USAGE VIEW — for rate limiting and dashboard
-- ============================================================
CREATE OR REPLACE VIEW builder_usage_daily AS
SELECT
  user_id,
  date_trunc('day', created_at) AS day,
  SUM(tokens_in) AS total_tokens_in,
  SUM(tokens_out) AS total_tokens_out,
  SUM(cost_cents) AS total_cost_cents,
  COUNT(*) AS call_count
FROM builder_usage
GROUP BY user_id, date_trunc('day', created_at);

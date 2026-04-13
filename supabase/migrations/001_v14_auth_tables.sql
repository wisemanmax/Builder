-- v14 Migration: Auth + All Data Tables + RLS
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- ============================================================
-- 1. BUILDER_APPS — user's built applications
-- ============================================================
-- If the table already exists from the optional sync era, add missing columns.
-- If it doesn't exist, create it fresh.

CREATE TABLE IF NOT EXISTS builder_apps (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Untitled',
  icon        TEXT DEFAULT '',
  color_index INT DEFAULT 0,
  description TEXT DEFAULT '',
  code        TEXT DEFAULT '',
  prompts     JSONB DEFAULT '[]'::jsonb,
  gh_pushed   BOOLEAN DEFAULT false,
  published   BOOLEAN DEFAULT false,
  slug        TEXT UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- If table already existed without user_id / published / slug, add them:
DO $$ BEGIN
  ALTER TABLE builder_apps ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  ALTER TABLE builder_apps ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT false;
  ALTER TABLE builder_apps ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_apps_user ON builder_apps(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON builder_apps(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apps_published ON builder_apps(published) WHERE published = true;

-- ============================================================
-- 2. BUILDER_THOUGHTS — Thought Engine sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS builder_thoughts (
  id                TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT 'Untitled Thought',
  status            TEXT DEFAULT 'draft',
  original_prompt   TEXT DEFAULT '',
  rounds            INT DEFAULT 0,
  conversation      JSONB DEFAULT '[]'::jsonb,
  brief             JSONB DEFAULT '{}'::jsonb,
  feature_checklist JSONB DEFAULT '[]'::jsonb,
  linked_rules_id   TEXT,
  linked_app_id     TEXT,
  linked_repo       JSONB,
  version           INT DEFAULT 1,
  versions          JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thoughts_user ON builder_thoughts(user_id);

-- ============================================================
-- 3. BUILDER_RULES — user-defined and thought-generated rules
-- ============================================================
CREATE TABLE IF NOT EXISTS builder_rules (
  id                TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT 'Untitled Rules',
  linked_thought_id TEXT,
  must_rules        JSONB DEFAULT '[]'::jsonb,
  must_not_rules    JSONB DEFAULT '[]'::jsonb,
  nice_to_have      JSONB DEFAULT '[]'::jsonb,
  enabled           BOOLEAN DEFAULT true,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON builder_rules(user_id);

-- ============================================================
-- 4. BUILDER_PROFILES — org profiles with global rules
-- ============================================================
CREATE TABLE IF NOT EXISTS builder_profiles (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Untitled Profile',
  org_profile   JSONB DEFAULT '{}'::jsonb,
  global_rules  JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user ON builder_profiles(user_id);

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

-- Apps: owner can do everything; public can read published apps
ALTER TABLE builder_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apps_owner_all ON builder_apps;
CREATE POLICY apps_owner_all ON builder_apps
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS apps_public_read ON builder_apps;
CREATE POLICY apps_public_read ON builder_apps
  FOR SELECT USING (published = true);

-- Thoughts: owner-only
ALTER TABLE builder_thoughts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thoughts_owner_all ON builder_thoughts;
CREATE POLICY thoughts_owner_all ON builder_thoughts
  FOR ALL USING (auth.uid() = user_id);

-- Rules: owner-only
ALTER TABLE builder_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rules_owner_all ON builder_rules;
CREATE POLICY rules_owner_all ON builder_rules
  FOR ALL USING (auth.uid() = user_id);

-- Profiles: owner-only
ALTER TABLE builder_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_owner_all ON builder_profiles;
CREATE POLICY profiles_owner_all ON builder_profiles
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 6. AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apps_updated ON builder_apps;
CREATE TRIGGER trg_apps_updated BEFORE UPDATE ON builder_apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_thoughts_updated ON builder_thoughts;
CREATE TRIGGER trg_thoughts_updated BEFORE UPDATE ON builder_thoughts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_rules_updated ON builder_rules;
CREATE TRIGGER trg_rules_updated BEFORE UPDATE ON builder_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated ON builder_profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON builder_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

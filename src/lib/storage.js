import { ST, persist } from './state.js'
import { scrubKeys, toast } from './utils.js'
import { renderGrid, renderGridSkeleton } from '../components/app-icon.js'

// One-time setup SQL — user pastes this into Supabase SQL Editor once
var BUILDER_SETUP_SQL = '-- Builder: one-time Supabase setup\n'
  + '-- Paste this into your Supabase SQL Editor and click Run\n\n'
  + '-- 1. Helper function — lets Builder auto-create tables for your apps\n'
  + 'CREATE OR REPLACE FUNCTION builder_exec(statements text[])\n'
  + 'RETURNS json\n'
  + 'LANGUAGE plpgsql\n'
  + 'SECURITY DEFINER\n'
  + 'SET search_path = public\n'
  + 'AS $$\n'
  + 'DECLARE s text; lower_s text;\n'
  + 'BEGIN\n'
  + '  FOREACH s IN ARRAY statements LOOP\n'
  + '    lower_s := lower(trim(s));\n'
  + '    IF lower_s LIKE \'create table%\'\n'
  + '       OR lower_s LIKE \'create index%\'\n'
  + '       OR lower_s LIKE \'alter table%\'\n'
  + '       OR lower_s LIKE \'create policy%\' THEN\n'
  + '      EXECUTE s;\n'
  + '    END IF;\n'
  + '  END LOOP;\n'
  + '  RETURN json_build_object(\'ok\', true);\n'
  + 'END;\n'
  + '$$;\n\n'
  + 'GRANT EXECUTE ON FUNCTION builder_exec(text[]) TO anon, authenticated;\n\n'
  + '-- 2. Builder apps sync table\n'
  + 'CREATE TABLE IF NOT EXISTS builder_apps (\n'
  + '  id text PRIMARY KEY,\n'
  + '  name text,\n'
  + '  icon text,\n'
  + '  color_index int,\n'
  + '  description text,\n'
  + '  code text,\n'
  + '  prompts jsonb DEFAULT \'[]\',\n'
  + '  gh_pushed boolean DEFAULT false,\n'
  + '  created_at timestamptz DEFAULT now(),\n'
  + '  updated_at timestamptz DEFAULT now()\n'
  + ');\n\n'
  + 'ALTER TABLE builder_apps ENABLE ROW LEVEL SECURITY;\n'
  + 'CREATE POLICY "anon_all_builder_apps" ON builder_apps FOR ALL TO anon USING (true) WITH CHECK (true);'

export function getSetupSql() { return BUILDER_SETUP_SQL }

// Execute DDL statements on Supabase via the builder_exec RPC function
export function runSupabaseSql(statements) {
  if (!ST.sbUrl || !ST.sbAnon) return Promise.reject(new Error('No Supabase credentials'))
  return fetch(ST.sbUrl + '/rest/v1/rpc/builder_exec', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ST.sbAnon,
      'Authorization': 'Bearer ' + ST.sbAnon
    },
    body: JSON.stringify({ statements: statements })
  }).then(function (r) {
    if (r.status === 404) throw new Error('SETUP_REQUIRED')
    if (!r.ok) return r.text().then(function (t) { throw new Error(t || 'SQL execution failed') })
    return r.json()
  })
}

export function pushToSupabase(app) {
  if (!ST.sbEnabled || !ST.sbUrl || !ST.sbAnon || !app || !app.id) return
  var safePayload = { id: app.id, name: app.name, icon: app.icon, color_index: app.ci, description: app.desc, code: app.code, prompts: app.prompts || [], gh_pushed: app.ghPushed || false, created_at: app.createdAt, updated_at: app.updatedAt }
  var headers = { 'Content-Type': 'application/json', 'apikey': ST.sbAnon, 'Authorization': 'Bearer ' + ST.sbAnon, 'Prefer': 'resolution=merge-duplicates' }
  fetch(ST.sbUrl + '/rest/v1/builder_apps', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(safePayload),
  }).then(function (r) {
    // If table doesn't exist, try auto-creating it via builder_exec
    if (!r.ok && !ST._sbTableRetried) {
      ST._sbTableRetried = true
      return runSupabaseSql([
        'CREATE TABLE IF NOT EXISTS builder_apps (id text PRIMARY KEY, name text, icon text, color_index int, description text, code text, prompts jsonb DEFAULT \'[]\', gh_pushed boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())',
        'ALTER TABLE builder_apps ENABLE ROW LEVEL SECURITY',
        'CREATE POLICY "anon_all_builder_apps" ON builder_apps FOR ALL TO anon USING (true) WITH CHECK (true)'
      ]).then(function () {
        // Retry push after table creation
        return fetch(ST.sbUrl + '/rest/v1/builder_apps', {
          method: 'POST', headers: headers, body: JSON.stringify(safePayload)
        })
      }).catch(function () { /* silent — setup SQL not run yet */ })
    }
  }).catch(function (e) { console.warn('Supabase push failed:', scrubKeys(e.message)) })
}

export function pullFromSupabase() {
  if (!ST.sbUrl || !ST.sbAnon) { toast('No Supabase credentials'); return }
  renderGridSkeleton(6)
  fetch(ST.sbUrl + '/rest/v1/builder_apps?select=*&order=created_at.desc', {
    headers: { 'apikey': ST.sbAnon, 'Authorization': 'Bearer ' + ST.sbAnon },
  }).then(function (r) { return r.json() }).then(function (data) {
    if (!Array.isArray(data)) throw new Error('Bad response')
    var ids = {}; data.forEach(function (a) { ids[a.id] = true })
    var mapped = data.map(function (d) { return { id: d.id, name: d.name, icon: d.icon, ci: d.color_index, desc: d.description, code: d.code, versions: [], prompts: d.prompts || [], ghPushed: d.gh_pushed || false, createdAt: d.created_at, updatedAt: d.updated_at } })
    ST.apps = mapped.concat(ST.apps.filter(function (a) { return !ids[a.id] }))
    persist(); renderGrid(); toast('Pulled ' + data.length + ' apps \u2601\uFE0F')
  }).catch(function (e) { renderGrid(); toast('Pull failed: ' + scrubKeys(e.message), 4000) })
}

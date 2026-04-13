// Supabase sync for all data tables: apps, thoughts, rules, profiles
// Includes offline queue and first-login migration

import { ST, persist } from './state.js'
import { scrubKeys } from './utils.js'
import { getSupabase } from './supabase.js'
import { pushToSupabase } from './storage.js'

var QUEUE_KEY = 'bldr_sync_queue'

// ============================================================
// Offline mutation queue
// ============================================================

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch (e) {
    return []
  }
}

function saveQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch (e) {}
}

export function enqueue(table, op, payload) {
  var q = getQueue()
  q.push({ table: table, op: op, payload: payload, ts: Date.now() })
  saveQueue(q)
}

export function flushQueue() {
  var sb = getSupabase()
  if (!sb || !ST.userId || !navigator.onLine) return Promise.resolve()

  var q = getQueue()
  if (q.length === 0) return Promise.resolve()

  saveQueue([]) // Clear immediately, re-enqueue failures
  var failures = []

  return q
    .reduce(function (chain, item) {
      return chain.then(function () {
        return _execQueueItem(sb, item).catch(function () {
          failures.push(item)
        })
      })
    }, Promise.resolve())
    .then(function () {
      if (failures.length > 0) {
        var existing = getQueue()
        saveQueue(existing.concat(failures))
      }
    })
}

function _execQueueItem(sb, item) {
  if (item.op === 'upsert') {
    return sb
      .from(item.table)
      .upsert(item.payload, { onConflict: 'id' })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message)
      })
  }
  if (item.op === 'delete') {
    return sb
      .from(item.table)
      .delete()
      .eq('id', item.payload.id)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message)
      })
  }
  return Promise.resolve()
}

// Listen for online events to flush queue
if (typeof window !== 'undefined') {
  window.addEventListener('online', function () {
    flushQueue().catch(function (e) {
      console.warn('Queue flush failed:', e.message)
    })
  })
}

// ============================================================
// Push helpers (write-through: localStorage + Supabase)
// ============================================================

export function pushThought(thought) {
  var sb = getSupabase()
  if (!sb || !ST.userId) return
  var payload = {
    id: thought.id,
    user_id: ST.userId,
    name: thought.name || 'Untitled',
    status: thought.status || 'draft',
    original_prompt: thought.originalPrompt || '',
    rounds: thought.rounds || 0,
    conversation: thought.conversation || [],
    brief: thought.brief || {},
    feature_checklist: thought.featureChecklist || [],
    linked_rules_id: thought.linkedRulesId || null,
    linked_app_id: thought.linkedAppId || null,
    linked_repo: thought.linkedRepo || null,
    version: thought.version || 1,
    versions: thought.versions || [],
    created_at: thought.createdAt,
    updated_at: thought.updatedAt || new Date().toISOString(),
  }
  if (!navigator.onLine) {
    enqueue('builder_thoughts', 'upsert', payload)
    return
  }
  sb.from('builder_thoughts')
    .upsert(payload, { onConflict: 'id' })
    .then(function (r) {
      if (r.error) console.warn('Thought push failed:', scrubKeys(r.error.message))
    })
    .catch(function (e) {
      enqueue('builder_thoughts', 'upsert', payload)
    })
}

export function pushRule(rule) {
  var sb = getSupabase()
  if (!sb || !ST.userId) return
  var payload = {
    id: rule.id,
    user_id: ST.userId,
    name: rule.name || 'Untitled',
    linked_thought_id: rule.linkedThoughtId || null,
    must_rules: rule.mustRules || [],
    must_not_rules: rule.mustNotRules || [],
    nice_to_have: rule.niceToHave || [],
    enabled: rule.enabled !== false,
    sort_order: rule.sortOrder || 0,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt || new Date().toISOString(),
  }
  if (!navigator.onLine) {
    enqueue('builder_rules', 'upsert', payload)
    return
  }
  sb.from('builder_rules')
    .upsert(payload, { onConflict: 'id' })
    .then(function (r) {
      if (r.error) console.warn('Rule push failed:', scrubKeys(r.error.message))
    })
    .catch(function (e) {
      enqueue('builder_rules', 'upsert', payload)
    })
}

export function pushProfile(profile) {
  var sb = getSupabase()
  if (!sb || !ST.userId) return
  var payload = {
    id: profile.id,
    user_id: ST.userId,
    name: profile.name || 'Untitled',
    org_profile: profile.orgProfile || {},
    global_rules: profile.globalRules || {},
    created_at: profile.createdAt,
    updated_at: profile.updatedAt || new Date().toISOString(),
  }
  if (!navigator.onLine) {
    enqueue('builder_profiles', 'upsert', payload)
    return
  }
  sb.from('builder_profiles')
    .upsert(payload, { onConflict: 'id' })
    .then(function (r) {
      if (r.error) console.warn('Profile push failed:', scrubKeys(r.error.message))
    })
    .catch(function (e) {
      enqueue('builder_profiles', 'upsert', payload)
    })
}

// ============================================================
// Pull all data from Supabase (used on sign-in)
// ============================================================

export function pullAllFromSupabase() {
  var sb = getSupabase()
  if (!sb || !ST.userId) return Promise.resolve()

  return Promise.all([
    _pullTable(sb, 'builder_apps', _mapApp, 'apps'),
    _pullTable(sb, 'builder_thoughts', _mapThought, 'thoughts'),
    _pullTable(sb, 'builder_rules', _mapRule, 'rules'),
    _pullTable(sb, 'builder_profiles', _mapProfile, 'profiles'),
  ]).then(function () {
    persist()
    // Flush any pending offline mutations
    return flushQueue()
  })
}

function _pullTable(sb, table, mapFn, stKey) {
  return sb
    .from(table)
    .select('*')
    .order('created_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        console.warn('Pull ' + table + ' failed:', result.error.message)
        return
      }
      var data = result.data || []
      var ids = {}
      data.forEach(function (d) {
        ids[d.id] = true
      })
      var mapped = data.map(mapFn)
      // Merge: remote wins for existing IDs, keep local-only items
      ST[stKey] = mapped.concat(
        ST[stKey].filter(function (item) {
          return !ids[item.id]
        })
      )
    })
}

function _mapApp(d) {
  return {
    id: d.id,
    name: d.name,
    icon: d.icon,
    ci: d.color_index,
    desc: d.description,
    code: d.code,
    versions: [],
    prompts: d.prompts || [],
    ghPushed: d.gh_pushed || false,
    published: d.published || false,
    slug: d.slug || null,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

function _mapThought(d) {
  return {
    id: d.id,
    name: d.name,
    status: d.status || 'draft',
    originalPrompt: d.original_prompt || '',
    rounds: d.rounds || 0,
    conversation: d.conversation || [],
    brief: d.brief || {},
    featureChecklist: d.feature_checklist || [],
    linkedRulesId: d.linked_rules_id || null,
    linkedAppId: d.linked_app_id || null,
    linkedRepo: d.linked_repo || null,
    version: d.version || 1,
    versions: d.versions || [],
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

function _mapRule(d) {
  return {
    id: d.id,
    name: d.name,
    linkedThoughtId: d.linked_thought_id || null,
    mustRules: d.must_rules || [],
    mustNotRules: d.must_not_rules || [],
    niceToHave: d.nice_to_have || [],
    enabled: d.enabled !== false,
    sortOrder: d.sort_order || 0,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

function _mapProfile(d) {
  return {
    id: d.id,
    name: d.name,
    orgProfile: d.org_profile || {},
    globalRules: d.global_rules || {},
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }
}

// ============================================================
// Push all local data to Supabase (batch)
// ============================================================

export function syncAllToSupabase() {
  var sb = getSupabase()
  if (!sb || !ST.userId) return Promise.resolve()

  var promises = []

  ST.apps.forEach(function (app) {
    promises.push(pushToSupabase(app))
  })
  ST.thoughts.forEach(function (t) {
    promises.push(
      sb
        .from('builder_thoughts')
        .upsert(
          {
            id: t.id,
            user_id: ST.userId,
            name: t.name || 'Untitled',
            status: t.status || 'draft',
            original_prompt: t.originalPrompt || '',
            rounds: t.rounds || 0,
            conversation: t.conversation || [],
            brief: t.brief || {},
            feature_checklist: t.featureChecklist || [],
            linked_rules_id: t.linkedRulesId || null,
            linked_app_id: t.linkedAppId || null,
            linked_repo: t.linkedRepo || null,
            version: t.version || 1,
            versions: t.versions || [],
            created_at: t.createdAt,
            updated_at: t.updatedAt || new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .then(function (r) {
          if (r.error) console.warn('Thought sync failed:', r.error.message)
        })
    )
  })
  ST.rules.forEach(function (rule) {
    promises.push(
      sb
        .from('builder_rules')
        .upsert(
          {
            id: rule.id,
            user_id: ST.userId,
            name: rule.name || 'Untitled',
            linked_thought_id: rule.linkedThoughtId || null,
            must_rules: rule.mustRules || [],
            must_not_rules: rule.mustNotRules || [],
            nice_to_have: rule.niceToHave || [],
            enabled: rule.enabled !== false,
            sort_order: rule.sortOrder || 0,
            created_at: rule.createdAt,
            updated_at: rule.updatedAt || new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .then(function (r) {
          if (r.error) console.warn('Rule sync failed:', r.error.message)
        })
    )
  })
  ST.profiles.forEach(function (p) {
    promises.push(
      sb
        .from('builder_profiles')
        .upsert(
          {
            id: p.id,
            user_id: ST.userId,
            name: p.name || 'Untitled',
            org_profile: p.orgProfile || {},
            global_rules: p.globalRules || {},
            created_at: p.createdAt,
            updated_at: p.updatedAt || new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .then(function (r) {
          if (r.error) console.warn('Profile sync failed:', r.error.message)
        })
    )
  })

  return Promise.all(promises)
}

// ============================================================
// First-login migration: push existing localStorage data to Supabase
// ============================================================

var MIGRATED_KEY = 'bldr_migrated'

export function migrateLocalData() {
  if (localStorage.getItem(MIGRATED_KEY)) return Promise.resolve()
  if (!ST.userId) return Promise.resolve()

  var hasData = ST.apps.length > 0 || ST.thoughts.length > 0 || ST.rules.length > 0 || ST.profiles.length > 0
  if (!hasData) {
    localStorage.setItem(MIGRATED_KEY, 'true')
    return Promise.resolve()
  }

  console.log('[Migration] Pushing ' + ST.apps.length + ' apps, ' + ST.thoughts.length + ' thoughts to Supabase')
  return syncAllToSupabase().then(function () {
    localStorage.setItem(MIGRATED_KEY, 'true')
    console.log('[Migration] Complete')
  })
}

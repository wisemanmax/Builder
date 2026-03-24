import { ST } from './state.js'
import { uid } from './utils.js'
import { scrubKeys } from './utils.js'

var MAX_EVENTS = 200
var MAX_EVENTS_KB = 200
var STORAGE_KEY = 'bldr_events'

// Current build session context
var _ctx = {
  buildId: null,
  appId: null,
  pipeline: null,
}

/**
 * Start a new build session. Returns a buildId for correlating events.
 */
export function startBuild(appId, pipeline) {
  var buildId = 'b_' + uid()
  _ctx.buildId = buildId
  _ctx.appId = appId
  _ctx.pipeline = pipeline
  emit('build.start', {
    appId: appId,
    pipeline: pipeline,
    ts: new Date().toISOString(),
  })
  return buildId
}

/**
 * End a build session. Triggers optional Supabase sync.
 */
export function endBuild(buildId) {
  if (_ctx.buildId === buildId) {
    _ctx.buildId = null
    _ctx.appId = null
    _ctx.pipeline = null
  }
}

/**
 * Get the current build context (buildId, appId, pipeline).
 */
export function getBuildContext() {
  return {
    buildId: _ctx.buildId,
    appId: _ctx.appId,
    pipeline: _ctx.pipeline,
  }
}

/**
 * Emit a telemetry event. Auto-populates buildId, appId, profileId.
 * @param {string} type - Namespaced event type (e.g. 'build.checks')
 * @param {object} data - Event-specific payload
 */
export function emit(type, data) {
  var evt = {
    id: uid(),
    type: type,
    ts: new Date().toISOString(),
    appId: _ctx.appId || (data && data.appId) || null,
    buildId: _ctx.buildId || null,
    profileId: ST.activeProfileId || null,
    pipeline: _ctx.pipeline || null,
    data: data || {},
    v: 1,
  }
  var events = _loadEvents()
  events.push(evt)
  _saveEvents(events)
  return evt
}

/**
 * Query local events by optional filter.
 * @param {object} filter - { type, appId, buildId, since }
 */
export function getEvents(filter) {
  var events = _loadEvents()
  if (!filter) return events
  return events.filter(function (e) {
    if (filter.type && e.type !== filter.type) return false
    if (filter.appId && e.appId !== filter.appId) return false
    if (filter.buildId && e.buildId !== filter.buildId) return false
    if (filter.since && e.ts < filter.since) return false
    return true
  })
}

/**
 * Get aggregated event counts by type since a given date.
 */
export function getEventCounts(type, since) {
  var events = _loadEvents()
  var count = 0
  for (var i = 0; i < events.length; i++) {
    if (events[i].type === type) {
      if (!since || events[i].ts >= since) count++
    }
  }
  return count
}

/**
 * Get the most recent event matching a filter.
 */
export function getLastEvent(type, appId) {
  var events = _loadEvents()
  for (var i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) {
      if (!appId || events[i].appId === appId) return events[i]
    }
  }
  return null
}

/**
 * Enforce storage limits — evict oldest events when over capacity.
 */
export function pruneEvents() {
  var events = _loadEvents()
  if (events.length <= MAX_EVENTS) return
  // Keep most recent MAX_EVENTS
  events = events.slice(events.length - MAX_EVENTS)
  _saveEvents(events)
}

// --- Internal helpers ---

function _loadEvents() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function _saveEvents(events) {
  // Enforce max count
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS)
  }
  try {
    var json = JSON.stringify(events)
    // Enforce max size (~200KB)
    if (json.length > MAX_EVENTS_KB * 1024) {
      // Trim oldest 25% until under limit
      while (json.length > MAX_EVENTS_KB * 1024 && events.length > 10) {
        var trimCount = Math.max(1, Math.floor(events.length * 0.25))
        events = events.slice(trimCount)
        json = JSON.stringify(events)
      }
    }
    localStorage.setItem(STORAGE_KEY, json)
  } catch (e) {
    // Quota exceeded — drop oldest half and retry
    try {
      events = events.slice(Math.floor(events.length / 2))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
    } catch (e2) {
      console.warn('[Telemetry] Storage full, events dropped')
    }
  }
}

/**
 * Sync un-synced events to Supabase (if configured).
 * Non-blocking — failures are silently logged.
 */
export function syncToSupabase() {
  if (!ST.sbEnabled || !ST.sbUrl || !ST.sbAnon) return Promise.resolve()
  var events = _loadEvents()
  if (!events.length) return Promise.resolve()

  return fetch(ST.sbUrl + '/rest/v1/builder_events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ST.sbAnon,
      Authorization: 'Bearer ' + ST.sbAnon,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(
      events.map(function (e) {
        return {
          id: e.id,
          type: e.type,
          ts: e.ts,
          app_id: e.appId,
          build_id: e.buildId,
          profile_id: e.profileId,
          pipeline: e.pipeline,
          data: e.data,
          schema_version: e.v,
        }
      })
    ),
  }).catch(function (e) {
    console.warn('[Telemetry] Supabase sync failed:', scrubKeys(e.message))
  })
}

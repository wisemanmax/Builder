import { ST } from './state.js'
import { uid } from './utils.js'
import { scrubKeys } from './utils.js'
import { emit, getBuildContext } from './telemetry.js'

var STORAGE_KEY = 'bldr_build_records'
var MAX_RECORDS = 20
var FULL_ARTIFACT_COUNT = 5 // most recent N keep full artifacts
var MAX_PLAN_SIZE = 4000
var MAX_THINKING_SIZE = 8000

/**
 * Create a new build record at pipeline start.
 * @param {string} appId
 * @param {string} pipeline - pipeline mode
 * @param {string} prompt - user prompt
 * @param {object} opts - { isUpdate, thoughtId, templateId, hasImages }
 * @returns {object} the new build record
 */
export function createBuildRecord(appId, pipeline, prompt, opts) {
  opts = opts || {}
  var ctx = getBuildContext()
  var record = {
    id: 'br_' + uid(),
    buildId: ctx.buildId || 'b_' + uid(),
    appId: appId || null,
    profileId: ST.activeProfileId || null,
    pipeline: pipeline || ST.pipelineMode || 'builder1',
    isUpdate: opts.isUpdate || false,

    // Inputs
    prompt: (prompt || '').slice(0, 5000),
    thoughtId: opts.thoughtId || null,
    templateId: opts.templateId || null,
    hasImages: opts.hasImages || false,

    // Intermediate artifacts (populated during build)
    plan: null,
    thinking: null,

    // Quality data
    checks: null,
    auditBugs: null,
    enhancementReview: null,
    compliance: null,

    // Fix loop tracking
    fixPasses: [],

    // User decisions
    checkpointDecision: null,
    approvalDecision: null,
    approvalTimeMs: null,

    // Outcomes (populated at completion)
    finalCodeSize: null,
    finalCheckScore: null,
    totalChecks: null,
    costData: null,
    duration: null,

    // Post-build signals (updated later)
    feedbackRating: null,
    feedbackTags: [],
    editCountAfter: 0,

    // Scores (populated by scoring.js in Phase 2)
    qualityScore: null,
    satisfactionScore: null,
    compositeScore: null,

    ts: new Date().toISOString(),
    _startTime: Date.now(),
    v: 1,
  }

  var records = _loadRecords()
  records.push(record)
  _saveRecords(records)
  return record
}

/**
 * Update a field on an existing build record.
 * @param {string} buildId
 * @param {string} field
 * @param {*} value
 */
export function updateBuildRecord(buildId, field, value) {
  var records = _loadRecords()
  for (var i = 0; i < records.length; i++) {
    if (records[i].buildId === buildId) {
      // Size-cap certain fields
      if (field === 'plan' && typeof value === 'string') {
        value = value.slice(0, MAX_PLAN_SIZE)
      }
      if (field === 'thinking' && typeof value === 'string') {
        value = value.slice(0, MAX_THINKING_SIZE)
      }
      records[i][field] = value
      _saveRecords(records)
      return records[i]
    }
  }
  return null
}

/**
 * Finalize a build record at pipeline completion.
 * @param {string} buildId
 * @param {object} outcome - { finalCodeSize, costData, approved }
 */
export function completeBuildRecord(buildId, outcome) {
  outcome = outcome || {}
  var records = _loadRecords()
  for (var i = 0; i < records.length; i++) {
    var r = records[i]
    if (r.buildId === buildId) {
      r.finalCodeSize = outcome.finalCodeSize || null
      r.costData = outcome.costData || null
      r.duration = r._startTime ? Date.now() - r._startTime : null
      r.approvalDecision = outcome.approved ? 'approved' : (outcome.cancelled ? 'cancelled' : r.approvalDecision)

      // Calculate check score
      if (r.checks && r.checks.length) {
        var passed = 0
        for (var j = 0; j < r.checks.length; j++) {
          if (r.checks[j].passed) passed++
        }
        r.finalCheckScore = passed
        r.totalChecks = r.checks.length
      }

      delete r._startTime
      _saveRecords(records)

      emit('build.complete', {
        buildId: buildId,
        duration: r.duration,
        finalCodeSize: r.finalCodeSize,
        qualityScore: r.qualityScore,
        pipeline: r.pipeline,
        checkScore: r.finalCheckScore,
        totalChecks: r.totalChecks,
      })

      return r
    }
  }
  return null
}

/**
 * Retrieve a build record by buildId.
 */
export function getBuildRecord(buildId) {
  var records = _loadRecords()
  for (var i = 0; i < records.length; i++) {
    if (records[i].buildId === buildId) return records[i]
  }
  return null
}

/**
 * Query build records with optional filter.
 * @param {object} filter - { appId, profileId, pipeline, since }
 */
export function getBuildRecords(filter) {
  var records = _loadRecords()
  if (!filter) return records
  return records.filter(function (r) {
    if (filter.appId && r.appId !== filter.appId) return false
    if (filter.profileId && r.profileId !== filter.profileId) return false
    if (filter.pipeline && r.pipeline !== filter.pipeline) return false
    if (filter.since && r.ts < filter.since) return false
    return true
  })
}

/**
 * Get the N most recent build records.
 */
export function getRecentRecords(n) {
  var records = _loadRecords()
  return records.slice(-1 * (n || 10))
}

/**
 * Get the most recent build record for an app.
 */
export function getLatestForApp(appId) {
  var records = _loadRecords()
  for (var i = records.length - 1; i >= 0; i--) {
    if (records[i].appId === appId) return records[i]
  }
  return null
}

/**
 * Increment post-build edit count for the most recent build of an app.
 */
export function incrementEditCount(appId) {
  var records = _loadRecords()
  for (var i = records.length - 1; i >= 0; i--) {
    if (records[i].appId === appId) {
      records[i].editCountAfter = (records[i].editCountAfter || 0) + 1
      _saveRecords(records)
      return records[i]
    }
  }
  return null
}

/**
 * Update the most recent build record for an app with feedback data.
 */
export function attachFeedback(appId, rating, tags) {
  var records = _loadRecords()
  for (var i = records.length - 1; i >= 0; i--) {
    if (records[i].appId === appId) {
      records[i].feedbackRating = rating
      records[i].feedbackTags = tags || []
      _saveRecords(records)
      return records[i]
    }
  }
  return null
}

/**
 * Enforce storage limits. Evict oldest records; strip artifacts from old records.
 */
export function pruneRecords() {
  var records = _loadRecords()

  // Remove records older than 90 days
  var cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  var cutoffStr = cutoff.toISOString()
  records = records.filter(function (r) {
    return r.ts >= cutoffStr
  })

  // Enforce max count
  if (records.length > MAX_RECORDS) {
    records = records.slice(records.length - MAX_RECORDS)
  }

  // Strip full artifacts from records beyond the most recent N
  var keepFullFrom = Math.max(0, records.length - FULL_ARTIFACT_COUNT)
  for (var i = 0; i < keepFullFrom; i++) {
    records[i].plan = null
    records[i].thinking = null
    records[i].auditBugs = null
    records[i].enhancementReview = null
    records[i].compliance = null
  }

  _saveRecords(records)
}

// --- Internal helpers ---

function _loadRecords() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function _saveRecords(records) {
  // Enforce max count before saving
  if (records.length > MAX_RECORDS) {
    records = records.slice(records.length - MAX_RECORDS)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch (e) {
    // Quota exceeded — strip artifacts from all but latest 3
    try {
      for (var i = 0; i < records.length - 3; i++) {
        records[i].plan = null
        records[i].thinking = null
        records[i].auditBugs = null
        records[i].enhancementReview = null
        records[i].compliance = null
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    } catch (e2) {
      console.warn('[BuildRecord] Storage full, records may be lost')
    }
  }
}

/**
 * Sync build records to Supabase (if configured).
 */
export function syncRecordsToSupabase() {
  if (!ST.sbEnabled || !ST.sbUrl || !ST.sbAnon) return Promise.resolve()
  var records = _loadRecords()
  if (!records.length) return Promise.resolve()

  return fetch(ST.sbUrl + '/rest/v1/builder_build_records', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ST.sbAnon,
      Authorization: 'Bearer ' + ST.sbAnon,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(
      records.map(function (r) {
        return {
          id: r.id,
          build_id: r.buildId,
          app_id: r.appId,
          profile_id: r.profileId,
          pipeline: r.pipeline,
          is_update: r.isUpdate,
          prompt: r.prompt,
          thought_id: r.thoughtId,
          template_id: r.templateId,
          checks: r.checks,
          audit_bugs: r.auditBugs,
          fix_passes: r.fixPasses,
          checkpoint_decision: r.checkpointDecision,
          approval_decision: r.approvalDecision,
          approval_time_ms: r.approvalTimeMs,
          final_code_size: r.finalCodeSize,
          final_check_score: r.finalCheckScore,
          total_checks: r.totalChecks,
          cost_data: r.costData,
          duration: r.duration,
          feedback_rating: r.feedbackRating,
          feedback_tags: r.feedbackTags,
          edit_count_after: r.editCountAfter,
          quality_score: r.qualityScore,
          satisfaction_score: r.satisfactionScore,
          composite_score: r.compositeScore,
          ts: r.ts,
          schema_version: r.v,
        }
      })
    ),
  }).catch(function (e) {
    console.warn('[BuildRecord] Supabase sync failed:', scrubKeys(e.message))
  })
}

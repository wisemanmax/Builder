import { ST, persist, getActiveProfile } from './state.js'
import { callClaudeRaw } from './ai.js'
import { SYS_LEARN, SYS_EXTRACT_RULES } from '../config/prompts.js'
import { getBuildRecords } from './build-record.js'
import {
  computeQualityScore,
  computeSatisfactionScore,
  computeCompositeScore,
  getProfileScoreStats,
} from './scoring.js'

// --- Helpers ---

function _findProfile(profileId) {
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === profileId) return ST.profiles[i]
  }
  return null
}

/**
 * Analyze feedback for a profile and extract learned preferences.
 * Uses Claude to find patterns across all feedback entries.
 */
export function analyzeFeedback(profileId) {
  var profile = _findProfile(profileId)
  if (!profile) return Promise.reject(new Error('Profile not found'))
  var feedback = profile.feedback || []
  if (feedback.length < 3) return Promise.reject(new Error('Need at least 3 feedback entries to analyze'))

  var feedbackSummary = feedback.map(function (fb) {
    return {
      appName: fb.appName || '',
      prompt: (fb.prompt || '').slice(0, 200),
      rating: fb.rating,
      liked: fb.liked || '',
      disliked: fb.disliked || '',
      tags: fb.tags || [],
    }
  })

  // Gather thought-level feedback from thoughts
  var thoughtFeedback = []
  for (var t = 0; t < ST.thoughts.length; t++) {
    var th = ST.thoughts[t]
    if (th.feedback && th.feedback.rating) {
      thoughtFeedback.push({
        thoughtName: th.name || '',
        thoughtRating: th.feedback.rating,
        thoughtText: th.feedback.text || '',
      })
    }
  }

  var msg =
    'Analyze this feedback from ' +
    feedback.length +
    ' app builds for the organization "' +
    (profile.name || 'unnamed') +
    '":\n\n' +
    JSON.stringify(feedbackSummary, null, 2)

  if (thoughtFeedback.length) {
    msg +=
      '\n\nIDEATION/THOUGHT FEEDBACK (' +
      thoughtFeedback.length +
      ' entries):\n' +
      JSON.stringify(thoughtFeedback, null, 2)
  }

  return callClaudeRaw(SYS_LEARN, msg, 2000).then(function (raw) {
    var parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      parsed = { positivePatterns: [], negativePatterns: [], designPrefs: [], functionalPrefs: [] }
    }
    profile.learnedPreferences = {
      positivePatterns: Array.isArray(parsed.positivePatterns) ? parsed.positivePatterns : [],
      negativePatterns: Array.isArray(parsed.negativePatterns) ? parsed.negativePatterns : [],
      designPrefs: Array.isArray(parsed.designPrefs) ? parsed.designPrefs : [],
      functionalPrefs: Array.isArray(parsed.functionalPrefs) ? parsed.functionalPrefs : [],
      ideationPrefs: Array.isArray(parsed.ideationPrefs) ? parsed.ideationPrefs : [],
      lastAnalyzedAt: new Date().toISOString(),
      feedbackCount: feedback.length,
    }
    persist()
    return profile.learnedPreferences
  })
}

/**
 * Check if auto-analysis should trigger (every 5 new feedbacks).
 * Call this after saving new feedback.
 */
export function maybeAutoAnalyze(profileId) {
  var profile = _findProfile(profileId)
  if (!profile) return
  var feedback = profile.feedback || []
  var lastCount = (profile.learnedPreferences && profile.learnedPreferences.feedbackCount) || 0
  if (feedback.length >= 5 && feedback.length - lastCount >= 5) {
    analyzeFeedback(profileId)
      .then(function () {
        console.log('[Learning] Auto-analyzed ' + feedback.length + ' feedback entries for ' + profile.name)
      })
      .catch(function (e) {
        console.warn('[Learning] Auto-analysis failed:', e.message)
      })
  }
}

// --- Phase 3: Build Record Analysis & Rule Extraction ---

/**
 * Analyze build records for a profile and extract improvement rules.
 * Uses Claude to find quality patterns across build history.
 * @param {string} profileId
 * @returns {Promise<object>} extracted rules { mustRules, mustNotRules, insights }
 */
export function analyzeBuilds(profileId) {
  var profile = _findProfile(profileId)
  if (!profile) return Promise.reject(new Error('Profile not found'))

  var records = getBuildRecords({ profileId: profileId })
  if (records.length < 3) return Promise.reject(new Error('Need at least 3 build records to analyze'))

  // Prepare a compact summary for Claude (avoid sending full code/plans)
  var buildSummaries = records.map(function (r) {
    // Ensure scores exist
    var q = r.qualityScore != null ? r.qualityScore : computeQualityScore(r)
    var s = r.satisfactionScore != null ? r.satisfactionScore : computeSatisfactionScore(r)
    var c = r.compositeScore != null ? r.compositeScore : computeCompositeScore(q, s)

    return {
      pipeline: r.pipeline,
      prompt: (r.prompt || '').slice(0, 150),
      qualityScore: q,
      satisfactionScore: s,
      compositeScore: c,
      checks: (r.checks || []).map(function (ch) {
        return { id: ch.id, label: ch.label, passed: ch.passed }
      }),
      auditBugs: Array.isArray(r.auditBugs)
        ? r.auditBugs.map(function (b) {
            return { severity: b.severity, issue: (b.issue || '').slice(0, 100) }
          })
        : [],
      fixPasses: (r.fixPasses || []).length,
      feedbackRating: r.feedbackRating,
      feedbackTags: r.feedbackTags || [],
      editCountAfter: r.editCountAfter || 0,
      approvalDecision: r.approvalDecision,
    }
  })

  var msg =
    'Analyze these ' +
    records.length +
    ' build records for "' +
    (profile.name || 'unnamed') +
    '" and extract improvement rules:\n\n' +
    JSON.stringify(buildSummaries, null, 2)

  return callClaudeRaw(SYS_EXTRACT_RULES, msg, 2000).then(function (raw) {
    var parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      parsed = { mustRules: [], mustNotRules: [], insights: [] }
    }

    var rules = {
      mustRules: Array.isArray(parsed.mustRules) ? parsed.mustRules.slice(0, 5) : [],
      mustNotRules: Array.isArray(parsed.mustNotRules) ? parsed.mustNotRules.slice(0, 5) : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [],
      lastExtractedAt: new Date().toISOString(),
      buildCount: records.length,
    }

    // Store on profile
    profile.buildLearnedRules = rules
    persist()

    console.log(
      '[Learning] Extracted ' +
        (rules.mustRules.length + rules.mustNotRules.length) +
        ' rules from ' +
        records.length +
        ' builds'
    )
    return rules
  })
}

/**
 * Get build insights summary without calling AI.
 * Returns locally computed stats from scoring.js.
 * @param {string} profileId
 * @returns {object} stats from getProfileScoreStats
 */
export function getBuildInsights(profileId) {
  return getProfileScoreStats(profileId)
}

/**
 * Check if build rule extraction should auto-trigger.
 * Triggers every 5 new builds since last extraction.
 * Call this after completing a build.
 * @param {string} profileId
 */
export function maybeAutoExtractRules(profileId) {
  var profile = _findProfile(profileId)
  if (!profile) return

  var records = getBuildRecords({ profileId: profileId })
  var lastCount = (profile.buildLearnedRules && profile.buildLearnedRules.buildCount) || 0

  if (records.length >= 3 && records.length - lastCount >= 5) {
    analyzeBuilds(profileId)
      .then(function (rules) {
        console.log('[Learning] Auto-extracted rules from ' + records.length + ' builds for ' + profile.name)
      })
      .catch(function (e) {
        console.warn('[Learning] Auto rule extraction failed:', e.message)
      })
  }
}

/**
 * Trigger both feedback analysis and build rule extraction.
 * Convenience function to run full learning cycle.
 * @param {string} profileId
 */
export function runFullAnalysis(profileId) {
  var profile = _findProfile(profileId)
  if (!profile) return Promise.reject(new Error('Profile not found'))

  var promises = []

  var feedback = profile.feedback || []
  if (feedback.length >= 3) {
    promises.push(
      analyzeFeedback(profileId).catch(function (e) {
        console.warn('[Learning] Feedback analysis failed:', e.message)
        return null
      })
    )
  }

  var records = getBuildRecords({ profileId: profileId })
  if (records.length >= 3) {
    promises.push(
      analyzeBuilds(profileId).catch(function (e) {
        console.warn('[Learning] Build analysis failed:', e.message)
        return null
      })
    )
  }

  if (!promises.length)
    return Promise.reject(new Error('Not enough data for analysis (need 3+ feedback entries or build records)'))
  return Promise.all(promises)
}

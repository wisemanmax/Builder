import { getBuildRecords } from './build-record.js'

/**
 * Phase 2: Build Quality Scoring System
 *
 * Computes three scores for each build record:
 * - qualityScore (0-100): objective quality from checks, audits, fix passes
 * - satisfactionScore (0-100): user satisfaction from feedback, edits, approval timing
 * - compositeScore (0-100): weighted blend of quality + satisfaction
 */

// --- Weights ---
var QUALITY_WEIGHTS = {
  checks: 0.4, // check pass rate
  auditSeverity: 0.25, // inverse of audit bug severity
  fixPasses: 0.15, // fewer fix passes = better first-pass quality
  codeSize: 0.1, // reasonable code size (not too small, not bloated)
  approval: 0.1, // approved vs rejected/cancelled
}

var SATISFACTION_WEIGHTS = {
  feedbackRating: 0.5, // user star rating (1-5)
  editCount: 0.25, // fewer post-build edits = more satisfied
  approvalSpeed: 0.25, // faster approval = more confident
}

var COMPOSITE_WEIGHTS = {
  quality: 0.55,
  satisfaction: 0.45,
}

/**
 * Compute quality score (0-100) from objective build data.
 * @param {object} record - build record
 * @returns {number} quality score 0-100
 */
export function computeQualityScore(record) {
  if (!record) return 0
  var scores = {}

  // 1. Check pass rate (0-100)
  if (record.checks && record.checks.length > 0) {
    var passed = 0
    for (var i = 0; i < record.checks.length; i++) {
      if (record.checks[i].passed) passed++
    }
    scores.checks = (passed / record.checks.length) * 100
  } else {
    scores.checks = 50 // neutral if no checks ran
  }

  // 2. Audit severity score (0-100, higher = fewer/less severe bugs)
  if (record.auditBugs) {
    var bugs = Array.isArray(record.auditBugs) ? record.auditBugs : []
    if (bugs.length === 0) {
      scores.auditSeverity = 100
    } else {
      var severityPenalty = 0
      for (var j = 0; j < bugs.length; j++) {
        var sev = (bugs[j].severity || '').toLowerCase()
        if (sev === 'high' || sev === 'critical') severityPenalty += 15
        else if (sev === 'medium') severityPenalty += 8
        else severityPenalty += 3
      }
      scores.auditSeverity = Math.max(0, 100 - severityPenalty)
    }
  } else {
    scores.auditSeverity = 50
  }

  // 3. Fix pass efficiency (0-100, fewer passes = better)
  var fixCount = (record.fixPasses && record.fixPasses.length) || 0
  if (fixCount === 0)
    scores.fixPasses = 100 // passed first time
  else if (fixCount === 1) scores.fixPasses = 80
  else if (fixCount === 2) scores.fixPasses = 60
  else if (fixCount === 3) scores.fixPasses = 40
  else scores.fixPasses = 20

  // 4. Code size reasonableness (0-100)
  var size = record.finalCodeSize || 0
  if (size === 0) {
    scores.codeSize = 50
  } else if (size < 2000) {
    // Too small — likely incomplete
    scores.codeSize = 40
  } else if (size < 5000) {
    scores.codeSize = 70
  } else if (size <= 200000) {
    // Sweet spot
    scores.codeSize = 100
  } else if (size <= 400000) {
    scores.codeSize = 70
  } else {
    // Bloated
    scores.codeSize = Math.max(20, 100 - (size - 400000) / 10000)
  }

  // 5. Approval outcome
  if (record.approvalDecision === 'approved') scores.approval = 100
  else if (record.approvalDecision === 'rejected') scores.approval = 20
  else if (record.approvalDecision === 'cancelled') scores.approval = 10
  else scores.approval = 50

  // Weighted sum
  var total = 0
  var keys = Object.keys(QUALITY_WEIGHTS)
  for (var k = 0; k < keys.length; k++) {
    total += (scores[keys[k]] || 0) * QUALITY_WEIGHTS[keys[k]]
  }
  return Math.round(total)
}

/**
 * Compute satisfaction score (0-100) from user signals.
 * Returns null if no user signals are available yet.
 * @param {object} record - build record
 * @returns {number|null} satisfaction score 0-100, or null if insufficient data
 */
export function computeSatisfactionScore(record) {
  if (!record) return null

  var hasRating = record.feedbackRating != null
  var hasEdits = record.editCountAfter != null && record.editCountAfter > 0
  var hasApprovalTime = record.approvalTimeMs != null

  // Need at least one signal
  if (!hasRating && !hasEdits && !hasApprovalTime) return null

  var scores = {}
  var weights = {}
  var totalWeight = 0

  // 1. Feedback rating (1-5 → 0-100)
  if (hasRating) {
    scores.feedbackRating = ((record.feedbackRating - 1) / 4) * 100
    weights.feedbackRating = SATISFACTION_WEIGHTS.feedbackRating
    totalWeight += weights.feedbackRating
  }

  // 2. Edit count (fewer = more satisfied)
  if (record.editCountAfter != null) {
    var edits = record.editCountAfter
    if (edits === 0) scores.editCount = 100
    else if (edits <= 2) scores.editCount = 75
    else if (edits <= 5) scores.editCount = 50
    else if (edits <= 10) scores.editCount = 30
    else scores.editCount = 10
    weights.editCount = SATISFACTION_WEIGHTS.editCount
    totalWeight += weights.editCount
  }

  // 3. Approval speed (faster = more confident)
  if (hasApprovalTime) {
    var ms = record.approvalTimeMs
    if (ms < 5000)
      scores.approvalSpeed = 95 // very quick = confident
    else if (ms < 15000) scores.approvalSpeed = 85
    else if (ms < 30000) scores.approvalSpeed = 70
    else if (ms < 60000) scores.approvalSpeed = 55
    else if (ms < 120000) scores.approvalSpeed = 40
    else scores.approvalSpeed = 25 // took a long time = uncertain
    weights.approvalSpeed = SATISFACTION_WEIGHTS.approvalSpeed
    totalWeight += weights.approvalSpeed
  }

  if (totalWeight === 0) return null

  // Normalize weights and compute
  var total = 0
  var wKeys = Object.keys(weights)
  for (var i = 0; i < wKeys.length; i++) {
    total += (scores[wKeys[i]] || 0) * (weights[wKeys[i]] / totalWeight)
  }
  return Math.round(total)
}

/**
 * Compute composite score blending quality and satisfaction.
 * @param {number} qualityScore
 * @param {number|null} satisfactionScore
 * @returns {number} composite 0-100
 */
export function computeCompositeScore(qualityScore, satisfactionScore) {
  if (satisfactionScore == null) return qualityScore || 0
  return Math.round(qualityScore * COMPOSITE_WEIGHTS.quality + satisfactionScore * COMPOSITE_WEIGHTS.satisfaction)
}

/**
 * Score a build record in place. Updates qualityScore, satisfactionScore, compositeScore.
 * @param {object} record - build record (mutated)
 * @returns {object} { qualityScore, satisfactionScore, compositeScore }
 */
export function scoreRecord(record) {
  if (!record) return { qualityScore: 0, satisfactionScore: null, compositeScore: 0 }
  record.qualityScore = computeQualityScore(record)
  record.satisfactionScore = computeSatisfactionScore(record)
  record.compositeScore = computeCompositeScore(record.qualityScore, record.satisfactionScore)
  return {
    qualityScore: record.qualityScore,
    satisfactionScore: record.satisfactionScore,
    compositeScore: record.compositeScore,
  }
}

/**
 * Get aggregate scoring stats for a profile's builds.
 * @param {string} profileId
 * @returns {object} { avgQuality, avgSatisfaction, avgComposite, trend, totalBuilds, topIssues }
 */
export function getProfileScoreStats(profileId) {
  var records = getBuildRecords({ profileId: profileId })
  if (!records.length) {
    return { avgQuality: 0, avgSatisfaction: null, avgComposite: 0, trend: 0, totalBuilds: 0, topIssues: [] }
  }

  var qualitySum = 0
  var satSum = 0
  var satCount = 0
  var compositeSum = 0

  // Track common failing checks
  var failCounts = {}

  for (var i = 0; i < records.length; i++) {
    var r = records[i]
    var q = r.qualityScore != null ? r.qualityScore : computeQualityScore(r)
    qualitySum += q

    var s = r.satisfactionScore != null ? r.satisfactionScore : computeSatisfactionScore(r)
    if (s != null) {
      satSum += s
      satCount++
    }

    var c = r.compositeScore != null ? r.compositeScore : computeCompositeScore(q, s)
    compositeSum += c

    // Tally failing checks
    if (r.checks) {
      for (var j = 0; j < r.checks.length; j++) {
        if (!r.checks[j].passed) {
          var key = r.checks[j].id || r.checks[j].label
          failCounts[key] = (failCounts[key] || 0) + 1
        }
      }
    }
  }

  // Compute trend (compare last 3 vs previous 3)
  var trend = 0
  if (records.length >= 6) {
    var recent3 = 0
    var prev3 = 0
    for (var ri = records.length - 3; ri < records.length; ri++) {
      recent3 += records[ri].compositeScore || 0
    }
    for (var pi = records.length - 6; pi < records.length - 3; pi++) {
      prev3 += records[pi].compositeScore || 0
    }
    trend = Math.round((recent3 - prev3) / 3)
  }

  // Top failing checks (sorted by frequency)
  var topIssues = Object.keys(failCounts)
    .map(function (k) {
      return { check: k, count: failCounts[k] }
    })
    .sort(function (a, b) {
      return b.count - a.count
    })
    .slice(0, 5)

  return {
    avgQuality: Math.round(qualitySum / records.length),
    avgSatisfaction: satCount > 0 ? Math.round(satSum / satCount) : null,
    avgComposite: Math.round(compositeSum / records.length),
    trend: trend,
    totalBuilds: records.length,
    topIssues: topIssues,
  }
}

/**
 * Format a score as a label.
 */
export function scoreLabel(score) {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Good'
  if (score >= 60) return 'Fair'
  if (score >= 40) return 'Needs Work'
  return 'Poor'
}

import { ST, persist, getActiveProfile } from './state.js'
import { callClaudeRaw } from './ai.js'
import { SYS_LEARN } from '../config/prompts.js'

/**
 * Analyze feedback for a profile and extract learned preferences.
 * Uses Claude to find patterns across all feedback entries.
 */
export function analyzeFeedback(profileId) {
  var profile = null
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === profileId) {
      profile = ST.profiles[i]
      break
    }
  }
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

  var msg =
    'Analyze this feedback from ' +
    feedback.length +
    ' app builds for the organization "' +
    (profile.name || 'unnamed') +
    '":\n\n' +
    JSON.stringify(feedbackSummary, null, 2)

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
  var profile = null
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === profileId) {
      profile = ST.profiles[i]
      break
    }
  }
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

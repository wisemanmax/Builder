import { TEMPLATES } from '../config/templates.js'
import { getBuildRecords } from './build-record.js'
import { computeCompositeScore, computeQualityScore, computeSatisfactionScore } from './scoring.js'
import { ST } from './state.js'

/**
 * Phase 4: Similarity-Based Template Ranking
 *
 * Ranks templates by how well they've performed in past builds,
 * using keyword similarity to weight relevant build history.
 */

// Keywords associated with each template for matching
var TEMPLATE_KEYWORDS = {
  'habit-tracker': ['habit', 'tracker', 'streak', 'daily', 'routine', 'goal', 'track'],
  'pomodoro': ['timer', 'pomodoro', 'focus', 'interval', 'productivity', 'countdown', 'session'],
  'kanban': ['kanban', 'board', 'task', 'project', 'column', 'drag', 'todo', 'workflow'],
  'quiz-game': ['quiz', 'game', 'question', 'trivia', 'score', 'answer', 'test'],
  'analytics-dashboard': ['dashboard', 'analytics', 'chart', 'data', 'kpi', 'metric', 'report', 'graph'],
  'weather-app': ['weather', 'forecast', 'temperature', 'climate', 'condition'],
  'portfolio': ['portfolio', 'personal', 'project', 'resume', 'cv', 'showcase', 'work'],
  'landing-page': ['landing', 'saas', 'product', 'pricing', 'feature', 'marketing', 'startup', 'hero'],
  'calculator': ['calculator', 'math', 'calculate', 'compute', 'scientific', 'convert'],
  'budget-tracker': ['budget', 'expense', 'finance', 'money', 'spending', 'income', 'cost'],
  'recipe-book': ['recipe', 'cook', 'food', 'meal', 'ingredient', 'kitchen', 'menu'],
  'mood-journal': ['mood', 'journal', 'diary', 'emotion', 'feeling', 'log', 'mental', 'wellness'],
  'endless-runner': ['runner', 'endless', 'obstacle', 'lane', 'dodge', 'speed', 'coin', 'jump', 'run', 'arcade'],
}

// Category-level keywords for broader matching
var CATEGORY_KEYWORDS = {
  productivity: ['productivity', 'organize', 'plan', 'manage', 'schedule', 'task', 'workflow', 'progress'],
  games: ['game', 'play', 'fun', 'interactive', 'challenge', 'score', 'level'],
  dashboards: ['dashboard', 'chart', 'data', 'visualization', 'monitor', 'report', 'analytics'],
  landing: ['landing', 'page', 'marketing', 'website', 'product', 'conversion', 'hero'],
  portfolios: ['portfolio', 'showcase', 'personal', 'gallery', 'creative', 'work'],
  tools: ['tool', 'utility', 'calculator', 'converter', 'helper', 'app'],
}

/**
 * Compute keyword similarity between a prompt and a set of keywords.
 * Returns 0-1 score based on word overlap.
 * @param {string} prompt
 * @param {string[]} keywords
 * @returns {number} 0-1 similarity
 */
function keywordSimilarity(prompt, keywords) {
  if (!prompt || !keywords || !keywords.length) return 0
  var words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
  var matches = 0
  for (var i = 0; i < keywords.length; i++) {
    for (var j = 0; j < words.length; j++) {
      if (words[j] === keywords[i] || words[j].indexOf(keywords[i]) >= 0 || keywords[i].indexOf(words[j]) >= 0) {
        matches++
        break
      }
    }
  }
  return matches / keywords.length
}

/**
 * Find the most similar template to a prompt using keyword matching.
 * @param {string} prompt
 * @returns {string|null} templateId or null
 */
export function findSimilarTemplate(prompt) {
  if (!prompt) return null
  var bestId = null
  var bestScore = 0
  var ids = Object.keys(TEMPLATE_KEYWORDS)
  for (var i = 0; i < ids.length; i++) {
    var score = keywordSimilarity(prompt, TEMPLATE_KEYWORDS[ids[i]])
    if (score > bestScore) {
      bestScore = score
      bestId = ids[i]
    }
  }
  return bestScore >= 0.15 ? bestId : null
}

/**
 * Get performance stats for each template from build records.
 * @param {string} profileId - optional, filter by profile
 * @returns {object} { templateId: { avgScore, buildCount, lastUsed } }
 */
export function getTemplatePerformance(profileId) {
  var filter = {}
  if (profileId) filter.profileId = profileId
  var records = getBuildRecords(filter)
  var stats = {}

  for (var i = 0; i < records.length; i++) {
    var r = records[i]
    var tplId = r.templateId
    if (!tplId) continue

    if (!stats[tplId]) {
      stats[tplId] = { totalScore: 0, buildCount: 0, lastUsed: r.ts }
    }

    var score = r.compositeScore != null
      ? r.compositeScore
      : computeCompositeScore(
          r.qualityScore != null ? r.qualityScore : computeQualityScore(r),
          r.satisfactionScore != null ? r.satisfactionScore : computeSatisfactionScore(r)
        )

    stats[tplId].totalScore += score
    stats[tplId].buildCount++
    if (r.ts > stats[tplId].lastUsed) stats[tplId].lastUsed = r.ts
  }

  // Compute averages
  var result = {}
  var ids = Object.keys(stats)
  for (var j = 0; j < ids.length; j++) {
    var s = stats[ids[j]]
    result[ids[j]] = {
      avgScore: Math.round(s.totalScore / s.buildCount),
      buildCount: s.buildCount,
      lastUsed: s.lastUsed,
    }
  }
  return result
}

/**
 * Get prompt similarity scores for all templates.
 * Combines template keywords + category keywords.
 * @param {string} prompt
 * @returns {object} { templateId: similarityScore }
 */
function getPromptSimilarityScores(prompt) {
  var scores = {}
  for (var i = 0; i < TEMPLATES.length; i++) {
    var t = TEMPLATES[i]
    var tplSim = keywordSimilarity(prompt, TEMPLATE_KEYWORDS[t.id] || [])
    var catSim = keywordSimilarity(prompt, CATEGORY_KEYWORDS[t.category] || [])
    // Template-specific keywords weighted higher than category
    scores[t.id] = tplSim * 0.7 + catSim * 0.3
  }
  return scores
}

/**
 * Rank templates for a given prompt, combining:
 * - Keyword similarity to the prompt (if provided)
 * - Historical performance from build records
 * - Recency bonus for recently used templates
 *
 * @param {string} prompt - user's build prompt (optional)
 * @param {string} profileId - optional profile filter
 * @returns {object[]} ranked array of { id, name, icon, category, desc, score, reason }
 */
export function rankTemplates(prompt, profileId) {
  var performance = getTemplatePerformance(profileId || ST.activeProfileId)
  var similarity = prompt ? getPromptSimilarityScores(prompt) : {}

  var ranked = []
  for (var i = 0; i < TEMPLATES.length; i++) {
    var t = TEMPLATES[i]
    var perf = performance[t.id] || null
    var sim = similarity[t.id] || 0

    // Base score: similarity (0-1 scaled to 0-50)
    var score = sim * 50

    // Performance bonus (0-40 based on avg composite score)
    if (perf && perf.buildCount > 0) {
      score += (perf.avgScore / 100) * 40
    }

    // Recency bonus (0-10, decays over 30 days)
    if (perf && perf.lastUsed) {
      var daysSinceUse = (Date.now() - new Date(perf.lastUsed).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceUse < 30) {
        score += 10 * (1 - daysSinceUse / 30)
      }
    }

    // Determine reason label
    var reason = ''
    if (sim >= 0.3 && perf && perf.avgScore >= 70) reason = 'Best match'
    else if (sim >= 0.3) reason = 'Good match'
    else if (perf && perf.avgScore >= 80) reason = 'Top rated'
    else if (perf && perf.buildCount >= 2) reason = 'Frequently used'

    ranked.push({
      id: t.id,
      name: t.name,
      icon: t.icon,
      category: t.category,
      desc: t.desc,
      score: Math.round(score * 10) / 10,
      reason: reason,
      avgScore: perf ? perf.avgScore : null,
      buildCount: perf ? perf.buildCount : 0,
    })
  }

  // Sort by score descending, then by name for stability
  ranked.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    return a.name.localeCompare(b.name)
  })

  return ranked
}

/**
 * Get top N recommended templates.
 * Only returns templates with a meaningful score.
 * @param {string} prompt
 * @param {number} n - max results (default 3)
 * @returns {object[]} top recommendations
 */
export function getRecommendations(prompt, n) {
  var ranked = rankTemplates(prompt)
  var results = []
  for (var i = 0; i < ranked.length && results.length < (n || 3); i++) {
    if (ranked[i].score > 5 || ranked[i].reason) {
      results.push(ranked[i])
    }
  }
  return results
}

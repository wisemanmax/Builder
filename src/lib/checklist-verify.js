import { callClaudeRaw } from './ai.js'
import { ST, persist } from './state.js'

var SYS_VERIFY_CHECKLIST =
  "You are a code reviewer. Given an HTML app's source code and a feature checklist, " +
  'determine which features are implemented in the code.\n\n' +
  'Analyze the code carefully. A feature is "verified" if there is clear evidence it works ' +
  '(DOM elements, event handlers, logic, styles that implement it).\n\n' +
  'Return ONLY valid JSON — no markdown, no explanation:\n' +
  '[\n  { "id": "feat-0", "verified": true, "evidence": "short reason" },\n  ...\n]\n\n' +
  'Keep evidence to one sentence max. Check every item in the list.'

/**
 * Verify which features from a checklist are present in built code.
 * @param {string} code - The built HTML/app code
 * @param {Array} checklist - Array of { id, text, required, verified }
 * @returns {Promise<{ total, verified, missing, items }>}
 */
export function verifyFeatureChecklist(code, checklist) {
  if (!checklist || !checklist.length || !code) {
    return Promise.resolve({ total: 0, verified: 0, missing: 0, items: [] })
  }

  // Truncate code to ~30KB to keep token count reasonable
  var trimmedCode = code.length > 30000 ? code.slice(0, 30000) + '\n<!-- ... truncated -->' : code

  var checklistText = checklist
    .map(function (item) {
      return '- [' + item.id + '] ' + item.text + (item.required ? ' (REQUIRED)' : ' (optional)')
    })
    .join('\n')

  var msg = 'APP CODE:\n```html\n' + trimmedCode + '\n```\n\n' + 'FEATURE CHECKLIST:\n' + checklistText

  return callClaudeRaw(SYS_VERIFY_CHECKLIST, msg, 1500).then(function (raw) {
    var results
    try {
      results = JSON.parse(raw)
    } catch (e) {
      // Try to extract JSON array from response
      var match = raw.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          results = JSON.parse(match[0])
        } catch (e2) {
          results = []
        }
      } else {
        results = []
      }
    }

    // Build lookup
    var lookup = {}
    for (var r = 0; r < results.length; r++) {
      if (results[r] && results[r].id) {
        lookup[results[r].id] = results[r]
      }
    }

    // Merge with original checklist
    var items = []
    var verifiedCount = 0
    var missingCount = 0

    for (var i = 0; i < checklist.length; i++) {
      var original = checklist[i]
      var result = lookup[original.id] || { verified: false, evidence: 'Not found in AI response' }
      var item = {
        id: original.id,
        text: original.text,
        required: original.required,
        verified: !!result.verified,
        evidence: result.evidence || '',
      }
      items.push(item)
      if (item.verified) verifiedCount++
      else missingCount++
    }

    return {
      total: checklist.length,
      verified: verifiedCount,
      missing: missingCount,
      items: items,
    }
  })
}

/**
 * Get the active thought's feature checklist, if any.
 * @returns {Array|null}
 */
export function getActiveChecklist() {
  if (!ST.activeThoughtId) return null
  var thought = null
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === ST.activeThoughtId) {
      thought = ST.thoughts[i]
      break
    }
  }
  if (!thought || !thought.featureChecklist || !thought.featureChecklist.length) return null
  return thought.featureChecklist
}

/**
 * Update the stored checklist on the thought with verification results.
 * @param {Array} items - Verified items from verifyFeatureChecklist
 */
export function updateStoredChecklist(items) {
  if (!ST.activeThoughtId || !items || !items.length) return
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === ST.activeThoughtId && ST.thoughts[i].featureChecklist) {
      var cl = ST.thoughts[i].featureChecklist
      var lookup = {}
      for (var j = 0; j < items.length; j++) {
        lookup[items[j].id] = items[j]
      }
      for (var k = 0; k < cl.length; k++) {
        if (lookup[cl[k].id]) {
          cl[k].verified = lookup[cl[k].id].verified
        }
      }
      persist()
      break
    }
  }
}

/**
 * Get missing required features as text for fix loop injection.
 * @param {object} summary - Result from verifyFeatureChecklist
 * @returns {string} Text listing missing required features, or empty string
 */
export function getMissingRequiredText(summary) {
  if (!summary || !summary.items) return ''
  var missing = []
  for (var i = 0; i < summary.items.length; i++) {
    var item = summary.items[i]
    if (item.required && !item.verified) {
      missing.push('- ' + item.text)
    }
  }
  if (!missing.length) return ''
  return 'MISSING REQUIRED FEATURES (must be implemented):\n' + missing.join('\n')
}

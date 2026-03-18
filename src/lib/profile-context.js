import { getActiveProfile } from './state.js'

/**
 * Build the profile context string to inject into any pipeline's system prompt.
 * Returns { orgText, profileRulesText, prefsText, profileName } or null values if no profile active.
 */
export function getProfileContext() {
  var profile = getActiveProfile()
  if (!profile) return { orgText: '', profileRulesText: '', prefsText: '', profileName: '' }

  var orgText = ''
  var org = profile.orgProfile || {}
  if (org.vision) {
    orgText = 'Organization: ' + (profile.name || 'unnamed') + '\n'
      + 'Vision: ' + org.vision + '\n'
    if (org.principles && org.principles.length) orgText += 'Principles: ' + org.principles.join(', ') + '\n'
    if (org.brandIdentity) {
      if (org.brandIdentity.tone) orgText += 'Brand tone: ' + org.brandIdentity.tone + '\n'
      if (org.brandIdentity.accentColor) orgText += 'Brand accent: ' + org.brandIdentity.accentColor + '\n'
      if (org.brandIdentity.theme) orgText += 'Brand theme: ' + org.brandIdentity.theme + '\n'
      if (org.brandIdentity.fonts) orgText += 'Brand fonts: ' + org.brandIdentity.fonts + '\n'
    }
    if (org.roadmap && org.roadmap.length) orgText += 'Roadmap: ' + org.roadmap.join(', ') + '\n'
  }

  var profileRulesText = ''
  var gr = profile.globalRules || {}
  var hasMust = gr.mustRules && gr.mustRules.length
  var hasMustNot = gr.mustNotRules && gr.mustNotRules.length
  var hasNice = gr.niceToHave && gr.niceToHave.length
  if (hasMust || hasMustNot || hasNice) {
    if (hasMust) profileRulesText += 'MUST DO:\n' + gr.mustRules.map(function (r) { return '- ' + r }).join('\n') + '\n'
    if (hasMustNot) profileRulesText += 'MUST NOT DO:\n' + gr.mustNotRules.map(function (r) { return '- ' + r }).join('\n') + '\n'
    if (hasNice) profileRulesText += 'NICE TO HAVE:\n' + gr.niceToHave.map(function (r) { return '- ' + r }).join('\n') + '\n'
  }

  var prefsText = ''
  var prefs = profile.learnedPreferences || {}
  if (prefs.positivePatterns && prefs.positivePatterns.length) {
    prefsText += 'USER LIKES:\n' + prefs.positivePatterns.map(function (p) { return '- ' + p }).join('\n') + '\n'
  }
  if (prefs.negativePatterns && prefs.negativePatterns.length) {
    prefsText += 'USER DISLIKES:\n' + prefs.negativePatterns.map(function (p) { return '- ' + p }).join('\n') + '\n'
  }
  if (prefs.designPrefs && prefs.designPrefs.length) {
    prefsText += 'DESIGN PREFERENCES:\n' + prefs.designPrefs.map(function (p) { return '- ' + p }).join('\n') + '\n'
  }
  if (prefs.functionalPrefs && prefs.functionalPrefs.length) {
    prefsText += 'FUNCTIONAL PREFERENCES:\n' + prefs.functionalPrefs.map(function (p) { return '- ' + p }).join('\n') + '\n'
  }

  return {
    orgText: orgText,
    profileRulesText: profileRulesText,
    prefsText: prefsText,
    profileName: profile.name || ''
  }
}

/**
 * Inject profile context into a system prompt string.
 * Appends org context, global rules, and learned preferences if active.
 */
export function injectProfileContext(sysPrompt) {
  var ctx = getProfileContext()
  if (ctx.orgText) sysPrompt += '\n\nORGANIZATION CONTEXT (' + ctx.profileName + '):\n' + ctx.orgText
  if (ctx.profileRulesText) sysPrompt += '\n\nGLOBAL RULES (' + ctx.profileName + ' \u2014 always apply):\n' + ctx.profileRulesText
  if (ctx.prefsText) sysPrompt += '\n\nLEARNED PREFERENCES (from past builds \u2014 follow these patterns):\n' + ctx.prefsText
  return sysPrompt
}

/**
 * Merge profile global rules with per-thought project rules.
 * Returns { mustRules, mustNotRules, niceToHave } merged arrays.
 */
export function mergeRulesWithProfile(linkedRules) {
  var profile = getActiveProfile()
  var gr = (profile && profile.globalRules) || {}
  var lr = linkedRules || {}
  return {
    mustRules: (gr.mustRules || []).concat(lr.mustRules || []),
    mustNotRules: (gr.mustNotRules || []).concat(lr.mustNotRules || []),
    niceToHave: (gr.niceToHave || []).concat(lr.niceToHave || [])
  }
}

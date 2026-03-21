import { getActiveProfile } from './state.js'
import { resolveThemeVars, resolveAccentColor } from './design-tokens.js'

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
 * Format a think engine brief into structured markdown for injection into build prompts.
 * Preserves all fields including technical constraints that were previously lost.
 */
export function formatBriefForPrompt(brief) {
  if (!brief) return 'No specification provided'
  var lines = []
  lines.push('## APP SPECIFICATION')
  lines.push('**Name:** ' + (brief.name || 'App'))
  if (brief.audience) lines.push('**Audience:** ' + brief.audience)
  if (brief.whatItDoes && brief.whatItDoes.length) {
    lines.push('\n### MUST BUILD')
    for (var i = 0; i < brief.whatItDoes.length; i++) lines.push('- ' + brief.whatItDoes[i])
  }
  if (brief.features && brief.features.length) {
    lines.push('\n### KEY FEATURES')
    for (var j = 0; j < brief.features.length; j++) lines.push('- ' + brief.features[j])
  }
  if (brief.whatItWontDo && brief.whatItWontDo.length) {
    lines.push('\n### MUST EXCLUDE')
    for (var k = 0; k < brief.whatItWontDo.length; k++) lines.push('- ' + brief.whatItWontDo[k])
  }
  if (brief.design) {
    lines.push('\n### DESIGN SYSTEM')
    if (brief.design.theme) lines.push('- Theme: ' + brief.design.theme)
    if (brief.design.accent) lines.push('- Accent: ' + brief.design.accent)
    if (brief.design.layout) lines.push('- Layout: ' + brief.design.layout)
  }
  if (brief.technical) {
    lines.push('\n### TECHNICAL')
    if (brief.technical.storage) lines.push('- Storage: ' + brief.technical.storage)
    if (brief.technical.offline !== undefined) lines.push('- Offline: ' + brief.technical.offline)
  }
  return lines.join('\n')
}

/**
 * Format a think engine brief with conversation highlights for richer context.
 * Includes the structured spec from formatBriefForPrompt plus key user statements
 * from the ideation conversation history.
 */
export function formatBriefWithConversation(thought) {
  if (!thought) return 'No specification provided'
  var specText = formatBriefForPrompt(thought.brief)
  var conv = thought.conversation || []
  if (!conv.length) return specText

  // Extract substantive user messages (skip short ones and system markers)
  var userMsgs = []
  for (var i = 0; i < conv.length; i++) {
    var c = conv[i]
    if (c.role !== 'user') continue
    var txt = (c.text || '').trim()
    if (txt.length < 15) continue
    if (txt.indexOf('[Round reset') === 0) continue
    if (txt.indexOf('Round:') === 0) continue
    if (txt === 'Confirmed. Lock in this specification.') continue
    userMsgs.push(txt)
  }

  if (!userMsgs.length) return specText

  // Sort by length descending and take top 5 most substantive
  userMsgs.sort(function (a, b) { return b.length - a.length })
  userMsgs = userMsgs.slice(0, 5)

  var lines = [specText, '\n### IDEATION CONTEXT', 'Key points from the user\'s ideation session:']
  for (var j = 0; j < userMsgs.length; j++) {
    var excerpt = userMsgs[j].length > 200 ? userMsgs[j].slice(0, 200) + '\u2026' : userMsgs[j]
    lines.push('- "' + excerpt + '"')
  }
  return lines.join('\n')
}

/**
 * Extract design overrides from a thought, with org brand identity as fallback.
 * Returns { theme, accent, layout } or null if no design info is available.
 */
export function getThoughtDesignOverrides(thought) {
  var design = (thought && thought.brief && thought.brief.design) || null
  var profile = getActiveProfile()
  var brand = (profile && profile.orgProfile && profile.orgProfile.brandIdentity) || null

  // If thought has design, use it (with brand fallbacks for missing fields)
  if (design) {
    return {
      theme: design.theme || (brand && brand.theme) || null,
      accent: design.accent || (brand && brand.accentColor) || null,
      layout: design.layout || null
    }
  }

  // Fall back to org brand identity if no thought design
  if (brand && (brand.theme || brand.accentColor)) {
    return {
      theme: brand.theme || null,
      accent: brand.accentColor || null,
      layout: null
    }
  }

  return null
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

/**
 * Format thought design preferences into explicit CSS variable instructions.
 * These instructions are injected alongside the template skeleton to ensure
 * the LLM maintains the design tokens even if it rewrites the CSS.
 *
 * @param {object} design - { theme, accent, layout } from thought brief
 * @returns {string} Instruction block or '' if no design prefs
 */
export function formatDesignAsCSS(design) {
  if (!design) return ''
  var lines = ['### CSS DESIGN VARIABLES (apply these to the :root block)']
  if (design.theme) {
    var themeVars = resolveThemeVars(design.theme)
    if (themeVars) {
      lines.push('--bg: ' + themeVars.bg + ';')
      lines.push('--surface: ' + themeVars.surface + ';')
      lines.push('--text: ' + themeVars.text + ';')
      lines.push('--text2: ' + themeVars.text2 + ';')
      lines.push('--border: ' + themeVars.border + ';')
    }
  }
  if (design.accent) {
    var hex = resolveAccentColor(design.accent)
    if (hex) lines.push('--accent: ' + hex + ';')
  }
  if (design.layout) {
    lines.push('Layout approach: ' + design.layout)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

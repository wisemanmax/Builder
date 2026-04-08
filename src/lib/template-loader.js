import { resolveThemeVars, resolveAccentColor } from './design-tokens.js'

// Lazy-fetch template skeletons from external HTML files with in-memory cache
var _cache = {}

// Separate cache for runtime assets (bridge workflow YAML, gh-client.js, etc.)
// shipped under public/templates/runtime/.
var _runtimeCache = {}

/**
 * Fetch a runtime asset by filename (e.g. 'builder-bridge.workflow.yml',
 * 'gh-client.js', 'auth-bootstrap.html'). Files live at ./templates/runtime/
 * and are used by the GitHub-as-runtime pipeline (C1–C6 in the implementation plan).
 * Returns a Promise resolving to the file contents as a string.
 */
export function getRuntimeAsset(filename) {
  if (_runtimeCache[filename]) return Promise.resolve(_runtimeCache[filename])
  return fetch('./templates/runtime/' + filename)
    .then(function (res) {
      if (!res.ok) throw new Error('Runtime asset not found: ' + filename)
      return res.text()
    })
    .then(function (text) {
      _runtimeCache[filename] = text
      return text
    })
}

/**
 * Fetch a template skeleton HTML by id.
 * Files live at ./templates/{id}.html (served from public/).
 * Returns a Promise resolving to the HTML string.
 */
export function getTemplateSkeleton(id) {
  if (_cache[id]) return Promise.resolve(_cache[id])
  return fetch('./templates/' + id + '.html')
    .then(function (res) {
      if (!res.ok) throw new Error('Template not found: ' + id)
      return res.text()
    })
    .then(function (html) {
      _cache[id] = html
      return html
    })
}

/**
 * Customize a template skeleton's CSS variables based on thought design preferences.
 * Uses shared design-tokens maps for theme/accent resolution.
 *
 * @param {string} skeletonHtml - The full template HTML string
 * @param {object} design - { theme: string, accent: string, layout: string }
 * @returns {string} Modified HTML with updated CSS variables
 */
export function customizeTemplateCss(skeletonHtml, design) {
  if (!design) return skeletonHtml

  // Build override map from design properties
  var overrides = {}

  // Apply theme via shared resolver
  if (design.theme) {
    var themeVars = resolveThemeVars(design.theme)
    if (themeVars) {
      overrides['--bg'] = themeVars.bg
      overrides['--surface'] = themeVars.surface
      overrides['--text'] = themeVars.text
      overrides['--text2'] = themeVars.text2
      overrides['--border'] = themeVars.border
    }
  }

  // Apply accent via shared resolver
  if (design.accent) {
    var hex = resolveAccentColor(design.accent)
    if (hex) overrides['--accent'] = hex
  }

  if (!Object.keys(overrides).length) return skeletonHtml

  // Find and replace values in the :root{} block
  return skeletonHtml.replace(/:root\s*\{([^}]*)\}/, function (match, content) {
    var updated = content
    for (var varName in overrides) {
      var varPattern = new RegExp('(' + varName.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;]+)')
      if (varPattern.test(updated)) {
        updated = updated.replace(varPattern, '$1' + overrides[varName])
      } else {
        updated = varName + ':' + overrides[varName] + ';' + updated
      }
    }
    return ':root{' + updated + '}'
  })
}

/**
 * Extract CSS from a template skeleton into a separate block.
 * Returns { css: string, html: string } where css is the content of <style> tags
 * and html is the skeleton with <style> tags removed.
 */
export function extractTemplateCss(skeletonHtml) {
  var css = ''
  var html = skeletonHtml

  // Extract all <style> blocks
  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (match, content) {
    css += content.trim() + '\n'
    return '<!-- CSS extracted -->'
  })

  return { css: css.trim(), html: html }
}

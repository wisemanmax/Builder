// Patch Contract System — structured contract between audit and fix stages
// Generates a scoped patch plan from audit findings, validates it deterministically,
// then validates the resulting code diff against the plan.

import { callClaudeRaw } from './ai.js'
import { uid } from './utils.js'
import { SYS_PATCH_PLAN } from '../config/prompts.js'

// ── Internal: djb2 hash → 8-char hex fingerprint ──────────────────────
function simpleHash(text) {
  var hash = 5381
  for (var i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ── Section extraction helpers ─────────────────────────────────────────
function extractStyle(html) {
  var m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  return m ? m[1] : ''
}

function extractScript(html) {
  var m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  return m ? m[1] : ''
}

function extractHtmlBody(html) {
  // Content between </style> and <script>, roughly the HTML body
  var noStyle = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<!--STYLE-->')
  var noScript = noStyle.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<!--SCRIPT-->')
  return noScript
}

function extractFunctionNames(scriptText) {
  var names = []
  var re = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
  var m
  while ((m = re.exec(scriptText)) !== null) {
    if (names.indexOf(m[1]) === -1) names.push(m[1])
  }
  return names
}

function extractCssVariables(styleText) {
  var vars = []
  var re = /(--[a-zA-Z0-9_-]+)\s*:/g
  var m
  while ((m = re.exec(styleText)) !== null) {
    if (vars.indexOf(m[1]) === -1) vars.push(m[1])
  }
  return vars
}

function extractLocalStorageKeys(scriptText) {
  var keys = []
  var re = /localStorage\.\w+\(\s*['"]([^'"]+)['"]/g
  var m
  while ((m = re.exec(scriptText)) !== null) {
    if (keys.indexOf(m[1]) === -1) keys.push(m[1])
  }
  return keys
}

function extractExternalImports(html) {
  var imports = []
  var re = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi
  var m
  while ((m = re.exec(html)) !== null) {
    imports.push(m[1])
  }
  var re2 = /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi
  while ((m = re2.exec(html)) !== null) {
    imports.push(m[1])
  }
  var re3 = /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi
  while ((m = re3.exec(html)) !== null) {
    if (imports.indexOf(m[1]) === -1) imports.push(m[1])
  }
  return imports
}

// ── Simple line diff (adapted from quick-edit.js) ──────────────────────
function countLineDiffs(oldText, newText) {
  var oldLines = oldText.split('\n')
  var newLines = newText.split('\n')
  var maxLen = Math.max(oldLines.length, newLines.length)
  var added = 0
  var removed = 0
  var oi = 0
  var ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      oi++
      ni++
    } else {
      var foundOld = -1
      var foundNew = -1
      var searchRange = Math.min(20, maxLen)
      for (var s = 1; s <= searchRange; s++) {
        if (foundNew === -1 && ni + s < newLines.length && oi < oldLines.length && newLines[ni + s] === oldLines[oi]) {
          foundNew = ni + s
        }
        if (foundOld === -1 && oi + s < oldLines.length && ni < newLines.length && oldLines[oi + s] === newLines[ni]) {
          foundOld = oi + s
        }
        if (foundOld !== -1 || foundNew !== -1) break
      }
      if (foundOld !== -1 && (foundNew === -1 || foundOld - oi <= foundNew - ni)) {
        while (oi < foundOld) {
          removed++
          oi++
        }
      } else if (foundNew !== -1) {
        while (ni < foundNew) {
          added++
          ni++
        }
      } else {
        if (oi < oldLines.length) { removed++; oi++ }
        if (ni < newLines.length) { added++; ni++ }
      }
    }
  }
  return { added: added, removed: removed, total: added + removed }
}

// ── computeCodeDelta ───────────────────────────────────────────────────
export function computeCodeDelta(oldCode, newCode) {
  var oldStyle = extractStyle(oldCode)
  var newStyle = extractStyle(newCode)
  var oldScript = extractScript(oldCode)
  var newScript = extractScript(newCode)
  var oldHtml = extractHtmlBody(oldCode)
  var newHtml = extractHtmlBody(newCode)

  var styleDiff = countLineDiffs(oldStyle, newStyle)
  var scriptDiff = countLineDiffs(oldScript, newScript)
  var htmlDiff = countLineDiffs(oldHtml, newHtml)

  var sectionsChanged = []
  if (styleDiff.total > 0) sectionsChanged.push('style')
  if (htmlDiff.total > 0) sectionsChanged.push('html')
  if (scriptDiff.total > 0) sectionsChanged.push('script')

  var oldFns = extractFunctionNames(oldScript)
  var newFns = extractFunctionNames(newScript)
  var functionsAdded = newFns.filter(function (f) { return oldFns.indexOf(f) === -1 })
  var functionsRemoved = oldFns.filter(function (f) { return newFns.indexOf(f) === -1 })

  var oldImports = extractExternalImports(oldCode)
  var newImports = extractExternalImports(newCode)
  var addedImports = newImports.filter(function (i) { return oldImports.indexOf(i) === -1 })

  return {
    totalLinesChanged: styleDiff.total + scriptDiff.total + htmlDiff.total,
    sectionsChanged: sectionsChanged,
    functionsAdded: functionsAdded,
    functionsRemoved: functionsRemoved,
    newImports: addedImports,
    perSection: {
      style: styleDiff,
      html: htmlDiff,
      script: scriptDiff,
    },
  }
}

// ── generatePatchPlan ──────────────────────────────────────────────────
export function generatePatchPlan(auditBugs, code, specText, rulesText, retryReason) {
  var auditText = auditBugs.map(function (b, i) {
    return (i + 1) + '. [' + (b.severity || 'medium').toUpperCase() + '] ' + (b.issue || '') + ' \u2014 ' + (b.location || '')
  }).join('\n')
  var auditHash = simpleHash(auditText)

  var msg = 'AUDIT FINDINGS:\n' + auditText +
    '\n\nSOURCE CODE:\n' + code.slice(0, 40000)

  if (specText) msg += '\n\nAPP SPECIFICATION:\n' + specText.slice(0, 4000)
  if (rulesText) msg += '\n\nDESIGN RULES:\n' + rulesText.slice(0, 2000)
  if (retryReason) msg += '\n\nPREVIOUS PLAN WAS REJECTED: ' + retryReason + '\nPlease fix this issue in your new plan.'

  return callClaudeRaw(SYS_PATCH_PLAN, msg, 3000)
    .then(function (raw) {
      try {
        var plan = JSON.parse(raw)
        // Inject server-side values (don't trust LLM for these)
        plan.plan_id = 'pc_' + uid()
        plan.audit_hash = auditHash
        return plan
      } catch (e) {
        return null
      }
    })
    .catch(function () {
      return null
    })
}

// ── validatePatchPlan ──────────────────────────────────────────────────
export function validatePatchPlan(plan, auditText, auditBugs) {
  // 1. Schema compliance
  if (!plan || typeof plan !== 'object') {
    return { ok: false, reason: 'Plan is not an object' }
  }
  if (!plan.scope || typeof plan.scope !== 'object') {
    return { ok: false, reason: 'Missing plan.scope' }
  }
  if (!Array.isArray(plan.changes) || plan.changes.length === 0) {
    return { ok: false, reason: 'plan.changes must be a non-empty array' }
  }
  if (!plan.constraints || typeof plan.constraints !== 'object') {
    return { ok: false, reason: 'Missing plan.constraints' }
  }
  var validRisks = ['low', 'medium', 'high']
  if (validRisks.indexOf(plan.estimated_risk) === -1) {
    return { ok: false, reason: 'estimated_risk must be low, medium, or high' }
  }

  // 2. Audit hash match
  if (plan.audit_hash !== simpleHash(auditText)) {
    return { ok: false, reason: 'Audit hash mismatch' }
  }

  // 3. Section consistency
  var touched = Array.isArray(plan.scope.sections_touched) ? plan.scope.sections_touched : []
  var noTouch = Array.isArray(plan.scope.sections_no_touch) ? plan.scope.sections_no_touch : []
  for (var i = 0; i < plan.changes.length; i++) {
    var c = plan.changes[i]
    if (c.section && touched.indexOf(c.section) === -1) {
      return { ok: false, reason: 'Change "' + (c.id || i) + '" targets section "' + c.section + '" not in sections_touched' }
    }
  }

  // 4. No overlap between touched and no_touch
  for (var j = 0; j < touched.length; j++) {
    if (noTouch.indexOf(touched[j]) !== -1) {
      return { ok: false, reason: 'Section "' + touched[j] + '" in both sections_touched and sections_no_touch' }
    }
  }

  // 5. Risk gate
  if (plan.estimated_risk === 'high' && plan.changes.length > 5) {
    return { ok: false, reason: 'High-risk plans must have 5 or fewer changes' }
  }

  // 6. Coverage — every high-severity audit bug should appear in changes or rejected_audit_items
  var rejected = Array.isArray(plan.rejected_audit_items) ? plan.rejected_audit_items : []
  var allRefs = plan.changes.map(function (c) { return (c.audit_ref || '').toLowerCase() })
    .concat(rejected.map(function (r) { return (r.audit_ref || '').toLowerCase() }))

  for (var k = 0; k < auditBugs.length; k++) {
    if (auditBugs[k].severity === 'high') {
      var bugPrefix = (k + 1) + '.'
      var bugIssue = (auditBugs[k].issue || '').toLowerCase().slice(0, 40)
      var found = false
      for (var r = 0; r < allRefs.length; r++) {
        if (allRefs[r].indexOf(bugPrefix) !== -1 || allRefs[r].indexOf(bugIssue) !== -1) {
          found = true
          break
        }
      }
      if (!found) {
        return { ok: false, reason: 'High-severity audit bug #' + (k + 1) + ' not covered in plan changes or rejected items' }
      }
    }
  }

  // 7. Line budget sanity
  var maxLines = plan.scope.max_lines_changed
  if (typeof maxLines !== 'number' || maxLines < 1 || maxLines > 500) {
    return { ok: false, reason: 'max_lines_changed must be between 1 and 500' }
  }

  return { ok: true }
}

// ── validatePatchDiff ──────────────────────────────────────────────────
export function validatePatchDiff(oldCode, newCode, plan) {
  var delta = computeCodeDelta(oldCode, newCode)
  var noTouch = Array.isArray(plan.scope.sections_no_touch) ? plan.scope.sections_no_touch : []

  // 1. Section scope — sections in no_touch must be unchanged
  for (var i = 0; i < noTouch.length; i++) {
    if (delta.sectionsChanged.indexOf(noTouch[i]) !== -1) {
      return { ok: false, reason: 'Section "' + noTouch[i] + '" was modified but is in sections_no_touch', stats: delta }
    }
  }

  // 2. Line budget (with 50% grace margin)
  var maxLines = plan.scope.max_lines_changed || 100
  var budgetLimit = Math.ceil(maxLines * 1.5)
  if (delta.totalLinesChanged > budgetLimit) {
    return { ok: false, reason: 'Diff exceeds line budget: ' + delta.totalLinesChanged + ' > ' + budgetLimit + ' (budget ' + maxLines + ' + 50% grace)', stats: delta }
  }

  // 3. No new external dependencies
  if (plan.constraints.no_new_dependencies && delta.newImports.length > 0) {
    return { ok: false, reason: 'New external import added: ' + delta.newImports[0], stats: delta }
  }

  // 4. Preserved CSS variables
  if (plan.constraints.preserve_css_variables) {
    var oldVars = extractCssVariables(extractStyle(oldCode))
    var newVars = extractCssVariables(extractStyle(newCode))
    for (var v = 0; v < oldVars.length; v++) {
      if (newVars.indexOf(oldVars[v]) === -1) {
        return { ok: false, reason: 'CSS variable removed: ' + oldVars[v], stats: delta }
      }
    }
  }

  // 5. Preserved localStorage keys
  if (plan.constraints.preserve_localstorage_keys) {
    var oldKeys = extractLocalStorageKeys(extractScript(oldCode))
    var newKeys = extractLocalStorageKeys(extractScript(newCode))
    for (var lk = 0; lk < oldKeys.length; lk++) {
      if (newKeys.indexOf(oldKeys[lk]) === -1) {
        return { ok: false, reason: 'localStorage key removed: ' + oldKeys[lk], stats: delta }
      }
    }
  }

  // 6. No removed functions
  if (plan.constraints.no_remove_functions && delta.functionsRemoved.length > 0) {
    return { ok: false, reason: 'Function removed: ' + delta.functionsRemoved[0], stats: delta }
  }

  return { ok: true, stats: delta }
}

// ── formatPlanForFixPrompt ─────────────────────────────────────────────
export function formatPlanForFixPrompt(plan) {
  var lines = []
  lines.push('PATCH CONTRACT:')
  lines.push('Summary: ' + (plan.summary || 'Fix audit issues'))

  var touched = Array.isArray(plan.scope.sections_touched) ? plan.scope.sections_touched : []
  var noTouch = Array.isArray(plan.scope.sections_no_touch) ? plan.scope.sections_no_touch : []
  var fns = Array.isArray(plan.scope.functions_touched) ? plan.scope.functions_touched : []

  if (touched.length) lines.push('Sections you MAY change: ' + touched.join(', '))
  if (noTouch.length) lines.push('Sections you MUST NOT change: ' + noTouch.join(', '))
  if (fns.length) lines.push('Functions to touch: ' + fns.join(', '))
  lines.push('Line budget: ~' + (plan.scope.max_lines_changed || 'unspecified') + ' lines')

  lines.push('')
  lines.push('PLANNED CHANGES:')
  for (var i = 0; i < plan.changes.length; i++) {
    var c = plan.changes[i]
    lines.push((i + 1) + '. [' + (c.type || 'fix') + '] ' + (c.intent || '') + (c.section ? ' (section: ' + c.section + ')' : ''))
  }

  var constraints = []
  if (plan.constraints.no_new_dependencies) constraints.push('Do not add external dependencies')
  if (plan.constraints.no_remove_functions) constraints.push('Do not remove existing functions')
  if (plan.constraints.preserve_css_variables) constraints.push('Preserve all CSS custom properties (--var declarations)')
  if (plan.constraints.preserve_localstorage_keys) constraints.push('Preserve all localStorage keys')
  if (plan.constraints.no_structural_html_changes) constraints.push('Do not change HTML structure')
  if (constraints.length) {
    lines.push('')
    lines.push('CONSTRAINTS:')
    for (var ci = 0; ci < constraints.length; ci++) {
      lines.push('- ' + constraints[ci])
    }
  }

  var rejected = Array.isArray(plan.rejected_audit_items) ? plan.rejected_audit_items : []
  if (rejected.length) {
    lines.push('')
    lines.push('REJECTED ITEMS (do NOT fix these):')
    for (var ri = 0; ri < rejected.length; ri++) {
      lines.push('- ' + (rejected[ri].audit_ref || '') + ' \u2014 ' + (rejected[ri].reason || 'out of scope'))
    }
  }

  return lines.join('\n')
}

// Quick Edit Pipeline — 3-step fast pipeline for small changes (5-15 seconds)
// Bypasses GPT audit, enhancement review, GitHub push, and approval gate

import {
  ADVISORY_CHECK_IDS,
  ST,
  persist,
  checkPipelineCancel,
  clearPipelineCancel,
  $,
  esc,
  toast,
  scrubKeys,
  SYS_UPDATE,
  callClaudeWithThinkingStream,
  modelStream,
  selectedModelLabel,
  resetCostAccum,
  calculateBuildCost,
  runLocalChecks,
  addMsg,
  updatePS,
  clearPipelineSteps,
  createStreamingPreview,
  autoInjectSupabase,
  renderGrid,
  pushToSupabase,
  injectProfileContext,
  telemetry,
} from './pipeline-shared.js'

var SYS_CSS_EDIT =
  'You are editing ONLY the <style> section of a single-file HTML app. The user wants a CSS-only change.\n' +
  'RULES:\n' +
  '1. Return the COMPLETE HTML file starting with <!DOCTYPE html>\n' +
  '2. Modify ONLY CSS inside <style> tags \u2014 do NOT change any HTML structure or JavaScript\n' +
  '3. Preserve all existing functionality, event handlers, and DOM structure\n' +
  '4. All CSS inside <style>, all JS inside <script>\n' +
  '5. ZERO external dependencies'

var SYS_TEXT_EDIT =
  'You are editing ONLY the text content of a single-file HTML app. The user wants a text/content change.\n' +
  'RULES:\n' +
  '1. Return the COMPLETE HTML file starting with <!DOCTYPE html>\n' +
  '2. Modify ONLY text content, labels, headings, placeholder text, or demo data\n' +
  '3. Do NOT change CSS styles, JavaScript logic, or HTML structure/attributes\n' +
  '4. Preserve all existing functionality and event handlers\n' +
  '5. All CSS inside <style>, all JS inside <script>'

export var QUICK_EDIT_NAMES = ['AI \u00B7 Edit', 'Automated Checks', 'Save']
export var QUICK_EDIT_ICONS = ['\u270F\uFE0F', '\uD83D\uDCCB', '\u2705']

/**
 * Generate a simple line-based diff between old and new code.
 * Returns HTML showing added/removed/context lines.
 */
function generateDiffHtml(oldCode, newCode) {
  var oldLines = oldCode.split('\n')
  var newLines = newCode.split('\n')
  var diffs = []
  var contextSize = 2

  // Simple LCS-based diff: find changed regions
  var maxLen = Math.max(oldLines.length, newLines.length)
  var changes = []
  var oi = 0,
    ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      changes.push({ type: 'ctx', line: oldLines[oi], oldNum: oi + 1, newNum: ni + 1 })
      oi++
      ni++
    } else {
      // Find next matching line
      var foundOld = -1,
        foundNew = -1
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
        // Lines were removed from old
        while (oi < foundOld) {
          changes.push({ type: 'rm', line: oldLines[oi], oldNum: oi + 1 })
          oi++
        }
      } else if (foundNew !== -1) {
        // Lines were added in new
        while (ni < foundNew) {
          changes.push({ type: 'add', line: newLines[ni], newNum: ni + 1 })
          ni++
        }
      } else {
        // Replace
        if (oi < oldLines.length) {
          changes.push({ type: 'rm', line: oldLines[oi], oldNum: oi + 1 })
          oi++
        }
        if (ni < newLines.length) {
          changes.push({ type: 'add', line: newLines[ni], newNum: ni + 1 })
          ni++
        }
      }
    }
  }

  // Collapse context lines, show only those near changes
  var result = []
  var totalAdded = 0,
    totalRemoved = 0
  for (var i = 0; i < changes.length; i++) {
    if (changes[i].type !== 'ctx') {
      if (changes[i].type === 'add') totalAdded++
      if (changes[i].type === 'rm') totalRemoved++
      // Include surrounding context
      var start = Math.max(0, i - contextSize)
      var end = Math.min(changes.length - 1, i + contextSize)
      for (var j = start; j <= end; j++) {
        if (result.indexOf(j) === -1) result.push(j)
      }
    }
  }
  result.sort(function (a, b) {
    return a - b
  })

  if (result.length === 0) return ''

  var html = '<div class="diff-view">'
  html += '<div class="diff-header">' + totalAdded + ' added, ' + totalRemoved + ' removed</div>'
  var lastIdx = -1
  for (var r = 0; r < result.length; r++) {
    var idx = result[r]
    if (lastIdx !== -1 && idx - lastIdx > 1) {
      html += '<div class="diff-line diff-ctx">\u22EF</div>'
    }
    var c = changes[idx]
    var lineText = esc(c.line.length > 200 ? c.line.slice(0, 200) + '\u2026' : c.line)
    if (c.type === 'add') {
      html += '<div class="diff-line diff-add">+ ' + lineText + '</div>'
    } else if (c.type === 'rm') {
      html += '<div class="diff-line diff-rm">- ' + lineText + '</div>'
    } else {
      html += '<div class="diff-line diff-ctx">  ' + lineText + '</div>'
    }
    lastIdx = idx
  }
  html += '</div>'
  return html
}

export function runQuickEdit(prompt, existingApp, images, editMode) {
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  var sb = $('send-btn')
  if (sb) sb.disabled = true
  var pid = 'qe' + Date.now()

  var modeLabel = editMode === 'css-only' ? 'CSS' : editMode === 'text-only' ? 'Text' : 'Edit'
  var editNames = ['Claude \u00B7 ' + modeLabel, 'Automated Checks', 'Save']
  addMsg({ role: 'asst', type: 'pipeline', id: pid, names: editNames, icons: QUICK_EDIT_ICONS })

  var appId = existingApp.id
  var appName = existingApp.name
  var v2

  // Track this as a post-build edit on the most recent build record
  telemetry.incrementEditCount(appId)
  telemetry.emit('user.edit_after', { appId: appId, editMode: editMode || 'default' })

  // Step 0 — Claude Edit
  var editLabel = editMode === 'css-only' ? 'CSS edit' : editMode === 'text-only' ? 'text edit' : 'editing'
  updatePS(pid, 0, 'active', 'Claude is applying ' + editLabel + '\u2026')

  var currentCode = existingApp.code || ''
  var prevPrompts = (existingApp.prompts || [])
    .map(function (p) {
      return p.text
    })
    .join('\n\u2192 ')

  var changeLabel =
    editMode === 'css-only' ? 'CSS CHANGE REQUEST' : editMode === 'text-only' ? 'TEXT CHANGE REQUEST' : 'CHANGE REQUEST'
  var userMsg =
    changeLabel +
    ': ' +
    prompt +
    (prevPrompts ? '\n\nBUILD HISTORY:\n' + prevPrompts : '') +
    '\n\nCURRENT APP CODE:\n' +
    currentCode.slice(0, 120000) +
    '\n\nApply the requested change to the existing code above. Return the complete modified HTML.'

  // Use targeted system prompt based on edit mode
  var baseSys = editMode === 'css-only' ? SYS_CSS_EDIT : editMode === 'text-only' ? SYS_TEXT_EDIT : SYS_UPDATE
  var effectiveSys = injectProfileContext(baseSys)
  var charCount = 0

  // Set up streaming preview
  var previewCtrl = null
  var previewIframe = $('viewer-iframe')
  if (previewIframe) {
    previewCtrl = createStreamingPreview('viewer-iframe')
  }

  var thinkBudget = editMode === 'css-only' || editMode === 'text-only' ? 2000 : 4000
  modelStream(
    effectiveSys,
    userMsg,
    thinkBudget,
    function (type, text) {
      if (type === 'text') {
        charCount += text.length
        updatePS(pid, 0, 'active', 'Editing\u2026 ' + Math.round(charCount / 1000) + 'k chars')
        if (previewCtrl) previewCtrl.pushChunk(text)
      }
    },
    images
  )
    .then(function (code) {
      v2 = code
      // Supabase auto-injection
      if (v2 && ST.backendEnabled && ST.sbUrl) {
        v2 = autoInjectSupabase(v2)
      }
      updatePS(pid, 0, 'done', 'Edit complete \u2713')

      // Show diff of changes
      var diffHtml = generateDiffHtml(currentCode, v2)
      if (diffHtml) {
        addMsg({
          role: 'asst',
          type: 'text',
          html:
            '<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.5);margin-bottom:2px">Changes made:</div>' +
            diffHtml,
        })
      }

      // Step 1 — Automated Checks
      checkPipelineCancel()
      updatePS(pid, 1, 'active', 'Running checks\u2026')
      var checks = runLocalChecks(v2)
      var criticalFails = checks.filter(function (c) {
        return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
      })
      addMsg({ role: 'asst', type: 'checks', checks: checks })
      updatePS(
        pid,
        1,
        criticalFails.length ? 'warn' : 'done',
        criticalFails.length
          ? criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found'
          : 'All checks passed \u2713'
      )

      // Step 2 — Save locally
      updatePS(pid, 2, 'active', 'Saving\u2026')
      _saveQuickEdit(appId, v2, prompt, existingApp)

      // Finalize preview
      if (previewCtrl) {
        previewCtrl.finalize(v2)
        previewCtrl.destroy()
      }

      // Update iframe if in studio
      var iframe = $('viewer-iframe')
      if (iframe) iframe.srcdoc = v2

      updatePS(pid, 2, 'done', 'Saved \u2713')

      // Show cost
      var costData = calculateBuildCost()
      if (costData.breakdown.length > 0) {
        addMsg({ role: 'asst', type: 'cost', cost: costData })
      }

      var modeDesc = editMode === 'css-only' ? 'CSS Edit' : editMode === 'text-only' ? 'Text Edit' : 'Quick Edit'
      addMsg({
        role: 'asst',
        type: 'text',
        html:
          '<strong>' +
          esc(appName) +
          '</strong> updated \u2713' +
          '<div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:4px">' +
          modeDesc +
          ' \u2014 local save only. Use full pipeline for GitHub deployment.</div>',
      })
      toast('\u2713 ' + appName + ' updated!', 2500)
      renderGrid()
    })
    .catch(function (err) {
      if (previewCtrl) previewCtrl.destroy()
      if (err.message === 'PIPELINE_CANCELLED') {
        addMsg({ role: 'asst', type: 'text', text: 'Quick edit stopped.' })
        toast('Edit stopped', 3000)
      } else {
        var safeMsg = scrubKeys(err.message || String(err))
        addMsg({ role: 'asst', type: 'text', text: 'Quick edit error: ' + safeMsg })
        toast('Error: ' + safeMsg, 5000)
      }
    })
    .finally(function () {
      ST._building = false
      var sb2 = $('send-btn')
      if (sb2) sb2.disabled = false
      clearPipelineSteps()
    })
}

function _saveQuickEdit(id, code, prompt, existingApp) {
  var idx = -1
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === id) {
      idx = i
      break
    }
  }
  if (idx !== -1) {
    ST.apps[idx].versions = [{ code: ST.apps[idx].code, ts: ST.apps[idx].updatedAt }].concat(
      (ST.apps[idx].versions || []).slice(0, 9)
    )
    ST.apps[idx].prompts = (ST.apps[idx].prompts || []).concat([
      { text: prompt, ts: new Date().toISOString(), type: 'quick-edit' },
    ])
    ST.apps[idx].code = code
    ST.apps[idx].updatedAt = new Date().toISOString()
  }
  persist()
  var app = ST.apps[idx]
  if (app) pushToSupabase(app)
}

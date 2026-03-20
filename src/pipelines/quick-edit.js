// Quick Edit Pipeline — 3-step fast pipeline for small changes (5-15 seconds)
// Bypasses GPT audit, enhancement review, GitHub push, and approval gate

import { ST, persist, checkPipelineCancel, clearPipelineCancel, persistBuildSession, clearBuildSession } from '../lib/state.js'
import { $, esc, toast, scrubKeys } from '../lib/utils.js'
import { SYS_UPDATE } from '../config/prompts.js'
import { injectProfileContext } from '../lib/profile-context.js'
import { callClaudeWithThinkingStream, resetCostAccum } from '../lib/ai.js'
import { calculateBuildCost } from '../lib/cost.js'
import { runLocalChecks } from '../lib/checks.js'
import { addMsg, updatePS, scrollBot, clearPipelineSteps } from '../components/message.js'
import { pushToSupabase } from '../lib/storage.js'
import { renderGrid } from '../components/app-icon.js'
import { createStreamingPreview } from '../lib/streaming-preview.js'

var ADVISORY_CHECK_IDS = ['no-innerhtml-risk', 'fetch-calls', 'inline-styles', 'no-div-onclick', 'no-innerhtml-xss', 'has-css-vars', 'has-main', 'responsive-typography', 'touch-friendly-inputs']

export var QUICK_EDIT_NAMES = ['Claude \u00B7 Edit', 'Automated Checks', 'Save']
export var QUICK_EDIT_ICONS = ['\u270F\uFE0F', '\uD83D\uDCCB', '\u2705']

export function runQuickEdit(prompt, existingApp, images) {
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  var sb = $('send-btn'); if (sb) sb.disabled = true
  var pid = 'qe' + Date.now()

  addMsg({ role: 'asst', type: 'pipeline', id: pid, names: QUICK_EDIT_NAMES, icons: QUICK_EDIT_ICONS })

  var appId = existingApp.id
  var appName = existingApp.name
  var v2

  // Step 0 — Claude Edit
  updatePS(pid, 0, 'active', 'Claude is editing\u2026')

  var currentCode = existingApp.code || ''
  var prevPrompts = (existingApp.prompts || []).map(function (p) { return p.text }).join('\n\u2192 ')
  var userMsg = 'CHANGE REQUEST: ' + prompt
    + (prevPrompts ? '\n\nBUILD HISTORY:\n' + prevPrompts : '')
    + '\n\nCURRENT APP CODE:\n' + currentCode.slice(0, 120000)
    + '\n\nApply the requested change to the existing code above. Return the complete modified HTML.'

  var effectiveSys = injectProfileContext(SYS_UPDATE)
  var charCount = 0

  // Set up streaming preview
  var previewCtrl = null
  var previewIframe = $('viewer-iframe')
  if (previewIframe) {
    previewCtrl = createStreamingPreview('viewer-iframe')
  }

  callClaudeWithThinkingStream(effectiveSys, userMsg, 1000, function (type, text) {
    if (type === 'text') {
      charCount += text.length
      updatePS(pid, 0, 'active', 'Editing\u2026 ' + Math.round(charCount / 1000) + 'k chars')
      if (previewCtrl) previewCtrl.pushChunk(text)
    }
  }, images).then(function (code) {
    v2 = code
    updatePS(pid, 0, 'done', 'Edit complete \u2713')

    // Step 1 — Automated Checks
    checkPipelineCancel()
    updatePS(pid, 1, 'active', 'Running checks\u2026')
    var checks = runLocalChecks(v2)
    var criticalFails = checks.filter(function (c) { return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1 })
    addMsg({ role: 'asst', type: 'checks', checks: checks })
    updatePS(pid, 1, criticalFails.length ? 'warn' : 'done',
      criticalFails.length ? (criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found') : 'All checks passed \u2713')

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

    addMsg({
      role: 'asst', type: 'text',
      html: '<strong>' + esc(appName) + '</strong> updated \u2713'
        + '<div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:4px">Quick Edit \u2014 local save only. Use full pipeline for GitHub deployment.</div>'
    })
    toast('\u2713 ' + appName + ' updated!', 2500)
    renderGrid()
  }).catch(function (err) {
    if (previewCtrl) previewCtrl.destroy()
    if (err.message === 'PIPELINE_CANCELLED') {
      addMsg({ role: 'asst', type: 'text', text: 'Quick edit stopped.' })
      toast('Edit stopped', 3000)
    } else {
      var safeMsg = scrubKeys(err.message || String(err))
      addMsg({ role: 'asst', type: 'text', text: 'Quick edit error: ' + safeMsg })
      toast('Error: ' + safeMsg, 5000)
    }
  }).finally(function () {
    ST._building = false
    var sb2 = $('send-btn'); if (sb2) sb2.disabled = false
    clearPipelineSteps()
  })
}

function _saveQuickEdit(id, code, prompt, existingApp) {
  var idx = -1
  for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { idx = i; break } }
  if (idx !== -1) {
    ST.apps[idx].versions = [{ code: ST.apps[idx].code, ts: ST.apps[idx].updatedAt }].concat((ST.apps[idx].versions || []).slice(0, 9))
    ST.apps[idx].prompts = (ST.apps[idx].prompts || []).concat([{ text: prompt, ts: new Date().toISOString(), type: 'quick-edit' }])
    ST.apps[idx].code = code
    ST.apps[idx].updatedAt = new Date().toISOString()
  }
  persist()
  var app = ST.apps[idx]
  if (app) pushToSupabase(app)
}

import { ST, persist, checkPipelineCancel } from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { SYS_STITCH_ENHANCE, SYS_STITCH_VERIFY, GPT4O_STITCH_REVIEW, SYS_STITCH_FIX1, SYS_STITCH_FIX2 } from '../config/prompts-stitch.js'
import { PIPE5_STATUS, GRADS } from '../config/constants.js'
import { callClaudeRaw, callClaude, callGPTRaw2, fetchWithRetry, resetCostAccum } from '../lib/ai.js'
import { calculateBuildCost } from '../lib/cost.js'
import { injectProfileContext, mergeRulesWithProfile } from '../lib/profile-context.js'
import { runLocalChecks } from '../lib/checks.js'
import { updateStitchStage, updateStitchEstimate, updateStitchTime } from '../components/stitch-tracker.js'
import { addMsg, updatePS } from '../components/message.js'
import { ghCreateBranch, ghPushFile, ghGetFileSha, ghMergeBranch, ghDeleteBranch, ghPushManifest } from '../lib/github.js'
import { setPreview, clearPreview, waitForApproval } from '../components/approval-card.js'
import { showFeedbackCard } from '../components/feedback-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { openProjectSheet } from '../screens/project.js'
import { persistBuildSession, clearBuildSession, clearPipelineCancel } from '../lib/state.js'

// --- Stitch API helpers ---

var STITCH_API_BASE = 'https://api.stitch.ai/v1'

function stitchHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + ST.stitchKey
  }
}

function callStitchBlueprint(appDescription) {
  return fetchWithRetry(STITCH_API_BASE + '/blueprint', {
    method: 'POST',
    headers: stitchHeaders(),
    body: JSON.stringify({ description: appDescription, format: 'html' })
  }, 120000).then(function (r) {
    if (!r.ok) {
      return r.json().catch(function () { return {} }).then(function (e) {
        throw new Error('Stitch: ' + scrubKeys((e.error && e.error.message) || 'HTTP ' + r.status))
      })
    }
    return r.json()
  }).then(function (d) {
    var html = d.html || d.scaffold || d.code || ''
    if (!html || html.length < 50) {
      throw new Error('Stitch: Blueprint returned empty or invalid HTML')
    }
    return html
  })
}

// --- Progressive Learner storage ---

function storeInProgressiveLearner(runId, stageKey, data) {
  try {
    var plKey = 'bldr_pl_' + runId
    var existing = JSON.parse(localStorage.getItem(plKey) || '{}')
    existing[stageKey] = {
      data: data,
      ts: new Date().toISOString()
    }
    localStorage.setItem(plKey, JSON.stringify(existing))
  } catch (e) {
    // Storage quota — non-critical
    console.warn('[Stitch PL] Storage failed for ' + stageKey + ':', e.message)
  }
}

// --- Retry logic with exponential backoff & rate limit handling ---

function retryStage(fn, stageName, maxRetries, statusCallback) {
  maxRetries = maxRetries || 2
  function attempt(n) {
    return fn().catch(function (e) {
      var msg = String(e && e.message || e || '').toLowerCase()
      var isRateLimit = msg.indexOf('rate') >= 0 || msg.indexOf('429') >= 0 || msg.indexOf('too many') >= 0
      var isRetryable = isRateLimit
        || msg.indexOf('timed out') >= 0
        || msg.indexOf('network') >= 0
        || msg.indexOf('failed to fetch') >= 0
        || msg.indexOf('load failed') >= 0
        || msg.indexOf('aborted') >= 0
        || msg.indexOf('overloaded') >= 0
        || msg.indexOf('529') >= 0

      if (isRetryable && n < maxRetries) {
        var delay = isRateLimit
          ? Math.min(5000 * Math.pow(2, n), 60000)
          : Math.min(3000 * Math.pow(2, n), 30000)

        console.warn('[Stitch] ' + stageName + ' failed (attempt ' + (n + 1) + '/' + (maxRetries + 1) + '), retrying in ' + (delay / 1000) + 's:', e.message)

        if (isRateLimit && statusCallback) {
          statusCallback('Waiting for API (' + Math.round(delay / 1000) + 's)…')
        }

        return new Promise(function (resolve) { setTimeout(resolve, delay) }).then(function () {
          // Wait for visibility if tab is backgrounded
          if (document.visibilityState !== 'visible') {
            return new Promise(function (resolve) {
              function onVis() {
                if (document.visibilityState === 'visible') {
                  document.removeEventListener('visibilitychange', onVis)
                  resolve()
                }
              }
              document.addEventListener('visibilitychange', onVis)
            })
          }
        }).then(function () { return attempt(n + 1) })
      }
      throw e
    })
  }
  return attempt(0)
}

// --- Stage implementations ---

/**
 * Stage 1 — Intake
 * Pull Thought Engine output + user rules, prep full context payload.
 */
function runIntake(context) {
  var activeThought = context.activeThought || null
  var specText = 'No specification provided'
  var rulesText = 'No specific rules'

  if (activeThought) {
    // Extract specification from thought brief
    if (activeThought.brief) {
      specText = 'App Name: ' + (activeThought.brief.name || 'App') + '\n'
        + 'What it does: ' + (activeThought.brief.whatItDoes || []).join(', ') + '\n'
        + 'What it won\'t do: ' + (activeThought.brief.whatItWontDo || []).join(', ') + '\n'
        + 'Target audience: ' + (activeThought.brief.audience || 'General') + '\n'
        + 'Key features: ' + (activeThought.brief.features || []).join(', ')
      if (activeThought.brief.design) {
        specText += '\nDesign: theme=' + (activeThought.brief.design.theme || 'dark')
          + ', accent=' + (activeThought.brief.design.accent || 'blue')
          + ', layout=' + (activeThought.brief.design.layout || 'standard')
      }
    }

    // Extract linked rules merged with profile global rules
    var linkedRules = activeThought.linkedRulesId
      ? ST.rules.find(function (r) { return r.id === activeThought.linkedRulesId })
      : null
    var merged = mergeRulesWithProfile(linkedRules)
    if (merged.mustRules.length || merged.mustNotRules.length) {
      rulesText = 'MUST DO:\n' + merged.mustRules.map(function (r) { return '- ' + r }).join('\n')
        + '\nMUST NOT DO:\n' + merged.mustNotRules.map(function (r) { return '- ' + r }).join('\n')
      if (merged.niceToHave.length) {
        rulesText += '\nNICE TO HAVE:\n' + merged.niceToHave.map(function (r) { return '- ' + r }).join('\n')
      }
    }
  }

  return {
    prompt: context.prompt,
    specText: specText,
    rulesText: rulesText,
    activeThought: activeThought,
    appDescription: _buildAppDescription(context, specText, rulesText)
  }
}

/**
 * Build a comprehensive app description from all context sources.
 */
function _buildAppDescription(context, specText, rulesText) {
  var desc = context.prompt || ''
  if (specText !== 'No specification provided') {
    desc += '\n\nAPP SPECIFICATION:\n' + specText
  }
  if (rulesText !== 'No specific rules') {
    desc += '\n\nDESIGN RULES:\n' + rulesText
  }
  return desc
}

/**
 * Stage 2 — Blueprint
 * Call Stitch API with app description → return HTML scaffold.
 */
function runBlueprint(intakePayload) {
  return callStitchBlueprint(intakePayload.appDescription)
}

/**
 * Stage 3 — Assemble
 * Pass Stitch HTML + full context to Claude Sonnet using SYS_STITCH_ENHANCE.
 */
function runAssemble(stitchHTML, intakePayload) {
  var sys = SYS_STITCH_ENHANCE

  // Inject user rules into system prompt
  if (intakePayload.rulesText !== 'No specific rules') {
    sys += '\n\nUSER RULES (follow these constraints strictly):\n' + intakePayload.rulesText
  }

  // Inject spec into system prompt
  if (intakePayload.specText !== 'No specification provided') {
    sys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + intakePayload.specText
  }

  // Inject profile context (org identity, global rules, learned preferences)
  sys = injectProfileContext(sys)

  var userMsg = 'STITCH BLUEPRINT (HTML scaffold to enhance with full logic):\n\n'
    + stitchHTML
    + '\n\nORIGINAL USER REQUEST:\n' + intakePayload.prompt

  return callClaude(sys, userMsg, 0.3)
}

/**
 * Stage 4 — Verify
 * Run automated checks → return checksReport JSON.
 */
function runVerify(assembledHTML) {
  // Run local static analysis checks
  var localChecks = runLocalChecks(assembledHTML)

  // Build structured report
  var htmlValidity = { passed: true, issues: [] }
  var brokenRefs = { passed: true, issues: [] }
  var accessibility = { passed: true, issues: [] }
  var responsive = { passed: true, issues: [] }
  var totalElements = 0
  var withHandlers = 0
  var orphaned = []

  for (var i = 0; i < localChecks.length; i++) {
    var c = localChecks[i]
    if (!c.passed) {
      var issue = c.label + (c.detail ? ' — ' + c.detail : '')
      if (c.cat === 'Syntax' || c.cat === 'Structure') {
        htmlValidity.passed = false
        htmlValidity.issues.push(issue)
      } else if (c.cat === 'Accessibility') {
        accessibility.passed = false
        accessibility.issues.push(issue)
      } else if (c.cat === 'Responsive') {
        responsive.passed = false
        responsive.issues.push(issue)
      } else {
        brokenRefs.issues.push(issue)
      }
    }
  }
  if (brokenRefs.issues.length) brokenRefs.passed = false

  // Count interactive elements in HTML
  var buttonMatches = assembledHTML.match(/<button[\s>]/gi)
  var inputMatches = assembledHTML.match(/<input[\s>]/gi)
  var formMatches = assembledHTML.match(/<form[\s>]/gi)
  var linkMatches = assembledHTML.match(/<a[\s][^>]*href/gi)
  totalElements = (buttonMatches ? buttonMatches.length : 0)
    + (inputMatches ? inputMatches.length : 0)
    + (formMatches ? formMatches.length : 0)
    + (linkMatches ? linkMatches.length : 0)

  // Check for addEventListener or onclick to estimate handler coverage
  var handlerMatches = assembledHTML.match(/addEventListener|onclick|onsubmit|onchange|oninput/gi)
  withHandlers = handlerMatches ? handlerMatches.length : 0

  var failCount = localChecks.filter(function (c) { return !c.passed }).length
  var totalCount = localChecks.length
  var score = totalCount > 0 ? Math.round(((totalCount - failCount) / totalCount) * 100) : 100

  return {
    valid: htmlValidity.passed,
    score: score,
    htmlValidity: htmlValidity,
    brokenReferences: brokenRefs,
    contentManifest: {
      totalElements: totalElements,
      withHandlers: withHandlers,
      orphaned: orphaned
    },
    accessibility: accessibility,
    responsive: responsive,
    logicCompleteness: {
      passed: /DOMContentLoaded/.test(assembledHTML) && /localStorage/.test(assembledHTML),
      issues: (!(/DOMContentLoaded/.test(assembledHTML)) ? ['Missing DOMContentLoaded init'] : [])
        .concat(!(/localStorage/.test(assembledHTML)) ? ['Missing localStorage persistence'] : [])
    },
    summary: score >= 80 ? 'Good quality — ' + failCount + ' minor issues' : 'Needs attention — ' + failCount + ' issues found',
    localChecks: localChecks
  }
}

/**
 * Stage 5 — Review
 * Send assembledHTML + checksReport to GPT-4o → parse reviewFindings[].
 */
function runReview(assembledHTML, checksReport) {
  var userMsg = 'HTML APP:\n\n' + assembledHTML.slice(0, 60000)
    + '\n\nCHECKS REPORT:\n' + JSON.stringify(checksReport, null, 2)
  return callGPTRaw2(GPT4O_STITCH_REVIEW, userMsg, 4000).then(function (raw) {
    try {
      var parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) parsed = []
      return parsed
    } catch (e) {
      // Try to extract JSON array from response
      var match = raw.match(/\[[\s\S]*\]/)
      if (match) {
        try { return JSON.parse(match[0]) } catch (e2) { /* fall through */ }
      }
      return []
    }
  })
}

/**
 * Populate the expandable findings panel in the stitch tracker.
 */
function populateReviewFindings(containerId, findings) {
  var body = $(containerId + '-review-body')
  if (!body) return
  if (!findings || !findings.length) {
    body.innerHTML = '<div class="stitch-review-empty">No issues found — app passed GPT-4o review.</div>'
    return
  }
  var html = ''
  var critCount = 0, warnCount = 0, infoCount = 0
  for (var i = 0; i < findings.length; i++) {
    var f = findings[i]
    var sev = (f.severity || 'info').toLowerCase()
    if (sev === 'critical') critCount++
    else if (sev === 'warning') warnCount++
    else infoCount++
    var sevColor = sev === 'critical' ? '#ff5252' : sev === 'warning' ? '#ffd600' : '#64b5f6'
    var sevIcon = sev === 'critical' ? '\u2717' : sev === 'warning' ? '\u26A0' : '\u2139'
    html += '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">'
      + '<div style="display:flex;align-items:center;gap:6px">'
      + '<span style="color:' + sevColor + ';font-size:11px;font-weight:700">' + sevIcon + ' ' + esc(sev.toUpperCase()) + '</span>'
      + '<span style="font-size:10px;color:rgba(255,255,255,.4);font-family:var(--fm)">' + esc(f.location || '') + '</span>'
      + '</div>'
      + '<div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px">' + esc(f.description || '') + '</div>'
      + (f.suggestedFix ? '<div style="font-size:10px;color:rgba(139,92,246,.7);margin-top:2px">Fix: ' + esc(f.suggestedFix) + '</div>' : '')
      + '</div>'
  }
  var summary = '<div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:6px">'
    + critCount + ' critical \u00B7 ' + warnCount + ' warning \u00B7 ' + infoCount + ' info'
    + '</div>'
  body.innerHTML = summary + html
}

/**
 * Stage 6 — Polish
 * Feed HTML + reviewFindings[] to Claude using SYS_STITCH_FIX1.
 * If critical findings existed, re-run Stage 4 checks — if issues remain fire SYS_STITCH_FIX2.
 */
function runPolish(assembledHTML, reviewFindings) {
  var hasCritical = reviewFindings.some(function (f) {
    return (f.severity || '').toLowerCase() === 'critical'
  })
  var hasWarning = reviewFindings.some(function (f) {
    return (f.severity || '').toLowerCase() === 'warning'
  })

  // If no critical/warning findings, skip polish
  if (!hasCritical && !hasWarning) {
    return Promise.resolve({ html: assembledHTML, secondPass: false })
  }

  var findingsText = JSON.stringify(reviewFindings, null, 2)
  var userMsg = 'REVIEW FINDINGS:\n' + findingsText + '\n\nHTML APP TO FIX:\n\n' + assembledHTML.slice(0, 60000)
  var sys = injectProfileContext(SYS_STITCH_FIX1)

  return callClaude(sys, userMsg, 0.2).then(function (patchedV1) {
    if (!hasCritical) {
      return { html: patchedV1, secondPass: false }
    }
    // Re-run Stage 4 checks on patched v1
    var recheck = runVerify(patchedV1)
    var stillHasIssues = recheck.score < 80

    if (!stillHasIssues) {
      return { html: patchedV1, secondPass: false }
    }

    // Second pass repair
    var recheckText = JSON.stringify(recheck, null, 2)
    var userMsg2 = 'REMAINING ISSUES (from re-verification):\n' + recheckText + '\n\nHTML APP:\n\n' + patchedV1.slice(0, 60000)
    var sys2 = injectProfileContext(SYS_STITCH_FIX2)

    return callClaude(sys2, userMsg2, 0.2).then(function (finalHTML) {
      return { html: finalHTML, secondPass: true }
    })
  })
}

/**
 * Save stitch app locally (mirrors _saveAppLocally from build-pipeline.js).
 */
function _saveStitchApp(id, name, icon, ci, code, prompt, existingApp, ghPushed) {
  if (existingApp) {
    var idx = -1
    for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { idx = i; break } }
    if (idx !== -1) {
      ST.apps[idx].versions = [{ code: ST.apps[idx].code, ts: ST.apps[idx].updatedAt }].concat((ST.apps[idx].versions || []).slice(0, 9))
      ST.apps[idx].prompts = (ST.apps[idx].prompts || []).concat([{ text: prompt, ts: new Date().toISOString(), type: 'update' }])
      ST.apps[idx].code = code
      ST.apps[idx].updatedAt = new Date().toISOString()
      ST.apps[idx].ghPushed = ghPushed || ST.apps[idx].ghPushed || false
    } else {
      ST.apps.unshift({ id: id, name: name, icon: icon, ci: ci, desc: prompt.slice(0, 90), code: code, versions: [], prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'update' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ghPushed: ghPushed })
    }
  } else {
    var exists = false; for (var j = 0; j < ST.apps.length; j++) { if (ST.apps[j].id === id) { exists = true; break } }
    if (!exists) {
      ST.apps.unshift({ id: id, name: name, icon: icon, ci: ci, desc: prompt.slice(0, 90), code: code, versions: [], prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'initial' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ghPushed: ghPushed })
    }
  }
  if (ST.activeThoughtId) {
    for (var ti = 0; ti < ST.thoughts.length; ti++) {
      if (ST.thoughts[ti].id === ST.activeThoughtId) {
        ST.thoughts[ti].linkedAppId = id
        ST.thoughts[ti].status = 'built'
        break
      }
    }
  }
  persist()
  var app = null; for (var k = 0; k < ST.apps.length; k++) { if (ST.apps[k].id === id) { app = ST.apps[k]; break } }
  if (app) pushToSupabase(app)
}

// Send a notification if the Notification API is available
function notifyUser(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      var n = new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%238b5cf6%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2256%22 text-anchor=%22middle%22%3E%F0%9F%A7%B5%3C/text%3E%3C/svg%3E',
        tag: 'stitch-pipeline',
        renotify: true,
      })
      n.onclick = function () { window.focus(); n.close() }
    }
  } catch (e) { /* notifications not available */ }
}

// --- Main pipeline orchestrator ---

/**
 * runStitchPipeline — Runs stages 1-7 of the Flawless Pipeline.
 *
 * @param {Object} context - { prompt, activeThought, pid, containerId, existingApp, customName }
 * @param {Object} callbacks - { updateStage, updateEstimate, updateTime }
 * @returns {Promise<void>}
 */
export function runStitchPipeline(context, callbacks) {
  var cb = callbacks || {}
  var updateStage = cb.updateStage || function () {}
  var updateEstimate = cb.updateEstimate || function () {}
  var updateTime = cb.updateTime || function () {}

  var runId = 'stitch_' + Date.now().toString(36)
  var pid = context.pid || 'sp' + Date.now()
  var containerId = context.containerId || null
  var startTime = Date.now()
  var timerInterval = null

  // Track elapsed time
  timerInterval = setInterval(function () {
    var elapsed = Math.floor((Date.now() - startTime) / 1000)
    var mins = Math.floor(elapsed / 60)
    var secs = elapsed % 60
    var timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs
    updateTime(timeStr)
    if (containerId) updateStitchTime(containerId, timeStr)
  }, 1000)

  updateEstimate('~2-4 min')
  if (containerId) updateStitchEstimate(containerId, '~2-4 min')

  var existingApp = context.existingApp || null
  var customName = context.customName || ''
  var prompt = context.prompt || ''
  var appName = customName || (existingApp ? existingApp.name : '') || autoName(prompt)
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var appIcon = ST.pendingIcon || '\uD83C\uDFAF'
  var appCi = ST.pendingColor != null ? ST.pendingColor : Math.floor(Math.random() * GRADS.length)
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  var branchName = hasGitHub ? 'stitch/' + appId : null

  var intakePayload = null
  var stitchHTML = null
  var assembledHTML = null
  var checksReport = null
  var reviewFindings = null
  var finalHTML = null

  // --- Halt handler ---
  function haltWithOptions(stageName, stageIndex, error) {
    clearInterval(timerInterval)
    var safeMsg = scrubKeys(error.message || String(error))

    updateStage(stageIndex, 'failed', safeMsg)
    if (containerId) updateStitchStage(containerId, stageIndex, PIPE5_STATUS.FAILED, safeMsg)

    // Create halt error with recovery options
    var haltError = new Error('STITCH_HALT')
    haltError.stageName = stageName
    haltError.stageIndex = stageIndex
    haltError.originalError = safeMsg
    haltError.runId = runId
    haltError.partialResult = {
      stitchHTML: stitchHTML,
      assembledHTML: assembledHTML,
      checksReport: checksReport
    }
    // Recovery options: (a) retry from failed stage, (b) fallback, (c) abort
    haltError.options = {
      retryFromStage: stageIndex,
      fallbackToStandard: true,
      abort: true
    }
    throw haltError
  }

  // --- Stage execution ---

  return Promise.resolve().then(function () {
    // ── Stage 1: Intake ──
    checkPipelineCancel()
    updateStage(0, 'running', 'Preparing context…')
    if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.RUNNING, 'Preparing context…')
    updatePS(pid, 0, 'active', 'Preparing context…')

    return retryStage(function () {
      return Promise.resolve().then(function () {
        intakePayload = runIntake(context)
        return intakePayload
      })
    }, 'Intake', 2, function (statusMsg) {
      updateStage(0, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.RUNNING, statusMsg)
    })
  }).then(function (payload) {
    intakePayload = payload
    storeInProgressiveLearner(runId, 'intake', {
      prompt: intakePayload.prompt,
      specText: intakePayload.specText,
      rulesText: intakePayload.rulesText,
      hasThought: !!intakePayload.activeThought
    })

    updateStage(0, 'passed', 'Context ready')
    if (containerId) updateStitchStage(containerId, 0, PIPE5_STATUS.PASSED, 'Context ready')
    updatePS(pid, 0, 'done', 'Context ready ✓')
    addMsg({ role: 'asst', type: 'text', text: 'Intake complete — context payload assembled.' })

    // ── Stage 2: Blueprint ──
    checkPipelineCancel()
    updateStage(1, 'running', 'Calling Stitch API…')
    if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.RUNNING, 'Calling Stitch API…')
    updatePS(pid, 1, 'active', 'Generating blueprint…')
    updateEstimate('~2-3 min remaining')
    if (containerId) updateStitchEstimate(containerId, '~2-3 min remaining')

    return retryStage(function () {
      return runBlueprint(intakePayload)
    }, 'Blueprint', 2, function (statusMsg) {
      updateStage(1, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.RUNNING, statusMsg)
      updatePS(pid, 1, 'active', statusMsg)
    })
  }).then(function (html) {
    stitchHTML = html
    storeInProgressiveLearner(runId, 'blueprint', {
      htmlLength: stitchHTML.length,
      preview: stitchHTML.slice(0, 500)
    })

    updateStage(1, 'passed', 'Scaffold received (' + Math.round(stitchHTML.length / 1024) + 'KB)')
    if (containerId) updateStitchStage(containerId, 1, PIPE5_STATUS.PASSED, 'Scaffold received')
    updatePS(pid, 1, 'done', 'Blueprint ready ✓')

    // ── Stage 3: Assemble ──
    checkPipelineCancel()
    updateStage(2, 'running', 'Claude adding logic layer…')
    if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.RUNNING, 'Claude adding logic layer…')
    updatePS(pid, 2, 'active', 'Assembling full app…')
    updateEstimate('~1-2 min remaining')
    if (containerId) updateStitchEstimate(containerId, '~1-2 min remaining')

    return retryStage(function () {
      return runAssemble(stitchHTML, intakePayload)
    }, 'Assemble', 2, function (statusMsg) {
      updateStage(2, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.RUNNING, statusMsg)
      updatePS(pid, 2, 'active', statusMsg)
    })
  }).then(function (html) {
    assembledHTML = html
    storeInProgressiveLearner(runId, 'assemble', {
      htmlLength: assembledHTML.length,
      preview: assembledHTML.slice(0, 500)
    })

    updateStage(2, 'passed', 'App assembled (' + Math.round(assembledHTML.length / 1024) + 'KB)')
    if (containerId) updateStitchStage(containerId, 2, PIPE5_STATUS.PASSED, 'App assembled')
    updatePS(pid, 2, 'done', 'Assembly complete ✓')

    // ── Stage 4: Verify ──
    checkPipelineCancel()
    updateStage(3, 'running', 'Running verification checks…')
    if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.RUNNING, 'Running checks…')
    updatePS(pid, 3, 'active', 'Verifying quality…')
    updateEstimate('< 1 min remaining')
    if (containerId) updateStitchEstimate(containerId, '< 1 min remaining')

    return retryStage(function () {
      return Promise.resolve().then(function () {
        return runVerify(assembledHTML)
      })
    }, 'Verify', 2, function (statusMsg) {
      updateStage(3, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 3, PIPE5_STATUS.RUNNING, statusMsg)
    })
  }).then(function (report) {
    checksReport = report
    storeInProgressiveLearner(runId, 'verify', {
      score: checksReport.score,
      valid: checksReport.valid,
      summary: checksReport.summary
    })

    var statusDetail = 'Score: ' + checksReport.score + '/100'
    var verifyStatus = checksReport.score >= 60 ? 'passed' : 'failed'

    updateStage(3, verifyStatus, statusDetail)
    if (containerId) {
      updateStitchStage(containerId, 3,
        verifyStatus === 'passed' ? PIPE5_STATUS.PASSED : PIPE5_STATUS.FAILED,
        statusDetail)
    }
    updatePS(pid, 3, verifyStatus === 'passed' ? 'done' : 'warn', statusDetail)

    // Show checks in chat
    if (checksReport.localChecks) {
      addMsg({ role: 'asst', type: 'checks', checks: checksReport.localChecks })
    }
    addMsg({ role: 'asst', type: 'text', text: 'Verification: ' + checksReport.summary })

    updateEstimate('~1-2 min remaining')
    if (containerId) updateStitchEstimate(containerId, '~1-2 min remaining')

    // ── Stage 5: Review ──
    checkPipelineCancel()
    updateStage(4, 'running', 'GPT-4o reviewing…')
    if (containerId) updateStitchStage(containerId, 4, PIPE5_STATUS.RUNNING, 'GPT-4o reviewing…')
    updatePS(pid, 4, 'active', 'GPT-4o review…')

    return retryStage(function () {
      return runReview(assembledHTML, checksReport)
    }, 'Review', 2, function (statusMsg) {
      updateStage(4, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 4, PIPE5_STATUS.RUNNING, statusMsg)
      updatePS(pid, 4, 'active', statusMsg)
    })
  }).then(function (findings) {
    reviewFindings = findings || []
    storeInProgressiveLearner(runId, 'review', {
      findingCount: reviewFindings.length,
      critical: reviewFindings.filter(function (f) { return (f.severity || '').toLowerCase() === 'critical' }).length,
      warning: reviewFindings.filter(function (f) { return (f.severity || '').toLowerCase() === 'warning' }).length,
      info: reviewFindings.filter(function (f) { return (f.severity || '').toLowerCase() === 'info' }).length
    })

    var findingSummary = reviewFindings.length + ' finding' + (reviewFindings.length !== 1 ? 's' : '')
    var criticals = reviewFindings.filter(function (f) { return (f.severity || '').toLowerCase() === 'critical' }).length
    if (criticals) findingSummary += ' (' + criticals + ' critical)'

    updateStage(4, 'passed', findingSummary)
    if (containerId) {
      updateStitchStage(containerId, 4, PIPE5_STATUS.PASSED, findingSummary)
      populateReviewFindings(containerId, reviewFindings)
    }
    updatePS(pid, 4, 'done', findingSummary + ' ✓')
    addMsg({ role: 'asst', type: 'text', text: 'GPT-4o review complete — ' + findingSummary })

    // ── Stage 6: Polish ──
    checkPipelineCancel()
    updateStage(5, 'running', 'Claude polishing…')
    if (containerId) updateStitchStage(containerId, 5, PIPE5_STATUS.RUNNING, 'Claude polishing…')
    updatePS(pid, 5, 'active', 'Polishing…')
    updateEstimate('< 1 min remaining')
    if (containerId) updateStitchEstimate(containerId, '< 1 min remaining')

    return retryStage(function () {
      return runPolish(assembledHTML, reviewFindings)
    }, 'Polish', 2, function (statusMsg) {
      updateStage(5, 'running', statusMsg)
      if (containerId) updateStitchStage(containerId, 5, PIPE5_STATUS.RUNNING, statusMsg)
      updatePS(pid, 5, 'active', statusMsg)
    })
  }).then(function (polishResult) {
    finalHTML = polishResult.html
    storeInProgressiveLearner(runId, 'polish', {
      htmlLength: finalHTML.length,
      secondPass: polishResult.secondPass,
      preview: finalHTML.slice(0, 500)
    })

    var polishDetail = polishResult.secondPass ? '2 passes applied' : (reviewFindings.length ? 'Fixes applied' : 'Clean — no fixes needed')
    updateStage(5, 'passed', polishDetail)
    if (containerId) updateStitchStage(containerId, 5, PIPE5_STATUS.PASSED, polishDetail)
    updatePS(pid, 5, 'done', polishDetail + ' ✓')
    addMsg({ role: 'asst', type: 'text', text: 'Polish complete — ' + polishDetail })

    // Save locally before deliver stage
    _saveStitchApp(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)

    // ── Stage 7: Deliver ──
    checkPipelineCancel()
    updateStage(6, 'running', 'Delivering…')
    if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, 'Delivering…')
    updatePS(pid, 6, 'active', 'Delivering…')

    // Push to GitHub branch if configured
    if (hasGitHub) {
      updateStage(6, 'running', 'Pushing to ' + branchName + '…')
      if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, 'Pushing to branch…')
      var appPath = 'apps/' + appId + '.html'
      return retryStage(function () {
        return ghCreateBranch(branchName).catch(function () { /* branch may exist */ }).then(function () {
          return ghGetFileSha(appPath, branchName).then(function (existingSha) {
            return ghPushFile(appPath, finalHTML, (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [stitch]', branchName, existingSha)
          })
        })
      }, 'Deliver-Push', 2, function (statusMsg) {
        updateStage(6, 'running', statusMsg)
        if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, statusMsg)
      }).then(function () {
        return 'github'
      }).catch(function (e) {
        addMsg({ role: 'asst', type: 'text', text: 'GitHub push skipped: ' + scrubKeys(e.message || String(e)) })
        return 'local'
      })
    } else {
      return Promise.resolve('local')
    }
  }).then(function (mode) {
    // Preview in split-screen
    setPreview(appId, finalHTML)
    addMsg({ role: 'asst', type: 'preview-card', code: finalHTML, appName: appName, branch: branchName || 'local', appId: appId, pid: pid })

    // Approval gate
    updateStage(6, 'running', 'Awaiting approval…')
    if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, 'Awaiting approval…')
    updatePS(pid, 6, 'wait', 'Waiting for your approval…')
    addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
    notifyUser('Stitch Build Ready', appName + ' is waiting for your approval.')

    return waitForApproval(pid)
  }).then(function () {
    // Approved — merge if GitHub, otherwise finalize local
    if (hasGitHub) {
      updateStage(6, 'running', 'Merging to main…')
      if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.RUNNING, 'Merging…')
      var mergeStatusId = 'merge-' + Date.now()
      addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })

      return retryStage(function () {
        return ghMergeBranch(branchName, appName)
      }, 'Deliver-Merge', 2).then(function () {
        return ghPushManifest('main').catch(function () {})
      }).then(function () {
        ghDeleteBranch(branchName)
        var liveUrl = ghPageUrl(appId)
        _saveStitchApp(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, true)
        clearPreview(appId)

        var mc = $(mergeStatusId)
        if (mc) {
          var card = mc.querySelector('.merge-card')
          if (card) card.innerHTML = '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><a class="merge-url" href="' + liveUrl + '" target="_blank">' + liveUrl + '</a><span class="merge-meta">GitHub Pages deploys in ~60s</span></div>'
        }
        toast('\uD83D\uDE80 ' + appName + ' is deploying!', 3500)
        return 'github'
      }).catch(function (e) {
        var safeE = scrubKeys(e.message || String(e))
        _saveStitchApp(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)
        clearPreview(appId)
        addMsg({ role: 'asst', type: 'text', html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. App saved locally.' })
        return 'local'
      })
    } else {
      _saveStitchApp(appId, appName, appIcon, appCi, finalHTML, prompt, existingApp, false)
      clearPreview(appId)
      toast('\u2705 ' + appName + ' saved!', 2800)
      return 'local'
    }
  }).then(function (mode) {
    // Deliver = passed
    updateStage(6, 'passed', mode === 'github' ? 'Merged & deploying' : 'Saved locally')
    if (containerId) updateStitchStage(containerId, 6, PIPE5_STATUS.PASSED, mode === 'github' ? 'Merged & deploying' : 'Saved locally')
    updatePS(pid, 6, 'done', 'Delivered ✓')

    storeInProgressiveLearner(runId, 'deliver', {
      mode: mode,
      appId: appId,
      appName: appName
    })

    clearInterval(timerInterval)
    var elapsed = Math.floor((Date.now() - startTime) / 1000)
    var mins = Math.floor(elapsed / 60)
    var secs = elapsed % 60
    var finalTime = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs
    updateTime(finalTime)
    if (containerId) updateStitchTime(containerId, finalTime)
    updateEstimate('Complete')
    if (containerId) updateStitchEstimate(containerId, 'Complete')

    ST.activeAppId = appId
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false
    notifyUser('Stitch Build Complete', appName + (mode === 'github' ? ' is live on GitHub Pages!' : ' has been saved.'))
    $('bs-proj-btn').style.display = 'flex'
    renderGrid()

    // Cost analysis
    var costData = calculateBuildCost()
    if (costData.breakdown.length > 0) {
      addMsg({ role: 'asst', type: 'cost', cost: costData })
      for (var ci = 0; ci < ST.apps.length; ci++) {
        if (ST.apps[ci].id === appId) {
          if (!ST.apps[ci].costs) ST.apps[ci].costs = []
          ST.apps[ci].costs.push({ rawCost: costData.rawCost, userPrice: costData.userPrice, markup: costData.markup, totalInput: costData.totalInput, totalOutput: costData.totalOutput, ts: costData.ts })
          if (ST.apps[ci].costs.length > 50) ST.apps[ci].costs = ST.apps[ci].costs.slice(-50)
          break
        }
      }
    }

    var g = grad(appCi)
    addMsg({
      role: 'asst', type: 'text',
      html: '<strong>' + esc(appName) + '</strong> ' + (mode === 'github' ? 'is live on GitHub Pages' : 'has been saved') + ' \uD83C\uDF89<br><br>'
        + '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">'
        + '<button onclick="openApp(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:' + g + ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open in Studio</button>'
        + '<button onclick="openProjectSheet(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>'
        + '</div>'
    })

    return showFeedbackCard(appId, appName, prompt)
  }).catch(function (err) {
    clearInterval(timerInterval)
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false

    // Re-throw halt errors and cancellation as-is
    if (err.message === 'STITCH_HALT') {
      throw err
    }

    if (err.message === 'PIPELINE_CANCELLED') {
      clearPreview(appId)
      _saveStitchApp(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
      ST.activeAppId = appId
      addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
      toast('Pipeline stopped', 3000)
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }

    if (err.message === 'BUILDER_CLOSED') {
      clearPreview(appId)
      _saveStitchApp(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
      ST.activeAppId = appId
      renderGrid()
      return
    }

    if (err.message === 'CHANGES_REQUESTED') {
      clearPreview(appId)
      _saveStitchApp(appId, appName, appIcon, appCi, finalHTML || assembledHTML || '', prompt, existingApp, false)
      ST.activeAppId = appId
      addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }

    // Determine which stage failed based on what we have
    var failedStage = 0
    if (intakePayload && !stitchHTML) failedStage = 1
    else if (stitchHTML && !assembledHTML) failedStage = 2
    else if (assembledHTML && !checksReport) failedStage = 3
    else if (checksReport && !reviewFindings) failedStage = 4
    else if (reviewFindings && !finalHTML) failedStage = 5
    else if (finalHTML) failedStage = 6

    // Blueprint failure gets special treatment: offer fallback to standard pipeline
    if (failedStage === 1) {
      var safeMsg = scrubKeys(err.message || String(err))
      toast('Stitch API error: ' + safeMsg + ' — you can try the standard pipeline', 5000)
    }

    haltWithOptions(
      ['Intake', 'Blueprint', 'Assemble', 'Verify', 'Review', 'Polish', 'Deliver'][failedStage],
      failedStage,
      err
    )
  })
}

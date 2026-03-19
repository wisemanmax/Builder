import { ST, persist, checkPipelineCancel } from '../lib/state.js'
import { toast, scrubKeys } from '../lib/utils.js'
import { SYS_STITCH_ENHANCE, SYS_STITCH_VERIFY } from '../config/prompts-stitch.js'
import { PIPE5_STATUS } from '../config/constants.js'
import { callClaudeRaw, callClaude, fetchWithRetry } from '../lib/ai.js'
import { injectProfileContext, mergeRulesWithProfile } from '../lib/profile-context.js'
import { runLocalChecks } from '../lib/checks.js'
import { updateStitchStage, updateStitchEstimate, updateStitchTime } from '../components/stitch-tracker.js'
import { addMsg, updatePS } from '../components/message.js'

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

// --- Main pipeline orchestrator ---

/**
 * runStitchPipeline — Runs stages 1-4 of the Flawless Pipeline.
 *
 * @param {Object} context - { prompt, activeThought, pid, containerId }
 * @param {Object} callbacks - { updateStage, updateEstimate, updateTime }
 * @returns {Promise<{ stitchHTML, assembledHTML, checksReport }>}
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

  var intakePayload = null
  var stitchHTML = null
  var assembledHTML = null
  var checksReport = null

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

    clearInterval(timerInterval)

    // Final time update
    var elapsed = Math.floor((Date.now() - startTime) / 1000)
    var mins = Math.floor(elapsed / 60)
    var secs = elapsed % 60
    var finalTime = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs
    updateTime(finalTime)
    if (containerId) updateStitchTime(containerId, finalTime)
    updateEstimate('Stages 1-4 complete')
    if (containerId) updateStitchEstimate(containerId, 'Stages 1-4 complete')

    return {
      stitchHTML: stitchHTML,
      assembledHTML: assembledHTML,
      checksReport: checksReport
    }
  }).catch(function (err) {
    clearInterval(timerInterval)

    // Re-throw halt errors and cancellation as-is
    if (err.message === 'STITCH_HALT' || err.message === 'PIPELINE_CANCELLED') {
      throw err
    }

    // Determine which stage failed based on what we have
    var failedStage = 0
    if (intakePayload && !stitchHTML) failedStage = 1
    else if (stitchHTML && !assembledHTML) failedStage = 2
    else if (assembledHTML && !checksReport) failedStage = 3

    // Blueprint failure gets special treatment: offer fallback to standard pipeline
    if (failedStage === 1) {
      var safeMsg = scrubKeys(err.message || String(err))
      toast('Stitch API error: ' + safeMsg + ' — you can try the standard pipeline', 5000)
    }

    haltWithOptions(
      ['Intake', 'Blueprint', 'Assemble', 'Verify'][failedStage],
      failedStage,
      err
    )
  })
}

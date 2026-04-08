// Shared pipeline utilities — extracted from build-pipeline.js, build-pipeline2.js, etc.

import {
  ST,
  persist,
  persistBuildSession,
  clearBuildSession,
  checkPipelineCancel,
  clearPipelineCancel,
} from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { MAX_FIX_PASSES } from '../config/constants.js'
import {
  SYS_BUILD,
  SYS_UPDATE,
  SYS_FIX,
  SYS_ENHANCE,
  SYS_BACKEND,
  SYS_PLAN,
  SYS_SPEC_COMPLIANCE,
  SYS_ENHANCE_REVIEW,
} from '../config/prompts.js'
import { getTemplateSkeleton, customizeTemplateCss, extractTemplateCss } from '../lib/template-loader.js'
import {
  injectProfileContext,
  mergeRulesWithProfile,
  formatBriefWithConversation,
  getThoughtDesignOverrides,
  formatDesignAsCSS,
} from '../lib/profile-context.js'
import {
  callClaude,
  callClaudeMultiTurn,
  callClaudeRaw,
  callClaudeWithThinkingStream,
  callClaudeAudit,
  callClaudeEnhanceReview,
  callGPT,
  callGPTReview,
  callGPTRaw2,
  callGPTWithStream,
  callGPTMultiTurn2,
  callGPTAudit2,
  callGPTTopRaw,
  callGemini,
  callGeminiFullAudit,
  callGroq,
  resetCostAccum,
} from '../lib/ai.js'
import { SYS_GROQ_PRECHECK } from '../config/prompts.js'
import { calculateBuildCost } from '../lib/cost.js'
import {
  ghCreateBranch,
  ghPushFile,
  ghGetFileSha,
  ghMergeBranch,
  ghDeleteBranch,
  ghPushManifest,
  ghSyncBuildHistory,
  ghEnsureBridgeWorkflow,
  ghPushExternalFile,
  ghGetExternalFileSha,
  ghCheckTokenScopes,
} from '../lib/github.js'
import { getRuntimeAsset } from '../lib/template-loader.js'
import { runLocalChecks } from '../lib/checks.js'
import {
  addMsg,
  updatePS,
  scrollBot,
  getCurrentSession,
  clearCurrentSession,
  registerPipeType,
  getPipelineSteps,
  clearPipelineSteps,
  startPipeTimer,
  stopPipeTimer,
  updatePipeETA,
  updatePipeStep,
  updatePipeProgress,
  finishPipeHeader,
} from '../components/message.js'
import {
  setPreview,
  clearPreview,
  waitForApproval,
  waitForRetryDecision,
  waitForCheckpoint,
} from '../components/approval-card.js'
import { createStreamingPreview } from '../lib/streaming-preview.js'
import { autoInjectSupabase } from '../lib/supabase-setup.js'
import { showFeedbackCard, showThoughtFeedback } from '../components/feedback-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { getSelectedThoughtIds } from '../components/thought-card.js'
import { openProjectSheet } from '../screens/project.js'
import { startBuild as _startBuild, endBuild as _endBuild, emit as _emit, getBuildContext } from '../lib/telemetry.js'
import {
  createBuildRecord as _createBuildRecord,
  updateBuildRecord as _updateBuildRecord,
  completeBuildRecord as _completeBuildRecord,
  incrementEditCount as _incrementEditCount,
} from '../lib/build-record.js'

// Re-export telemetry + build record helpers for pipelines
export var telemetry = {
  startBuild: _startBuild,
  endBuild: _endBuild,
  emit: _emit,
  getBuildContext: getBuildContext,
  createBuildRecord: _createBuildRecord,
  updateBuildRecord: _updateBuildRecord,
  completeBuildRecord: _completeBuildRecord,
  incrementEditCount: _incrementEditCount,
}

// --- Pipeline resume helpers ---

/**
 * Check whether a step should be skipped during a resumed build.
 * Returns true if the step was already completed successfully.
 */
export function shouldSkipStep(resumeSession, stepIndex) {
  if (!resumeSession || !resumeSession.steps) return false
  var pid = resumeSession.pid || 'recovered'
  var stepData = resumeSession.steps[pid]
  if (!stepData || !stepData[stepIndex]) return false
  return stepData[stepIndex].state === 'done'
}

/**
 * Build a context summary for the AI when resuming a halted pipeline.
 * Includes which steps were completed and key details from chat history.
 */
export function buildResumeContext(resumeSession) {
  if (!resumeSession) return ''
  var lines = ['[RESUMED BUILD — The following steps were already completed in a previous session:]']
  if (resumeSession.steps) {
    var pid = resumeSession.pid || 'recovered'
    var stepData = resumeSession.steps[pid] || {}
    var stepKeys = Object.keys(stepData)
    for (var i = 0; i < stepKeys.length; i++) {
      var sd = stepData[stepKeys[i]]
      if (sd && sd.state === 'done') {
        lines.push('- Step ' + stepKeys[i] + ': ' + (sd.detail || 'completed'))
      }
    }
  }
  if (resumeSession.prompt) {
    lines.push('\nOriginal prompt: ' + resumeSession.prompt)
  }
  lines.push('\nContinue building from the next incomplete step. Do not repeat work already done.')
  return lines.join('\n')
}

/**
 * Get the first step index that should run when resuming.
 */
export function getResumeStartStep(resumeSession) {
  if (!resumeSession || !resumeSession.steps) return 0
  var pid = resumeSession.pid || 'recovered'
  var stepData = resumeSession.steps[pid] || {}
  var maxDone = -1
  var stepKeys = Object.keys(stepData)
  for (var i = 0; i < stepKeys.length; i++) {
    var idx = parseInt(stepKeys[i], 10)
    if (stepData[stepKeys[i]] && stepData[stepKeys[i]].state === 'done' && idx > maxDone) {
      maxDone = idx
    }
  }
  return maxDone + 1
}

// Check IDs that are advisory-only and should not count as critical failures
export var ADVISORY_CHECK_IDS = [
  'no-innerhtml-risk',
  'fetch-calls',
  'inline-styles',
  'no-div-onclick',
  'no-innerhtml-xss',
  'has-css-vars',
  'has-main',
  'responsive-typography',
  'touch-friendly-inputs',
  'has-theme-color',
  'has-mobile-web-app',
]

/**
 * Retry wrapper for pipeline steps — retries on network/timeout errors.
 * @param {Function} fn - Async function to attempt
 * @param {number} maxRetries - Max retry count (default 2)
 * @param {string} label - Label for console warnings
 * @param {Object} [opts] - Extra options
 * @param {Function} [opts.statusCallback] - Called with status messages during rate-limit waits
 * @param {boolean} [opts.retryRateLimits] - Also retry on 429/overloaded/529
 */
export function retryStep(fn, maxRetries, label, opts) {
  maxRetries = maxRetries || 2
  opts = opts || {}
  function attempt(n) {
    return fn().catch(function (e) {
      var msg = String((e && e.message) || e || '').toLowerCase()
      var isRateLimit =
        opts.retryRateLimits && (msg.indexOf('rate') >= 0 || msg.indexOf('429') >= 0 || msg.indexOf('too many') >= 0)
      var isRetryable =
        isRateLimit ||
        msg.indexOf('timed out') >= 0 ||
        msg.indexOf('network') >= 0 ||
        msg.indexOf('failed to fetch') >= 0 ||
        msg.indexOf('load failed') >= 0 ||
        msg.indexOf('aborted') >= 0
      if (opts.retryRateLimits) {
        isRetryable = isRetryable || msg.indexOf('overloaded') >= 0 || msg.indexOf('529') >= 0
      }
      if (isRetryable && n < maxRetries) {
        var delay = isRateLimit ? Math.min(5000 * Math.pow(2, n), 60000) : Math.min(3000 * Math.pow(2, n), 30000)
        console.warn(
          '[Pipeline] ' + (label || 'Step') + ' failed (attempt ' + (n + 1) + '), retrying in ' + delay / 1000 + 's:',
          e.message
        )
        if (isRateLimit && opts.statusCallback) {
          opts.statusCallback('Waiting for API (' + Math.round(delay / 1000) + 's)\u2026')
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, delay)
        })
          .then(function () {
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
          })
          .then(function () {
            return attempt(n + 1)
          })
      }
      throw e
    })
  }
  return attempt(0)
}

/**
 * Send a browser notification if allowed and tab is not visible.
 */
export function notifyUser(title, body, tag) {
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.visibilityState !== 'visible'
    ) {
      var n = new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%23FF3CAC%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2256%22 text-anchor=%22middle%22%3E%E2%9A%A1%3C/text%3E%3C/svg%3E',
        tag: tag || 'builder-pipeline',
        renotify: true,
      })
      n.onclick = function () {
        window.focus()
        n.close()
      }
    }
  } catch (e) {
    /* notifications not available */
  }
}

/**
 * Set up wake lock, keep-alive interval, and web lock to prevent tab discard.
 * Returns a guards object with a cleanup() method.
 */
export function setupPipelineGuards(pid) {
  var _wakeLock = null
  function acquireWakeLock() {
    try {
      if (navigator.wakeLock)
        navigator.wakeLock
          .request('screen')
          .then(function (wl) {
            _wakeLock = wl
          })
          .catch(function () {})
    } catch (e) {}
  }
  acquireWakeLock()
  function _onVisChange() {
    if (document.visibilityState === 'visible' && ST._building) acquireWakeLock()
  }
  document.addEventListener('visibilitychange', _onVisChange)
  var _keepAlive = setInterval(function () {
    try {
      localStorage.setItem('bldr_ping', Date.now())
    } catch (e) {}
  }, 15000)

  var _lockRelease = null
  try {
    if (navigator.locks) {
      navigator.locks.request('builder-pipeline-' + pid, { mode: 'exclusive' }, function () {
        return new Promise(function (resolve) {
          _lockRelease = resolve
        })
      })
    }
  } catch (e) {}

  // Request notification permission early
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
  } catch (e) {}

  return {
    cleanup: function () {
      clearInterval(_keepAlive)
      document.removeEventListener('visibilitychange', _onVisChange)
      if (_wakeLock) {
        try {
          _wakeLock.release()
        } catch (e) {}
        _wakeLock = null
      }
      if (_lockRelease) {
        try {
          _lockRelease()
        } catch (e) {}
        _lockRelease = null
      }
      try {
        localStorage.removeItem('bldr_ping')
      } catch (e) {}
    },
  }
}

/**
 * Resolve active thought context for injection into build prompts.
 * Supports multiple selected thoughts — primary gets full brief, supplementary get summary.
 * Returns { activeThought, specText, rulesText, thoughtDesign, sysExtras }
 */
export function resolveThoughtContext() {
  var specText = 'No specification provided'
  var rulesText = 'No specific rules'
  var sysExtras = ''
  var thoughtDesign = null

  // Get all selected thought IDs (primary first)
  var selectedIds = getSelectedThoughtIds()
  if (!selectedIds.length && ST.activeThoughtId) selectedIds = [ST.activeThoughtId]

  var activeThought = null
  var allThoughts = []
  for (var ti = 0; ti < selectedIds.length; ti++) {
    for (var si = 0; si < ST.thoughts.length; si++) {
      if (ST.thoughts[si].id === selectedIds[ti]) {
        allThoughts.push(ST.thoughts[si])
        if (!activeThought) activeThought = ST.thoughts[si]
        break
      }
    }
  }

  if (activeThought) {
    // Process primary thought (full brief + rules)
    var linkedRules = activeThought.linkedRulesId
      ? ST.rules.find(function (r) {
          return r.id === activeThought.linkedRulesId
        })
      : null
    var merged = mergeRulesWithProfile(linkedRules)
    if (merged.mustRules.length || merged.mustNotRules.length) {
      rulesText =
        'MUST DO:\n' +
        merged.mustRules
          .map(function (r) {
            return '- ' + r
          })
          .join('\n') +
        '\nMUST NOT DO:\n' +
        merged.mustNotRules
          .map(function (r) {
            return '- ' + r
          })
          .join('\n')
      if (merged.niceToHave.length) {
        rulesText +=
          '\nNICE TO HAVE:\n' +
          merged.niceToHave
            .map(function (r) {
              return '- ' + r
            })
            .join('\n')
      }
      sysExtras += '\n\nUSER RULES (follow these constraints strictly):\n' + rulesText
    }
    if (activeThought.brief) {
      specText = formatBriefWithConversation(activeThought)
      sysExtras += '\n\nAPP SPECIFICATION (from user ideation session):\n' + specText
    }
    // Inject linked-repo context (file tree + key file excerpts) into the build
    // prompt so the model can reference real paths instead of inventing them.
    if (activeThought.linkedRepo && activeThought.linkedRepo.context) {
      var lr = activeThought.linkedRepo
      sysExtras +=
        '\n\nATTACHED REPOSITORY (' +
        lr.owner +
        '/' +
        lr.repo +
        (lr.truncated ? ' — truncated' : '') +
        '):\n' +
        'When a rule references a file or path, use its real path from the tree below. Do NOT invent paths or reimplement existing files in localStorage.\n\n' +
        lr.context
    }
    thoughtDesign = getThoughtDesignOverrides(activeThought)

    // Process supplementary thoughts (summary only)
    for (var st = 1; st < allThoughts.length; st++) {
      var suppThought = allThoughts[st]
      if (suppThought.brief) {
        var suppName = suppThought.brief.name || suppThought.name || 'Supplementary'
        var suppFeatures = (suppThought.brief.features || []).join(', ')
        sysExtras +=
          '\n\nSUPPLEMENTARY THOUGHT (' +
          suppName +
          '):\n' +
          (suppThought.brief.whatItDoes ? 'What it does: ' + suppThought.brief.whatItDoes.join(', ') + '\n' : '') +
          (suppFeatures ? 'Features: ' + suppFeatures + '\n' : '')
        // Merge supplementary rules too
        if (suppThought.linkedRulesId) {
          var suppRules = ST.rules.find(function (r) {
            return r.id === suppThought.linkedRulesId
          })
          if (suppRules) {
            if (suppRules.mustRules && suppRules.mustRules.length) {
              sysExtras += 'Additional must-do: ' + suppRules.mustRules.join(', ') + '\n'
            }
          }
        }
      }
    }
  }

  return {
    activeThought: activeThought,
    specText: specText,
    rulesText: rulesText,
    thoughtDesign: thoughtDesign,
    sysExtras: sysExtras,
    linkedRepo: activeThought && activeThought.linkedRepo ? activeThought.linkedRepo : null,
  }
}

/**
 * Derive the list of GitHub-Actions bridge action identifiers the generated
 * app can dispatch. Scans the repo's file tree for scripts under scripts/ and
 * intersects them with the bridge workflow's known cases + any rules that
 * mention "invoke"/"run"/"execute".
 *
 * Returns an array of short identifiers like ['generate-pdf', 'verify-pipeline'].
 */
export function computeAvailableBridgeActions(linkedRepo, rules) {
  if (!linkedRepo || !linkedRepo.context) return []
  // Hardcoded set that the shipped builder-bridge.yml handles today.
  var knownCases = ['generate-pdf', 'verify-pipeline', 'score-job']
  var contextLower = String(linkedRepo.context).toLowerCase()
  var rulesBlob = rules
    ? []
        .concat(rules.mustRules || [], rules.mustNotRules || [], rules.niceToHave || [])
        .join(' ')
        .toLowerCase()
    : ''
  var available = []
  for (var i = 0; i < knownCases.length; i++) {
    var action = knownCases[i]
    // Script filename the bridge workflow maps this action to
    var scriptName = action + '.mjs'
    var scriptInTree = contextLower.indexOf(scriptName) >= 0
    var mentionedInRules =
      rulesBlob.indexOf(action) >= 0 ||
      rulesBlob.indexOf(scriptName) >= 0 ||
      rulesBlob.indexOf(action.replace(/-/g, ' ')) >= 0
    if (scriptInTree || mentionedInRules) available.push(action)
  }
  return available
}

/**
 * Resolve pending template skeleton, customize CSS from thought design,
 * and extract CSS separately for the AI.
 * Returns a Promise resolving to the modified userMsg.
 */
export function resolveTemplateWithDesign(userMsg, thoughtDesign) {
  if (!ST._pendingTemplate) return Promise.resolve(userMsg)
  var pending = ST._pendingTemplate
  ST._pendingTemplate = null
  return (pending.skeleton ? Promise.resolve(pending.skeleton) : getTemplateSkeleton(pending.id)).then(
    function (skeleton) {
      // Customize CSS variables from thought design
      if (thoughtDesign) skeleton = customizeTemplateCss(skeleton, thoughtDesign)
      // Extract CSS and HTML separately
      var parts = extractTemplateCss(skeleton)
      return (
        userMsg +
        '\n\nDESIGN SYSTEM CSS (preserve these exact CSS variables and values):\n' +
        parts.css +
        '\n\nTEMPLATE STRUCTURE (use as your starting architecture — expand, customize, and fill in all features):\n' +
        parts.html +
        "\n\nCombine the CSS and structure above into a single HTML file. Keep the CSS variables exactly as specified — they match the user's design preferences. Replace all placeholder content with fully implemented features."
      )
    }
  )
}

/**
 * Build the effective system prompt by appending thought context and profile context.
 */
export function buildEffectiveSys(baseSys, thoughtCtx) {
  var sys = baseSys
  if (thoughtCtx && thoughtCtx.sysExtras) sys += thoughtCtx.sysExtras
  sys = injectProfileContext(sys)
  return sys
}

/**
 * Build a conversation memory summary from prior chat sessions.
 * Extracts what the user asked for and what was built/changed each session,
 * giving the AI context similar to a multi-turn chat conversation.
 */
function buildConversationMemory(existingApp) {
  var memory = []
  // Include prompt history with timestamps
  var prompts = existingApp.prompts || []
  for (var i = 0; i < prompts.length; i++) {
    var p = prompts[i]
    var entry = (p.type === 'initial' ? 'Initial build' : 'Update') + ': ' + p.text
    if (p.ts) entry = '[' + p.ts.split('T')[0] + '] ' + entry
    memory.push(entry)
  }
  // Include chat session summaries (what user asked and key outcomes)
  var sessions = existingApp.chatHistory || []
  for (var j = 0; j < Math.min(sessions.length, 5); j++) {
    var s = sessions[j]
    if (s.prompt) {
      var sessionEntry = '[' + (s.ts || '').split('T')[0] + '] Session: ' + s.prompt
      // Extract key user feedback from session messages
      var msgs = s.messages || []
      var userFeedback = []
      for (var k = 0; k < msgs.length; k++) {
        var m = msgs[k]
        if (m.role === 'user' && m.text && m.text.length > 20) {
          userFeedback.push(m.text.slice(0, 150))
        }
      }
      if (userFeedback.length) {
        sessionEntry += '\n  User feedback: ' + userFeedback.slice(0, 3).join(' | ')
      }
      memory.push(sessionEntry)
    }
  }
  return memory
}

/**
 * Build the user message for a build or update request.
 */
export function buildUserMessage(prompt, existingApp, customName, thoughtCtx) {
  var userMsg
  if (existingApp) {
    var currentCode = existingApp.code || ''
    // Build rich conversation memory from all prior interactions
    var memoryEntries = buildConversationMemory(existingApp)
    var codeSection = currentCode ? '\n\nCURRENT APP CODE:\n' + currentCode.slice(0, 120000) : ''
    var historySection = ''
    if (memoryEntries.length) {
      historySection =
        '\n\nCONVERSATION MEMORY (full history of this app — use this to understand context, user preferences, and prior decisions):\n' +
        memoryEntries.join('\n') +
        '\n\nThis is an ongoing project. The user has been iterating on this app. Maintain consistency with prior decisions unless the user explicitly asks to change something.'
    }
    userMsg =
      'CHANGE REQUEST: ' +
      prompt +
      historySection +
      codeSection +
      '\n\nApply the requested change to the existing code above. Return the complete modified HTML.'
  } else {
    userMsg =
      'BUILD REQUEST: ' +
      prompt +
      '\n\nCONTEXT: Single-file HTML app in sandboxed iframe. Offline-only, localStorage for persistence.' +
      '\n\nREQUIREMENTS: Build a complete, fully-functional app. Every button must work. Every feature mentioned above must be implemented — no placeholders or TODO comments. Include 5-8 realistic demo data items on first load. Handle all UI states (empty, loading, populated, error).'
    // Override with thought-based message if active
    if (thoughtCtx && thoughtCtx.activeThought && thoughtCtx.activeThought.brief) {
      userMsg =
        'Build this app based on the specification above.\n\nApp Name: ' +
        (thoughtCtx.activeThought.brief.name || customName || 'My App') +
        '\n\nAdditional notes from user: ' +
        prompt
    }
  }
  return userMsg
}

/**
 * Save the app to state (localStorage + Supabase).
 */
export function saveAppLocally(id, name, icon, ci, code, prompt, existingApp, ghPushed) {
  if (existingApp) {
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
        { text: prompt, ts: new Date().toISOString(), type: 'update' },
      ])
      ST.apps[idx].code = code
      ST.apps[idx].updatedAt = new Date().toISOString()
      ST.apps[idx].ghPushed = ghPushed || ST.apps[idx].ghPushed || false
    } else {
      ST.apps.unshift({
        id: id,
        name: name,
        icon: icon,
        ci: ci,
        desc: prompt.slice(0, 90),
        code: code,
        versions: [],
        prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'update' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ghPushed: ghPushed,
      })
    }
  } else {
    var exists = false
    for (var j = 0; j < ST.apps.length; j++) {
      if (ST.apps[j].id === id) {
        exists = true
        break
      }
    }
    if (!exists) {
      ST.apps.unshift({
        id: id,
        name: name,
        icon: icon,
        ci: ci,
        desc: prompt.slice(0, 90),
        code: code,
        versions: [],
        prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'initial' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ghPushed: ghPushed,
      })
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
  var app = null
  for (var k = 0; k < ST.apps.length; k++) {
    if (ST.apps[k].id === id) {
      app = ST.apps[k]
      break
    }
  }
  if (app) pushToSupabase(app)
}

/**
 * Save chat session history on an app.
 */
export function saveChatSession(appId, prompt) {
  var session = getCurrentSession()
  if (!session.length) return
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === appId) {
      app = ST.apps[i]
      break
    }
  }
  if (!app) return
  if (!app.chatHistory) app.chatHistory = []
  app.chatHistory.unshift({
    id: 's' + Date.now(),
    ts: new Date().toISOString(),
    prompt: (prompt || '').slice(0, 200),
    messages: session,
  })
  if (app.chatHistory.length > 25) app.chatHistory = app.chatHistory.slice(0, 25)
  persist()
  clearCurrentSession()
  // Auto-sync build history to GitHub
  ghSyncBuildHistory(appId).catch(function () {})
}

/**
 * Render spec compliance card from a compliance JSON object.
 */
export function renderComplianceCard(compliance, checklist) {
  var scoreColor =
    compliance.score >= 80 ? 'rgba(76,175,80,.9)' : compliance.score >= 50 ? 'rgba(255,214,0,.9)' : 'rgba(255,82,82,.9)'
  var html =
    '<div style="padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:11px">'
  html +=
    '<div style="font-weight:700;color:' +
    scoreColor +
    ';margin-bottom:6px">Spec Compliance: ' +
    (compliance.score || 0) +
    '/100</div>'

  // Feature checklist with verified status
  if (checklist && checklist.length) {
    html += '<div style="color:rgba(255,255,255,.5);margin-bottom:4px">Feature Checklist:</div>'
    for (var i = 0; i < checklist.length; i++) {
      var item = checklist[i]
      var icon = item.verified ? '\u2611' : '\u2610'
      var color = item.verified ? 'rgba(76,175,80,.8)' : item.required ? 'rgba(255,82,82,.7)' : 'rgba(255,214,0,.7)'
      html +=
        '<div style="color:' +
        color +
        ';padding-left:8px" class="' +
        (item.verified ? 'ts-check-done' : 'ts-check-miss') +
        '">' +
        icon +
        ' ' +
        esc(item.text)
      if (item.required && !item.verified) html += ' <span style="font-size:9px;opacity:.6">(required)</span>'
      html += '</div>'
    }
  }

  if (compliance.matched && compliance.matched.length) {
    html += '<div style="color:rgba(255,255,255,.5);margin-top:6px;margin-bottom:2px">Matched:</div>'
    html += compliance.matched
      .map(function (m) {
        return '<div style="color:rgba(76,175,80,.8);padding-left:8px">\u2713 ' + esc(m) + '</div>'
      })
      .join('')
  }
  if (compliance.missing && compliance.missing.length) {
    html += '<div style="color:rgba(255,255,255,.5);margin-top:4px;margin-bottom:2px">Missing:</div>'
    html += compliance.missing
      .map(function (m) {
        return '<div style="color:rgba(255,214,0,.7);padding-left:8px">\u26A0 ' + esc(m) + '</div>'
      })
      .join('')
  }
  if (compliance.violations && compliance.violations.length) {
    html += '<div style="color:rgba(255,255,255,.5);margin-top:4px;margin-bottom:2px">Violations:</div>'
    html += compliance.violations
      .map(function (m) {
        return '<div style="color:rgba(255,82,82,.7);padding-left:8px">\u2717 ' + esc(m) + '</div>'
      })
      .join('')
  }
  html += '</div>'
  return html
}

/**
 * Cross-reference feature checklist against compliance results.
 * Marks features as verified if they appear in compliance.matched.
 * Also persists verification results back to the thought in state.
 */
export function verifyFeatureChecklist(checklist, compliance) {
  if (!checklist || !checklist.length || !compliance) return checklist || []
  var matched = (compliance.matched || []).map(function (m) {
    return m.toLowerCase()
  })
  var result = []
  for (var i = 0; i < checklist.length; i++) {
    var item = { id: checklist[i].id, text: checklist[i].text, required: checklist[i].required, verified: false }
    var lower = item.text.toLowerCase()
    for (var j = 0; j < matched.length; j++) {
      if (matched[j].indexOf(lower) !== -1 || lower.indexOf(matched[j]) !== -1) {
        item.verified = true
        break
      }
    }
    // Also check if it's NOT in the missing list
    if (!item.verified && compliance.missing) {
      var isMissing = false
      for (var k = 0; k < compliance.missing.length; k++) {
        if (
          compliance.missing[k].toLowerCase().indexOf(lower) !== -1 ||
          lower.indexOf(compliance.missing[k].toLowerCase()) !== -1
        ) {
          isMissing = true
          break
        }
      }
      // If not missing and not explicitly matched, give benefit of the doubt
      if (!isMissing) item.verified = true
    }
    result.push(item)
  }
  // Persist verified status back to the thought object
  _persistChecklistToThought(result)
  return result
}

/**
 * Save verified checklist results back to the thought in state.
 */
function _persistChecklistToThought(items) {
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
 * Save a multi-file website app locally (for build-website.js / multi-file pipelines).
 */
export function saveWebsiteApp(id, name, icon, ci, siteFiles, preview, prompt, existingApp, ghPushed) {
  if (existingApp) {
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
        { text: prompt, ts: new Date().toISOString(), type: 'update' },
      ])
      ST.apps[idx].code = preview
      ST.apps[idx].type = 'website'
      ST.apps[idx].files = siteFiles
      ST.apps[idx].updatedAt = new Date().toISOString()
      ST.apps[idx].ghPushed = ghPushed || ST.apps[idx].ghPushed || false
    } else {
      ST.apps.unshift({
        id: id,
        name: name,
        icon: icon,
        ci: ci,
        desc: prompt.slice(0, 90),
        code: preview,
        type: 'website',
        files: siteFiles,
        versions: [],
        prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'update' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ghPushed: ghPushed,
      })
    }
  } else {
    var exists = false
    for (var j = 0; j < ST.apps.length; j++) {
      if (ST.apps[j].id === id) {
        exists = true
        break
      }
    }
    if (!exists) {
      ST.apps.unshift({
        id: id,
        name: name,
        icon: icon,
        ci: ci,
        desc: prompt.slice(0, 90),
        code: preview,
        type: 'website',
        files: siteFiles,
        versions: [],
        prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'initial' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ghPushed: ghPushed,
      })
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
  var app = null
  for (var k = 0; k < ST.apps.length; k++) {
    if (ST.apps[k].id === id) {
      app = ST.apps[k]
      break
    }
  }
  if (app) pushToSupabase(app)
}

/**
 * Format template skeleton injection text with explicit CSS design variable instructions.
 * Ensures the LLM maintains the design tokens even if it rewrites the CSS.
 */
export function formatTemplateInjection(skeleton, designPrefs) {
  var injection =
    '\n\nTEMPLATE SKELETON (use as your starting architecture \u2014 expand, customize, and fill in all features):\n' +
    skeleton +
    '\n\nUse the skeleton above as your base structure. Keep its layout pattern, state shape, and responsive strategy. Replace all placeholder content with fully implemented features.'
  if (designPrefs) {
    var cssBlock = formatDesignAsCSS(designPrefs)
    if (cssBlock) {
      injection +=
        '\n\nDESIGN SYSTEM (these CSS variables are already applied in the skeleton above \u2014 maintain them):\n' +
        cssBlock
    }
  }
  return injection
}

// --- Smart provider routing (Gemini > GPT > Claude) ---

function normalizeAuditResult(result) {
  // If already a flat array (GPT/Claude format), return as-is
  if (Array.isArray(result)) return result
  // Gemini format: {security:[], accessibility:[], performance:[], quality:[], suggestions:[]}
  var flat = []
  var cats = ['security', 'accessibility', 'performance', 'quality', 'suggestions']
  for (var i = 0; i < cats.length; i++) {
    var items = result[cats[i]]
    if (!Array.isArray(items)) continue
    for (var j = 0; j < items.length; j++) {
      flat.push({
        severity: items[j].severity || 'medium',
        issue: items[j].issue || items[j].fix || '',
        location: items[j].line || cats[i],
      })
    }
  }
  return flat
}

function auditProviderLabel() {
  if (ST.geminiKey) return 'Gemini'
  if (ST.gptKey) return 'GPT-4o'
  return 'Claude'
}

function smartAudit(code) {
  if (ST.geminiKey) return callGeminiFullAudit(code).then(normalizeAuditResult)
  if (ST.gptKey) return callGPT(code)
  return callClaudeAudit(code)
}

function smartReview(code) {
  if (ST.geminiKey) {
    return callGemini(
      SYS_ENHANCE_REVIEW,
      'Review this app and suggest enhancements and identify bugs:\n\n' + code.slice(0, 40000),
      8192
    ).then(function (raw) {
      try {
        var p = JSON.parse(raw)
        return {
          enhancements: Array.isArray(p.enhancements) ? p.enhancements : [],
          bugs: Array.isArray(p.bugs) ? p.bugs : [],
        }
      } catch (e) {
        return { enhancements: [], bugs: [] }
      }
    })
  }
  if (ST.gptKey) return callGPTReview(code)
  return callClaudeEnhanceReview(code)
}

function smartRaw(sys, msg, maxTokens, images) {
  if (ST.geminiKey) return callGemini(sys, msg, maxTokens)
  if (ST.gptKey) return callGPTRaw2(sys, msg, maxTokens, images)
  return callClaudeRaw(sys, msg, maxTokens, images)
}

function groqPreCheck(code) {
  if (!ST.groqKey) return Promise.resolve([])
  return callGroq(SYS_GROQ_PRECHECK, code.slice(0, 6000), 1024)
    .then(function (raw) {
      try {
        var p = JSON.parse(raw)
        return Array.isArray(p) ? p : []
      } catch (e) {
        return []
      }
    })
    .catch(function () {
      return []
    })
}

// Re-export commonly used imports so pipeline files don't need to import them separately
export {
  ST,
  persist,
  persistBuildSession,
  clearBuildSession,
  checkPipelineCancel,
  clearPipelineCancel,
  $,
  esc,
  toast,
  grad,
  uniqueSlug,
  autoName,
  scrubKeys,
  ghPageUrl,
  MAX_FIX_PASSES,
  SYS_BUILD,
  SYS_UPDATE,
  SYS_FIX,
  SYS_ENHANCE,
  SYS_BACKEND,
  SYS_PLAN,
  SYS_SPEC_COMPLIANCE,
  SYS_ENHANCE_REVIEW,
  callClaude,
  callClaudeMultiTurn,
  callClaudeRaw,
  callClaudeWithThinkingStream,
  callClaudeAudit,
  callGPT,
  callGPTReview,
  callGPTRaw2,
  callGPTWithStream,
  callGPTMultiTurn2,
  callGPTAudit2,
  callGPTTopRaw,
  callGemini,
  callGeminiFullAudit,
  callGroq,
  resetCostAccum,
  smartAudit,
  smartReview,
  smartRaw,
  groqPreCheck,
  auditProviderLabel,
  normalizeAuditResult,
  calculateBuildCost,
  ghCreateBranch,
  ghPushFile,
  ghGetFileSha,
  ghMergeBranch,
  ghDeleteBranch,
  ghPushManifest,
  ghEnsureBridgeWorkflow,
  ghPushExternalFile,
  ghGetExternalFileSha,
  ghCheckTokenScopes,
  getRuntimeAsset,
  runLocalChecks,
  addMsg,
  updatePS,
  scrollBot,
  getCurrentSession,
  clearCurrentSession,
  registerPipeType,
  getPipelineSteps,
  clearPipelineSteps,
  startPipeTimer,
  stopPipeTimer,
  updatePipeETA,
  updatePipeStep,
  updatePipeProgress,
  finishPipeHeader,
  setPreview,
  clearPreview,
  waitForApproval,
  waitForRetryDecision,
  waitForCheckpoint,
  createStreamingPreview,
  autoInjectSupabase,
  showFeedbackCard,
  showThoughtFeedback,
  renderGrid,
  pushToSupabase,
  openProjectSheet,
  injectProfileContext,
  formatDesignAsCSS,
  getThoughtDesignOverrides,
  getTemplateSkeleton,
  customizeTemplateCss,
}

import { ST, persist } from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { MAX_FIX_PASSES } from '../config/constants.js'
import { SYS_BUILD, SYS_UPDATE, SYS_FIX, SYS_ENHANCE, SYS_BACKEND, SYS_PLAN } from '../config/prompts.js'
import { injectProfileContext, mergeRulesWithProfile, formatBriefForPrompt } from '../lib/profile-context.js'
import { callClaude, callClaudeMultiTurn, callClaudeRaw, callClaudeWithThinkingStream, callGPT, callGPTReview, resetCostAccum } from '../lib/ai.js'
import { calculateBuildCost } from '../lib/cost.js'
import { ghCreateBranch, ghPushFile, ghGetFileSha, ghMergeBranch, ghDeleteBranch, ghPushManifest } from '../lib/github.js'
import { runLocalChecks } from '../lib/checks.js'
import { addMsg, updatePS, scrollBot, getCurrentSession, clearCurrentSession, getPipelineSteps, clearPipelineSteps } from '../components/message.js'
import { persistBuildSession, clearBuildSession, checkPipelineCancel, clearPipelineCancel } from '../lib/state.js'
import { setPreview, clearPreview, waitForApproval, waitForRetryDecision } from '../components/approval-card.js'
import { showFeedbackCard } from '../components/feedback-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { openProjectSheet } from '../screens/project.js'

// Check IDs that are advisory-only and should not count as critical failures
var ADVISORY_CHECK_IDS = ['no-innerhtml-risk', 'fetch-calls', 'inline-styles', 'no-div-onclick', 'no-innerhtml-xss', 'has-css-vars', 'has-main', 'responsive-typography', 'touch-friendly-inputs']

// Retry wrapper for pipeline steps — retries on network/timeout errors
function retryStep(fn, maxRetries, label) {
  maxRetries = maxRetries || 2
  function attempt(n) {
    return fn().catch(function (e) {
      var msg = String(e && e.message || e || '').toLowerCase()
      var isRetryable = msg.indexOf('timed out') >= 0 || msg.indexOf('network') >= 0
        || msg.indexOf('failed to fetch') >= 0 || msg.indexOf('load failed') >= 0
        || msg.indexOf('aborted') >= 0
      if (isRetryable && n < maxRetries) {
        var delay = Math.min(3000 * Math.pow(2, n), 30000)
        console.warn('[Pipeline] ' + (label || 'Step') + ' failed (attempt ' + (n + 1) + '), retrying in ' + (delay / 1000) + 's:', e.message)
        return new Promise(function (resolve) { setTimeout(resolve, delay) }).then(function () {
          // Wait for visibility if backgrounded
          if (document.visibilityState !== 'visible') {
            return new Promise(function (resolve) {
              function onVis() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVis); resolve() } }
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

// Send a notification if the Notification API is available and permitted
function notifyUser(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      var n = new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%23FF3CAC%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2256%22 text-anchor=%22middle%22%3E%E2%9A%A1%3C/text%3E%3C/svg%3E',
        tag: 'builder-pipeline',
        renotify: true,
      })
      n.onclick = function () { window.focus(); n.close() }
    }
  } catch (e) { /* notifications not available */ }
}

export function runPipeline(prompt, existingApp, customName, images) {
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true; $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel'); if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid })
  }, 0)

  // Request notification permission early (non-blocking)
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission() } catch (e) {}

  var _wakeLock = null
  function acquireWakeLock() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (wl) { _wakeLock = wl }).catch(function () {}) } catch (e) {} }
  acquireWakeLock()
  // Re-acquire wake lock whenever page becomes visible again
  function _onVisChange() { if (document.visibilityState === 'visible' && ST._building) acquireWakeLock() }
  document.addEventListener('visibilitychange', _onVisChange)
  var _keepAlive = setInterval(function () { try { localStorage.setItem('bldr_ping', Date.now()) } catch (e) {} }, 15000)

  // Acquire a Web Lock to prevent the browser from discarding the tab during the build
  var _lockRelease = null
  try {
    if (navigator.locks) {
      navigator.locks.request('builder-pipeline-' + pid, { mode: 'exclusive' }, function () {
        return new Promise(function (resolve) { _lockRelease = resolve })
      })
    }
  } catch (e) { /* Web Locks not available */ }

  var appName = existingApp ? existingApp.name : ((customName && customName.trim()) || autoName(prompt))
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? ('builder/app-' + appId + '-' + Date.now().toString(36)) : ''

  var v1, v2, specText, rulesText, fixSys, thinkingText

  function withContext(sysPrompt) {
    return sysPrompt.replace('{SPEC}', specText).replace('{RULES}', rulesText)
  }

  // Persist build session for crash recovery
  function _persistProgress(lastStep) {
    persistBuildSession({
      pid: pid, appId: appId, appName: appName, appIcon: appIcon,
      appCi: appCi, prompt: prompt, pipelineMode: 'builder1',
      branchName: branchName, lastStep: lastStep,
      steps: getPipelineSteps(), ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: !!(v2 || v1)
    })
  }

  // Step 0 — Branch
  var p = Promise.resolve()
  if (hasGitHub) {
    updatePS(pid, 0, 'active', 'Creating feature branch\u2026')
    p = retryStep(function () { return ghCreateBranch(branchName) }, 3, 'Branch').then(function () {
      updatePS(pid, 0, 'done', branchName); _persistProgress(0)
    }).catch(function (e) {
      updatePS(pid, 0, 'error', e.message)
      throw new Error('Branch creation failed: ' + e.message)
    })
  } else {
    updatePS(pid, 0, 'skip', 'No GitHub \u2014 local-only mode')
  }

  var planJSON = ''

  p.then(function () {
    // Step 1 — Plan
    checkPipelineCancel()
    updatePS(pid, 1, 'active', 'Claude is planning the architecture\u2026')
    var planMsg = 'App description: ' + prompt
    if (images && images.length) planMsg += '\n\n[' + images.length + ' reference image' + (images.length > 1 ? 's' : '') + ' attached — use them to understand the desired design/layout]'
    return retryStep(function () { return callClaudeRaw(SYS_PLAN, planMsg, 2000, images) }, 2, 'Plan').then(function (raw) {
      planJSON = raw
      updatePS(pid, 1, 'done', 'Architecture planned \u2713'); _persistProgress(1)
      addMsg({ role: 'asst', type: 'text', text: 'Architecture plan ready.' })
    }).catch(function (e) {
      updatePS(pid, 1, 'warn', 'Planning skipped: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 2 — Build
    checkPipelineCancel()
    updatePS(pid, 2, 'active', 'Claude is writing your app\u2026')
    var userMsg
    if (existingApp) {
      var currentCode = existingApp.code || ''
      var prevPrompts = (existingApp.prompts || []).map(function (p2) { return p2.text }).join('\n\u2192 ')
      var codeSection = currentCode ? '\n\nCURRENT APP CODE:\n' + currentCode.slice(0, 120000) : ''
      var historySection = prevPrompts ? '\n\nBUILD HISTORY (for context):\n' + prevPrompts : ''
      userMsg = 'CHANGE REQUEST: ' + prompt + historySection + codeSection + '\n\nApply the requested change to the existing code above. Return the complete modified HTML.'
    } else {
      userMsg = 'BUILD REQUEST: ' + prompt
        + '\n\nCONTEXT: Single-file HTML app in sandboxed iframe. Offline-only, localStorage for persistence.'
      if (ST._pendingTemplate) {
        userMsg += '\n\nTEMPLATE SKELETON (use as your starting architecture \u2014 expand, customize, and fill in all features):\n'
          + ST._pendingTemplate.skeleton
          + '\n\nUse the skeleton above as your base structure. Keep its layout pattern, state shape, and responsive strategy. Replace all placeholder content with fully implemented features.'
        ST._pendingTemplate = null
      }
    }

    var effectiveSys = existingApp ? SYS_UPDATE : SYS_BUILD
    specText = 'No specification provided'
    rulesText = 'No specific rules'
    var activeThought = ST.activeThoughtId ? ST.thoughts.find(function (t) { return t.id === ST.activeThoughtId }) : null
    if (activeThought) {
      var linkedRules = activeThought.linkedRulesId ? ST.rules.find(function (r) { return r.id === activeThought.linkedRulesId }) : null
      // Merge profile global rules with per-thought project rules
      var merged = mergeRulesWithProfile(linkedRules)
      if (merged.mustRules.length || merged.mustNotRules.length) {
        rulesText = 'MUST DO:\n' + merged.mustRules.map(function (r) { return '- ' + r }).join('\n')
          + '\nMUST NOT DO:\n' + merged.mustNotRules.map(function (r) { return '- ' + r }).join('\n')
        if (merged.niceToHave.length) {
          rulesText += '\nNICE TO HAVE:\n' + merged.niceToHave.map(function (r) { return '- ' + r }).join('\n')
        }
        effectiveSys += '\n\nUSER RULES (follow these constraints strictly):\n' + rulesText
      }
      if (activeThought.brief) {
        specText = formatBriefForPrompt(activeThought.brief)
        effectiveSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + specText
      }
      if (!existingApp && activeThought.brief) {
        userMsg = 'Build this app based on the specification above.\n\nApp Name: ' + (activeThought.brief.name || customName || 'My App') + '\n\nAdditional notes from user: ' + prompt
      }
    }
    // Inject profile context (org identity, global rules if no thought, learned preferences)
    effectiveSys = injectProfileContext(effectiveSys)

    if (planJSON) { userMsg += '\n\nARCHITECTURE PLAN:\n' + planJSON }
    if (images && images.length) { userMsg += '\n\n[' + images.length + ' reference image' + (images.length > 1 ? 's' : '') + ' attached — study them carefully and replicate the design, layout, colors, and style as closely as possible]' }
    var charCount = 0
    thinkingText = ''
    return callClaudeWithThinkingStream(effectiveSys, userMsg, 2000, function (type, text) {
      if (type === 'text') { charCount += text.length; updatePS(pid, 2, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars') }
      else if (type === 'thinking') { thinkingText += text }
    }, images)
  }).then(function (code) {
    v1 = code
    updatePS(pid, 2, 'done', 'Build complete \u2713'); _persistProgress(2)
    // Save app locally early so code survives a crash
    _saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
    if (thinkingText.trim()) {
      addMsg({ role: 'asst', type: 'thinking', text: thinkingText.trim() })
    }

    var canAudit = !!(ST.gptKey && ST.auditEnabled)
    var currentCode = v1
    var passNum = 0
    var totalFixed = 0
    var repairHistory = []
    fixSys = withContext(SYS_FIX.replace('{INTENT}', prompt))

    function runValidationPass() {
      passNum++
      var passLabel = passNum > 1 ? ' (pass ' + passNum + '/' + MAX_FIX_PASSES + ')' : ''

      updatePS(pid, 3, 'active', 'Running checks' + passLabel + '\u2026')
      var checks = runLocalChecks(currentCode)
      var criticalFails = checks.filter(function (c) { return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1 })
      addMsg({ role: 'asst', type: 'checks', checks: checks })
      updatePS(pid, 3, criticalFails.length ? 'warn' : 'done',
        criticalFails.length ? (criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found' + passLabel) : 'All checks passed' + passLabel + ' \u2713')

      var auditPromise
      if (canAudit) {
        updatePS(pid, 4, 'active', 'GPT-4o reviewing' + passLabel + '\u2026')
        auditPromise = callGPT(currentCode).then(function (bugs) {
          updatePS(pid, 4, 'done', bugs.length ? ('Found ' + bugs.length + ' issue' + (bugs.length !== 1 ? 's' : '') + passLabel) : 'Code is clean' + passLabel + ' \u2713')
          addMsg({ role: 'asst', type: 'audit', bugs: bugs })
          return { criticalFails: criticalFails, bugs: bugs }
        }).catch(function (e) {
          var auditErr = scrubKeys(e.message || String(e))
          updatePS(pid, 4, 'error', 'Audit failed' + passLabel + ': ' + auditErr)
          return { criticalFails: criticalFails, bugs: [] }
        })
      } else {
        if (passNum === 1) updatePS(pid, 4, 'skip', ST.gptKey ? 'Audit disabled' : 'No OpenAI key \u2014 skipped')
        auditPromise = Promise.resolve({ criticalFails: criticalFails, bugs: [] })
      }

      return auditPromise.then(function (result) {
        var allIssues = result.criticalFails.map(function (c) { return { severity: 'medium', issue: c.label + (c.detail ? ' \u2014 ' + c.detail : ''), location: c.cat } }).concat(result.bugs)

        if (allIssues.length > 0) {
          updatePS(pid, 5, 'active', 'Fixing ' + allIssues.length + ' issue' + (allIssues.length !== 1 ? 's' : '') + passLabel + '\u2026')
          var issueList = allIssues.map(function (b, i) { return (i + 1) + '. [' + ((b.severity || 'medium').toUpperCase()) + '] ' + (b.issue || '') + ' \u2014 ' + (b.location || '') }).join('\n')

          // Multi-turn: first pass includes full code, subsequent passes only list remaining issues
          var fm
          if (passNum === 1) {
            fm = 'ISSUES TO FIX:\n' + issueList + '\n\nORIGINAL CODE:\n' + currentCode
          } else {
            fm = 'REMAINING ISSUES after pass ' + (passNum - 1) + ':\n' + issueList + '\n\nFix these without reintroducing previously resolved issues.'
          }
          repairHistory.push({ role: 'user', content: fm })

          return retryStep(function () { return callClaudeMultiTurn(fixSys, repairHistory) }, 2, 'Fix').then(function (fixed) {
            repairHistory.push({ role: 'assistant', content: fixed })
            currentCode = fixed
            totalFixed += allIssues.length
            if (passNum < MAX_FIX_PASSES) {
              updatePS(pid, 5, 'active', 'Re-validating fixes' + passLabel + '\u2026')
              return runValidationPass()
            } else {
              var finalChecks = runLocalChecks(currentCode)
              var finalFails = finalChecks.filter(function (c) { return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1 })
              if (finalFails.length > 0) {
                updatePS(pid, 5, 'warn', finalFails.length + ' issue' + (finalFails.length !== 1 ? 's' : '') + ' remain after ' + MAX_FIX_PASSES + ' passes')
              } else {
                updatePS(pid, 5, 'done', 'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713')
              }
              v2 = currentCode
              addMsg({ role: 'asst', type: 'text', text: 'Validation summary: ' + totalFixed + ' issue' + (totalFixed !== 1 ? 's' : '') + ' addressed across ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + '.' + (finalFails.length > 0 ? ' ' + finalFails.length + ' minor issue' + (finalFails.length !== 1 ? 's' : '') + ' may remain.' : '') })
            }
          }).catch(function (e) {
            v2 = currentCode
            var errMsg = scrubKeys(e.message || String(e))
            updatePS(pid, 5, 'error', 'Fix pass failed \u2014 using ' + (passNum > 1 ? 'last good version' : 'original'))
            addMsg({ role: 'asst', type: 'text', text: 'Fix error: ' + errMsg })
          })
        } else {
          v2 = currentCode
          if (passNum === 1) {
            updatePS(pid, 5, 'done', 'No fixes needed \u2713')
          } else {
            updatePS(pid, 5, 'done', 'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713')
            addMsg({ role: 'asst', type: 'text', text: 'Validation summary: ' + totalFixed + ' issue' + (totalFixed !== 1 ? 's' : '') + ' addressed across ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + '. Code is clean \u2713' })
          }
          return Promise.resolve()
        }
      })
    }

    return runValidationPass()
  }).then(function () {
    // Step 6 — GPT-4o Enhancement Review
    checkPipelineCancel()
    var canReview = !!(ST.gptKey && ST.auditEnabled)
    if (!canReview) {
      updatePS(pid, 6, 'skip', ST.gptKey ? 'Review disabled' : 'No OpenAI key — skipped')
      updatePS(pid, 7, 'skip', 'Skipped — no review')
      updatePS(pid, 8, 'skip', 'Skipped — no review')
      return Promise.resolve()
    }
    updatePS(pid, 6, 'active', 'GPT-4o reviewing for enhancements…')
    return retryStep(function () { return callGPTReview(v2) }, 2, 'EnhReview').then(function (review) {
      var totalSuggestions = review.enhancements.length + review.bugs.length
      updatePS(pid, 6, 'done', totalSuggestions ? (review.enhancements.length + ' enhancement' + (review.enhancements.length !== 1 ? 's' : '') + ', ' + review.bugs.length + ' bug' + (review.bugs.length !== 1 ? 's' : '')) : 'Code looks great ✓')
      if (review.enhancements.length) {
        addMsg({ role: 'asst', type: 'text', text: 'Enhancement suggestions: ' + review.enhancements.map(function (e, i) { return (i + 1) + '. [' + e.priority.toUpperCase() + '] ' + e.suggestion }).join('; ') })
      }
      if (review.bugs.length) {
        addMsg({ role: 'asst', type: 'audit', bugs: review.bugs })
      }

      if (totalSuggestions === 0) {
        updatePS(pid, 7, 'done', 'No enhancements needed ✓')
        updatePS(pid, 8, 'done', 'No review needed ✓')
        return Promise.resolve()
      }

      // Step 7 — Claude implements enhancements
      updatePS(pid, 7, 'active', 'Claude implementing enhancements…')
      var enhanceMsg = 'ENHANCEMENTS TO APPLY:\n'
      enhanceMsg += review.enhancements.map(function (e, i) { return (i + 1) + '. [' + (e.priority || 'medium').toUpperCase() + '] ' + (e.suggestion || '') + ' — ' + (e.location || '') + (e.reason ? ' (Reason: ' + e.reason + ')' : '') }).join('\n')
      if (review.bugs.length) {
        enhanceMsg += '\n\nBUGS TO FIX:\n'
        enhanceMsg += review.bugs.map(function (b, i) { return (i + 1) + '. [' + (b.severity || 'medium').toUpperCase() + '] ' + (b.issue || '') + ' — ' + (b.location || '') }).join('\n')
      }
      enhanceMsg += '\n\nORIGINAL CODE:\n' + v2

      return retryStep(function () { return callClaude(withContext(SYS_ENHANCE), enhanceMsg) }, 2, 'Enhance').then(function (enhanced) {
        v2 = enhanced
        updatePS(pid, 7, 'done', 'Enhancements applied ✓')

        // Step 8 — GPT-4o Final Review (bug gate)
        updatePS(pid, 8, 'active', 'GPT-4o final bug review…')
        var MAX_REVIEW_PASSES = 2
        var reviewPass = 0

        function runFinalReview() {
          reviewPass++
          return retryStep(function () { return callGPT(v2) }, 2, 'FinalReview').then(function (bugs) {
            var criticalBugs = bugs.filter(function (b) { return b.severity === 'high' || b.severity === 'medium' })
            if (criticalBugs.length === 0) {
              updatePS(pid, 8, 'done', (reviewPass > 1 ? 'Clean after ' + reviewPass + ' passes' : 'Code is clean') + ' ✓')
              if (bugs.length > 0) {
                addMsg({ role: 'asst', type: 'text', text: 'Final review: ' + bugs.length + ' low-severity note' + (bugs.length !== 1 ? 's' : '') + ' (acceptable).' })
              }
              return Promise.resolve()
            }

            addMsg({ role: 'asst', type: 'audit', bugs: criticalBugs })

            if (reviewPass < MAX_REVIEW_PASSES) {
              updatePS(pid, 8, 'active', 'Sending ' + criticalBugs.length + ' issue' + (criticalBugs.length !== 1 ? 's' : '') + ' back to Claude (pass ' + reviewPass + ')…')
              var fixMsg = 'ISSUES TO FIX:\n' + criticalBugs.map(function (b, i) { return (i + 1) + '. [' + ((b.severity || 'medium').toUpperCase()) + '] ' + (b.issue || '') + ' — ' + (b.location || '') }).join('\n') + '\n\nORIGINAL CODE:\n' + v2
              return retryStep(function () { return callClaude(fixSys, fixMsg) }, 2, 'ReviewFix').then(function (fixed) {
                v2 = fixed
                return runFinalReview()
              })
            } else {
              updatePS(pid, 8, 'wait', criticalBugs.length + ' issue' + (criticalBugs.length !== 1 ? 's' : '') + ' remain after ' + reviewPass + ' passes')
              addMsg({ role: 'asst', type: 'retry-prompt', pid: pid, bugCount: criticalBugs.length })
              notifyUser('Action Required', criticalBugs.length + ' issues found — retry or proceed?')
              return waitForRetryDecision(pid).then(function (doRetry) {
                if (doRetry) {
                  updatePS(pid, 8, 'active', 'Claude is fixing remaining issues…')
                  var retryFixMsg = 'ISSUES TO FIX:\n' + criticalBugs.map(function (b, i) { return (i + 1) + '. [' + ((b.severity || 'medium').toUpperCase()) + '] ' + (b.issue || '') + ' — ' + (b.location || '') }).join('\n') + '\n\nORIGINAL CODE:\n' + v2
                  return retryStep(function () { return callClaude(fixSys, retryFixMsg) }, 2, 'RetryFix').then(function (fixed) {
                    v2 = fixed
                    reviewPass = 0
                    return runFinalReview()
                  })
                } else {
                  updatePS(pid, 8, 'warn', criticalBugs.length + ' issue' + (criticalBugs.length !== 1 ? 's' : '') + ' remain — proceeding')
                  addMsg({ role: 'asst', type: 'text', text: 'Proceeding with best version.' })
                  return Promise.resolve()
                }
              })
            }
          })
        }

        return runFinalReview()
      })
    }).catch(function (e) {
      var safeErr = scrubKeys(e.message || String(e))
      updatePS(pid, 6, 'warn', 'Enhancement review skipped: ' + safeErr)
      updatePS(pid, 7, 'skip', 'Skipped — review unavailable')
      updatePS(pid, 8, 'skip', 'Skipped — review unavailable')
      addMsg({ role: 'asst', type: 'text', text: 'Enhancement review skipped — continuing with current build.' })
      return Promise.resolve()
    })
  }).then(function () {
    // Step 9 — Backend
    checkPipelineCancel()
    if (ST.backendEnabled && ST.sbUrl) {
      updatePS(pid, 9, 'active', 'Generating Supabase backend\u2026')
      return callClaudeRaw(SYS_BACKEND, 'App code:\n\n' + v2.slice(0, 60000), 4000).then(function (raw) {
        var backend = JSON.parse(raw)
        var tables = backend.tables || []
        var allSql = tables.map(function (t) { return t.sql || '' }).concat(backend.rls || []).filter(Boolean).join('\n\n')
        updatePS(pid, 9, 'done', tables.length + ' table' + (tables.length !== 1 ? 's' : '') + ' designed \u2713')
        addMsg({ role: 'asst', type: 'schema', sql: allSql, tables: tables })
        if (backend.injectedHTML && backend.injectedHTML.indexOf('<!DOCTYPE') >= 0 && backend.injectedHTML.length > 500) { v2 = backend.injectedHTML }
      }).catch(function (e) {
        updatePS(pid, 9, 'warn', 'Backend gen skipped: ' + scrubKeys(e.message || String(e)))
      })
    } else {
      updatePS(pid, 9, 'skip', 'Backend off')
      return Promise.resolve()
    }
  }).then(function () {
    // Step 10 — Push to branch
    checkPipelineCancel()
    if (hasGitHub) {
      updatePS(pid, 10, 'active', 'Pushing to ' + branchName + '\u2026')
      var appPath = 'apps/' + appId + '.html'
      return retryStep(function () {
        return ghGetFileSha(appPath, branchName).then(function (existingSha) {
          return ghPushFile(appPath, v2, (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [branch]', branchName, existingSha)
        })
      }, 3, 'Push').then(function () {
        updatePS(pid, 10, 'done', 'Pushed to branch \u2713'); _persistProgress(10)
      }).catch(function (e) {
        updatePS(pid, 10, 'error', e.message)
        throw new Error('Branch push failed: ' + e.message)
      })
    } else {
      updatePS(pid, 10, 'skip', 'Local-only')
      return Promise.resolve()
    }
  }).then(function () {
    // Step 11 — Preview
    updatePS(pid, 11, 'done', 'Preview ready')
    setPreview(appId, v2)
    addMsg({ role: 'asst', type: 'preview-card', code: v2, appName: appName, branch: branchName || 'local', appId: appId, pid: pid })

    // Step 12 — Approval gate
    updatePS(pid, 12, 'wait', 'Waiting for your approval\u2026')
    addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
    notifyUser('Build Ready for Review', appName + ' is waiting for your approval.')

    return waitForApproval(pid)
  }).then(function () {
    updatePS(pid, 12, 'done', 'Approved \u2713')

    // Step 13 — Merge
    var mergeStatusId = 'merge-' + Date.now()
    if (hasGitHub) {
      updatePS(pid, 13, 'active', 'Merging to main\u2026')
      addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })
      return retryStep(function () { return ghMergeBranch(branchName, appName) }, 3, 'Merge').then(function () {
        return ghPushManifest('main').catch(function () {})
      }).then(function () {
        ghDeleteBranch(branchName)
        var liveUrl = ghPageUrl(appId)
        updatePS(pid, 13, 'done', 'Merged & deploying \u2713')
        var mc = $(mergeStatusId)
        if (mc) { var card = mc.querySelector('.merge-card'); if (card) card.innerHTML = '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><a class="merge-url" href="' + liveUrl + '" target="_blank">' + liveUrl + '</a><span class="merge-meta">GitHub Pages deploys in ~60s</span></div>' }
        _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, true)
        clearPreview(appId)
        toast('\uD83D\uDE80 ' + appName + ' is deploying!', 3500)
        return 'github'
      }).catch(function (e) {
        var safeE = scrubKeys(e.message || String(e))
        updatePS(pid, 13, 'error', safeE)
        clearPreview(appId)
        _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
        addMsg({ role: 'asst', type: 'text', html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. App saved locally.' })
        return 'local'
      })
    } else {
      updatePS(pid, 13, 'done', 'Saved locally \u2713')
      _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
      clearPreview(appId)
      toast('\u2705 ' + appName + ' saved!', 2800)
      return 'local'
    }
  }).then(function (mode) {
    ST.activeAppId = appId
    notifyUser('Build Complete', appName + (mode === 'github' ? ' is live on GitHub Pages!' : ' has been saved.'))
    $('ihint').textContent = '\uD83D\uDCAC Describe changes for a new build'
    $('bs-proj-btn').style.display = 'flex'
    renderGrid()
    // Show cost analysis card
    var costData = calculateBuildCost()
    if (costData.breakdown.length > 0) {
      addMsg({ role: 'asst', type: 'cost', cost: costData })
      // Persist cost on app object
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
    // Show feedback card if a profile is active
    return showFeedbackCard(appId, appName, prompt)
  }).catch(function (err) {
    if (err.message === 'PIPELINE_CANCELLED') {
      clearPreview(appId)
      _saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
      ST.activeAppId = appId
      addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
      toast('Pipeline stopped', 3000)
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }
    if (err.message === 'BUILDER_CLOSED') {
      clearPreview(appId)
      _saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
      ST.activeAppId = appId
      renderGrid()
      return
    }
    if (err.message === 'CHANGES_REQUESTED') {
      updatePS(pid, 12, 'error', 'Changes requested')
      clearPreview(appId)
      addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
      _saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
      ST.activeAppId = appId
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }
    clearPreview(appId || '')
    var safeMsg = scrubKeys(err.message || String(err))
    addMsg({ role: 'asst', type: 'text', text: 'Pipeline error: ' + safeMsg + '. Please try again.' })
    notifyUser('Build Failed', safeMsg)
    toast('Error: ' + safeMsg, 5000)
  }).finally(function () {
    _saveChatSession(appId, prompt)
    persist()
    clearBuildSession()
    clearPipelineSteps()
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false
    clearInterval(_keepAlive)
    document.removeEventListener('visibilitychange', _onVisChange)
    if (_wakeLock) { try { _wakeLock.release() } catch (e) {} _wakeLock = null }
    if (_lockRelease) { try { _lockRelease() } catch (e) {} _lockRelease = null }
    try { localStorage.removeItem('bldr_ping') } catch (e) {}
  })
}

function _saveChatSession(appId, prompt) {
  var session = getCurrentSession()
  if (!session.length) return
  var app = null; for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === appId) { app = ST.apps[i]; break } }
  if (!app) return
  if (!app.chatHistory) app.chatHistory = []
  app.chatHistory.unshift({ id: 's' + Date.now(), ts: new Date().toISOString(), prompt: (prompt || '').slice(0, 200), messages: session })
  if (app.chatHistory.length > 10) app.chatHistory = app.chatHistory.slice(0, 10)
  clearCurrentSession()
}

function _saveAppLocally(id, name, icon, ci, code, prompt, existingApp, ghPushed) {
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

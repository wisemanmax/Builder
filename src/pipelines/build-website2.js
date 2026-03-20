import { ST, persist } from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { MAX_FIX_PASSES } from '../config/constants.js'
import { callClaudeRaw, callClaudeMultiTurn, callClaudeWithThinkingStream, callClaudeAudit, callGPTRaw2, callGPTMultiTurn2, callGPTWithStream, callGPTAudit2, resetCostAccum } from '../lib/ai.js'
import { calculateBuildCost } from '../lib/cost.js'
import { injectProfileContext, formatBriefWithConversation, mergeRulesWithProfile } from '../lib/profile-context.js'
import { ghCreateBranch, ghPushFile, ghGetFileSha, ghMergeBranch, ghDeleteBranch, ghPushManifest } from '../lib/github.js'
import { runLocalChecks } from '../lib/checks.js'
import { addMsg, updatePS, scrollBot, getCurrentSession, clearCurrentSession, registerPipeType, getPipelineSteps, clearPipelineSteps } from '../components/message.js'
import { persistBuildSession, clearBuildSession, checkPipelineCancel, clearPipelineCancel } from '../lib/state.js'
import { setPreview, clearPreview, waitForApproval } from '../components/approval-card.js'
import { showFeedbackCard } from '../components/feedback-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { openProjectSheet } from '../screens/project.js'
import {
  SYS_WEB2_RECON, SYS_WEB2_BRAND, SYS_WEB2_STRUCTURE, SYS_WEB2_DESIGN, SYS_WEB2_BUILD, SYS_WEB2_UPDATE, SYS_WEB2_FIX, SYS_WEB2_AUDIT
} from '../config/prompts-website2.js'
import { SYS_AUDIT } from '../config/prompts.js'
import { createStreamingPreview } from '../lib/streaming-preview.js'
import { autoInjectSupabase } from '../lib/supabase-setup.js'

// Provider-aware wrappers — route to Claude or GPT based on user toggle
function _raw(sys, msg, maxTokens, images) {
  return ST.website2Provider === 'chatgpt' ? callGPTRaw2(sys, msg, maxTokens, images) : callClaudeRaw(sys, msg, maxTokens, images)
}
function _multiTurn(sys, messages, temperature) {
  return ST.website2Provider === 'chatgpt' ? callGPTMultiTurn2(sys, messages, temperature) : callClaudeMultiTurn(sys, messages, temperature)
}
function _buildStream(sys, msg, thinkingBudget, onChunk, images) {
  if (ST.website2Provider === 'chatgpt') return callGPTWithStream(sys, msg, onChunk, images)
  return callClaudeWithThinkingStream(sys, msg, thinkingBudget, onChunk, images)
}
function _audit(code, customSysPrompt) {
  return ST.website2Provider === 'chatgpt' ? callGPTAudit2(code, customSysPrompt) : callClaudeAudit(code, customSysPrompt)
}
function _providerName() { return ST.website2Provider === 'chatgpt' ? 'ChatGPT' : 'Claude' }

// Check IDs that are advisory-only
var ADVISORY_CHECK_IDS = ['no-innerhtml-risk', 'fetch-calls', 'inline-styles', 'no-div-onclick', 'no-innerhtml-xss', 'has-css-vars', 'has-main', 'responsive-typography', 'touch-friendly-inputs']

// Retry wrapper for pipeline steps
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
        console.warn('[Website2] ' + (label || 'Step') + ' failed (attempt ' + (n + 1) + '), retrying in ' + (delay / 1000) + 's:', e.message)
        return new Promise(function (resolve) { setTimeout(resolve, delay) }).then(function () {
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

function notifyUser(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      var n = new Notification(title, {
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%233D5AFE%22/%3E%3Ctext x=%2250%22 y=%2268%22 font-size=%2256%22 text-anchor=%22middle%22%3E%F0%9F%8C%90%3C/text%3E%3C/svg%3E',
        tag: 'website2-pipeline',
        renotify: true,
      })
      n.onclick = function () { window.focus(); n.close() }
    }
  } catch (e) {}
}

/**
 * Website Builder 2 — Claude-Only Single-File Pipeline (Revised, 12 steps)
 * 0: Recon  1: Brand Extraction  2: Structure Map  3: Design Decisions  4: Build
 * 5: Checks  6: Claude Audit  7: Fix
 * 8: Push  9: Preview  10: Approval  11: Merge
 */
export function runWebsite2Pipeline(prompt, existingApp, customName, images) {
  resetCostAccum()
  // Validate API key for selected provider
  if (ST.website2Provider === 'chatgpt' && !ST.gptKey) {
    addMsg({ role: 'asst', type: 'text', text: 'OpenAI API key is required to use ChatGPT. Add it in Settings, or switch to Claude.' })
    return
  }
  if (ST.website2Provider !== 'chatgpt' && !ST.key) {
    addMsg({ role: 'asst', type: 'text', text: 'Anthropic API key is required. Add it in Settings.' })
    return
  }
  clearCurrentSession()
  clearPipelineCancel()
  ST._building = true; $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  registerPipeType(pid, 'website2')
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel'); if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid, pipelineType: 'website2' })
  }, 0)

  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission() } catch (e) {}

  var _wakeLock = null
  function acquireWakeLock() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (wl) { _wakeLock = wl }).catch(function () {}) } catch (e) {} }
  acquireWakeLock()
  function _onVisChange() { if (document.visibilityState === 'visible' && ST._building) acquireWakeLock() }
  document.addEventListener('visibilitychange', _onVisChange)
  var _keepAlive = setInterval(function () { try { localStorage.setItem('bldr_ping', Date.now()) } catch (e) {} }, 15000)

  var _lockRelease = null
  try {
    if (navigator.locks) {
      navigator.locks.request('website2-pipeline-' + pid, { mode: 'exclusive' }, function () {
        return new Promise(function (resolve) { _lockRelease = resolve })
      })
    }
  } catch (e) {}

  var appName = existingApp ? existingApp.name : ((customName && customName.trim()) || autoName(prompt))
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? ('builder/site2-' + appId + '-' + Date.now().toString(36)) : ''

  var v1, v2, reconJSON, brandJSON, structureJSON, designJSON, thinkingText, _streamPreview

  function _persistProgress(lastStep) {
    persistBuildSession({
      pid: pid, appId: appId, appName: appName, appIcon: appIcon,
      appCi: appCi, prompt: prompt, pipelineMode: 'website2',
      branchName: branchName, lastStep: lastStep,
      steps: getPipelineSteps(), ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: !!(v2 || v1)
    })
  }

  // Silent branch creation
  var p = Promise.resolve()
  if (hasGitHub) {
    p = retryStep(function () { return ghCreateBranch(branchName) }, 3, 'Branch').catch(function (e) {
      console.warn('[Website2] Branch creation failed, continuing local-only:', e.message)
      hasGitHub = false
      branchName = ''
    })
  }

  p.then(function () {
    // Step 0 — Recon (Data Gathering + Content Manifest)
    updatePS(pid, 0, 'active', 'Analyzing site content and structure\u2026')
    var reconMsg = 'Analyze this website/site description and extract all content, navigation, branding, and structure. Build a CONTENT_MANIFEST of every stat, name, number, and claim found:\n\n' + prompt
    if (images && images.length) reconMsg += '\n\n[' + images.length + ' screenshot' + (images.length > 1 ? 's' : '') + ' attached \u2014 analyze the visual design, layout, colors, typography, and content from these images]'

    // Inject think engine spec and rules into recon
    var activeThought = ST.activeThoughtId ? ST.thoughts.find(function (t) { return t.id === ST.activeThoughtId }) : null
    var _specText = ''
    var _rulesText = ''
    var effectiveReconSys = SYS_WEB2_RECON
    if (activeThought) {
      if (activeThought.brief) {
        _specText = formatBriefWithConversation(activeThought)
        effectiveReconSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + _specText
      }
      var linkedRules = activeThought.linkedRulesId ? ST.rules.find(function (r) { return r.id === activeThought.linkedRulesId }) : null
      var merged = mergeRulesWithProfile(linkedRules)
      if (merged.mustRules.length || merged.mustNotRules.length) {
        _rulesText = 'MUST DO:\n' + merged.mustRules.map(function (r) { return '- ' + r }).join('\n')
          + '\nMUST NOT DO:\n' + merged.mustNotRules.map(function (r) { return '- ' + r }).join('\n')
        if (merged.niceToHave.length) _rulesText += '\nNICE TO HAVE:\n' + merged.niceToHave.map(function (r) { return '- ' + r }).join('\n')
        effectiveReconSys += '\n\nUSER RULES (follow these constraints strictly):\n' + _rulesText
      }
    }
    return retryStep(function () { return _raw(effectiveReconSys, reconMsg, 6000, images) }, 2, 'Recon').then(function (raw) {
      reconJSON = raw
      updatePS(pid, 0, 'done', 'Recon complete \u2713'); _persistProgress(0)
      addMsg({ role: 'asst', type: 'text', text: 'Site content, structure, and content manifest extracted.' })
    }).catch(function (e) {
      // If recon fails, use the prompt as-is for later steps
      reconJSON = '{"siteName":"' + appName + '","description":"' + prompt.slice(0, 200).replace(/"/g, '\\"') + '","contentManifest":{"stats":[],"names":[],"claims":[],"urls":[]}}'
      updatePS(pid, 0, 'warn', 'Recon partial: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 1 — Brand Extraction (locks brand tokens BEFORE design decisions)
    updatePS(pid, 1, 'active', 'Extracting brand identity tokens\u2026')
    var brandSys = SYS_WEB2_BRAND.replace('{RECON}', reconJSON)
    return retryStep(function () { return _raw(brandSys, 'Extract brand tokens from the recon data. Scan for fonts, colors, border-radius, shadows, and gradients. If not found in CSS, derive from brand name + industry context. Never default to Inter.', 3000, images) }, 2, 'Brand').then(function (raw) {
      brandJSON = raw
      updatePS(pid, 1, 'done', 'Brand tokens locked \u2713'); _persistProgress(1)
      addMsg({ role: 'asst', type: 'text', text: 'Brand colors, fonts, and design tokens extracted.' })
    }).catch(function (e) {
      brandJSON = '{}'
      updatePS(pid, 1, 'warn', 'Brand extraction partial: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 2 — Structural Mapping (no invented pages)
    updatePS(pid, 2, 'active', 'Building site map and component tree\u2026')
    var structSys = SYS_WEB2_STRUCTURE.replace('{RECON}', reconJSON)
    return retryStep(function () { return _raw(structSys, 'Create the structural map for this site based on the recon data above. Only include pages found in the real site navigation — do not invent pages.', 4000, null) }, 2, 'Structure').then(function (raw) {
      structureJSON = raw
      updatePS(pid, 2, 'done', 'Structure mapped \u2713'); _persistProgress(2)
      addMsg({ role: 'asst', type: 'text', text: 'Site map and component tree ready.' })
    }).catch(function (e) {
      structureJSON = '{}'
      updatePS(pid, 2, 'warn', 'Structure partial: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 3 — Design Decisions (uses BRAND_TOKENS as required input)
    updatePS(pid, 3, 'active', 'Deciding colors, typography, and layout\u2026')
    var designSys = SYS_WEB2_DESIGN.replace('{BRAND}', brandJSON).replace('{STRUCTURE}', structureJSON)
    return retryStep(function () { return _raw(designSys, 'Make all design decisions using the brand tokens provided. Use BRAND_TOKENS colors verbatim. Do not override with generic palettes. Inter/Roboto/Arial are banned.', 4000, images) }, 2, 'Design').then(function (raw) {
      designJSON = raw
      updatePS(pid, 3, 'done', 'Design system defined \u2713'); _persistProgress(3)
      addMsg({ role: 'asst', type: 'text', text: 'Color palette, typography, and layout locked in.' })
    }).catch(function (e) {
      designJSON = '{}'
      updatePS(pid, 3, 'warn', 'Design partial: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 4 — Build (single-file HTML)
    updatePS(pid, 4, 'active', _providerName() + ' is building the website\u2026')
    var buildMsg
    if (existingApp) {
      var currentCode = existingApp.code || ''
      var prevPrompts = (existingApp.prompts || []).map(function (p2) { return p2.text }).join('\n\u2192 ')
      var codeSection = currentCode ? '\n\nCURRENT SITE CODE:\n' + currentCode.slice(0, 120000) : ''
      var historySection = prevPrompts ? '\n\nBUILD HISTORY (for context):\n' + prevPrompts : ''
      buildMsg = 'CHANGE REQUEST: ' + prompt + historySection + codeSection + '\n\nApply the requested change to the existing code above. Return the complete modified HTML.'
    } else {
      buildMsg = 'BUILD THIS WEBSITE: ' + prompt
        + '\n\nCONTEXT: Single-file HTML website with multi-page routing via showPage(). All pages in one file.'
    }

    buildMsg += '\n\nRECON DATA (SOURCE CONTENT — use this, do not invent):\n' + reconJSON
    buildMsg += '\n\nBRAND TOKENS:\n' + brandJSON
    buildMsg += '\n\nSTRUCTURE MAP:\n' + structureJSON
    buildMsg += '\n\nDESIGN DECISIONS:\n' + designJSON

    if (images && images.length) buildMsg += '\n\n[' + images.length + ' screenshot' + (images.length > 1 ? 's' : '') + ' attached \u2014 replicate the visual design as closely as possible]'

    // Inject think engine context into build system prompt
    var effectiveBuildSys = existingApp ? SYS_WEB2_UPDATE : SYS_WEB2_BUILD
    if (activeThought) {
      if (_rulesText) effectiveBuildSys += '\n\nUSER RULES (follow these constraints strictly):\n' + _rulesText
      if (_specText) effectiveBuildSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + _specText
      if (!existingApp && activeThought.brief) {
        buildMsg = 'BUILD THIS WEBSITE: ' + (activeThought.brief.name || customName || 'My Site')
          + '\n\nAdditional notes from user: ' + prompt
          + '\n\nCONTEXT: Single-file HTML website with multi-page routing via showPage(). All pages in one file.'
          + '\n\nRECON DATA (SOURCE CONTENT \u2014 use this, do not invent):\n' + reconJSON
          + '\n\nBRAND TOKENS:\n' + brandJSON
          + '\n\nSTRUCTURE MAP:\n' + structureJSON
          + '\n\nDESIGN DECISIONS:\n' + designJSON
        if (images && images.length) buildMsg += '\n\n[' + images.length + ' screenshot' + (images.length > 1 ? 's' : '') + ' attached \u2014 replicate the visual design as closely as possible]'
      }
    }
    effectiveBuildSys = injectProfileContext(effectiveBuildSys)

    var charCount = 0
    thinkingText = ''
    // Set up streaming live preview
    _streamPreview = null
    var previewIframe = $('viewer-iframe')
    if (previewIframe) _streamPreview = createStreamingPreview('viewer-iframe')

    return _buildStream(effectiveBuildSys, buildMsg, 4000, function (type, text) {
      if (type === 'text') {
        charCount += text.length; updatePS(pid, 4, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars')
        if (_streamPreview) _streamPreview.pushChunk(text)
      }
      else if (type === 'thinking') { thinkingText += text }
    }, images)
  }).then(function (code) {
    v1 = code
    if (_streamPreview) { _streamPreview.finalize(v1); _streamPreview.destroy() }
    updatePS(pid, 4, 'done', 'Build complete \u2713'); _persistProgress(4)
    _saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
    if (thinkingText.trim()) {
      addMsg({ role: 'asst', type: 'thinking', text: thinkingText.trim() })
    }

    var currentCode = v1
    var passNum = 0
    var totalFixed = 0
    var repairHistory = []
    var fixSys = SYS_WEB2_FIX.replace('{RECON}', reconJSON)
    if (_rulesText) fixSys += '\n\nUSER RULES (follow these constraints strictly):\n' + _rulesText

    function runValidationPass() {
      passNum++
      var passLabel = passNum > 1 ? ' (pass ' + passNum + '/' + MAX_FIX_PASSES + ')' : ''

      // Step 5 — Automated Checks (+ hallucination, brand fidelity, URL integrity)
      updatePS(pid, 5, 'active', 'Running checks' + passLabel + '\u2026')
      var checks = runLocalChecks(currentCode)
      var criticalFails = checks.filter(function (c) { return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1 })
      addMsg({ role: 'asst', type: 'checks', checks: checks })
      updatePS(pid, 5, criticalFails.length ? 'warn' : 'done',
        criticalFails.length ? (criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found' + passLabel) : 'All checks passed' + passLabel + ' \u2713')

      // Step 6 — Claude Audit (compares against real source content)
      updatePS(pid, 6, 'active', _providerName() + ' auditing website' + passLabel + '\u2026')
      var auditSys = SYS_WEB2_AUDIT.replace('{BRAND}', brandJSON || '{}').replace('{MANIFEST}', reconJSON || '{}')
      return retryStep(function () { return _audit(currentCode, auditSys) }, 2, 'Audit').then(function (bugs) {
        updatePS(pid, 6, 'done', bugs.length ? ('Found ' + bugs.length + ' issue' + (bugs.length !== 1 ? 's' : '') + passLabel) : 'Website is clean' + passLabel + ' \u2713')
        if (bugs.length) addMsg({ role: 'asst', type: 'audit', bugs: bugs, source: ST.website2Provider === 'chatgpt' ? 'chatgpt' : 'claude' })
        return { criticalFails: criticalFails, bugs: bugs }
      }).catch(function (e) {
        var auditErr = scrubKeys(e.message || String(e))
        updatePS(pid, 6, 'error', 'Audit failed' + passLabel + ': ' + auditErr)
        return { criticalFails: criticalFails, bugs: [] }
      }).then(function (result) {
        var allIssues = result.criticalFails.map(function (c) { return { severity: 'medium', issue: c.label + (c.detail ? ' \u2014 ' + c.detail : ''), location: c.cat } }).concat(result.bugs)

        // Step 7 — Claude Fix
        if (allIssues.length > 0) {
          updatePS(pid, 7, 'active', 'Fixing ' + allIssues.length + ' issue' + (allIssues.length !== 1 ? 's' : '') + passLabel + '\u2026')
          var issueList = allIssues.map(function (b, i) { return (i + 1) + '. [' + ((b.severity || 'medium').toUpperCase()) + '] ' + (b.issue || '') + ' \u2014 ' + (b.location || '') }).join('\n')

          var fm
          if (passNum === 1) {
            fm = 'ISSUES TO FIX:\n' + issueList + '\n\nORIGINAL CODE:\n' + currentCode
          } else {
            fm = 'REMAINING ISSUES after pass ' + (passNum - 1) + ':\n' + issueList + '\n\nFix these without reintroducing previously resolved issues.'
          }
          repairHistory.push({ role: 'user', content: fm })

          return retryStep(function () { return _multiTurn(fixSys, repairHistory) }, 2, 'Fix').then(function (fixed) {
            repairHistory.push({ role: 'assistant', content: fixed })
            currentCode = fixed
            totalFixed += allIssues.length
            if (passNum < MAX_FIX_PASSES) {
              updatePS(pid, 7, 'active', 'Re-validating fixes' + passLabel + '\u2026')
              return runValidationPass()
            } else {
              var finalChecks = runLocalChecks(currentCode)
              var finalFails = finalChecks.filter(function (c) { return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1 })
              if (finalFails.length > 0) {
                updatePS(pid, 7, 'warn', finalFails.length + ' issue' + (finalFails.length !== 1 ? 's' : '') + ' remain after ' + MAX_FIX_PASSES + ' passes')
              } else {
                updatePS(pid, 7, 'done', 'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713')
              }
              v2 = currentCode
              addMsg({ role: 'asst', type: 'text', text: 'Validation summary: ' + totalFixed + ' issue' + (totalFixed !== 1 ? 's' : '') + ' addressed across ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + '.' + (finalFails.length > 0 ? ' ' + finalFails.length + ' minor issue' + (finalFails.length !== 1 ? 's' : '') + ' may remain.' : '') })
            }
          }).catch(function (e) {
            v2 = currentCode
            updatePS(pid, 7, 'error', 'Fix pass failed \u2014 using ' + (passNum > 1 ? 'last good version' : 'original'))
            addMsg({ role: 'asst', type: 'text', text: 'Fix error: ' + scrubKeys(e.message || String(e)) })
          })
        } else {
          v2 = currentCode
          if (passNum === 1) {
            updatePS(pid, 7, 'done', 'No fixes needed \u2713')
          } else {
            updatePS(pid, 7, 'done', 'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713')
            addMsg({ role: 'asst', type: 'text', text: 'Validation summary: ' + totalFixed + ' issue' + (totalFixed !== 1 ? 's' : '') + ' addressed across ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + '. Website is clean \u2713' })
          }
          return Promise.resolve()
        }
      })
    }

    return runValidationPass()
  }).then(function () {
    // Supabase auto-injection
    if (v2 && ST.backendEnabled && ST.sbUrl) { v2 = autoInjectSupabase(v2) }

    // Step 8 — Push to branch
    if (hasGitHub) {
      updatePS(pid, 8, 'active', 'Pushing to ' + branchName + '\u2026')
      var appPath = 'apps/' + appId + '.html'
      return retryStep(function () {
        return ghGetFileSha(appPath, branchName).then(function (existingSha) {
          return ghPushFile(appPath, v2, (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [website2]', branchName, existingSha)
        })
      }, 3, 'Push').then(function () {
        updatePS(pid, 8, 'done', 'Pushed to branch \u2713'); _persistProgress(8)
      }).catch(function (e) {
        updatePS(pid, 8, 'error', e.message)
        throw new Error('Branch push failed: ' + e.message)
      })
    } else {
      updatePS(pid, 8, 'skip', 'Local-only')
      return Promise.resolve()
    }
  }).then(function () {
    // Step 9 — Preview
    updatePS(pid, 9, 'done', 'Preview ready')
    setPreview(appId, v2)
    addMsg({ role: 'asst', type: 'preview-card', code: v2, appName: appName, branch: branchName || 'local', appId: appId, pid: pid })

    // Step 10 — Final Validation (approval gate)
    updatePS(pid, 10, 'wait', 'Waiting for your approval\u2026')
    addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
    notifyUser('Website Ready for Review', appName + ' is waiting for your approval.')

    return waitForApproval(pid)
  }).then(function () {
    updatePS(pid, 10, 'done', 'Approved \u2713')

    // Step 11 — Merge to main
    var mergeStatusId = 'merge-' + Date.now()
    if (hasGitHub) {
      updatePS(pid, 11, 'active', 'Merging to main\u2026')
      addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })
      return retryStep(function () { return ghMergeBranch(branchName, appName) }, 3, 'Merge').then(function () {
        return ghPushManifest('main').catch(function () {})
      }).then(function () {
        ghDeleteBranch(branchName)
        var liveUrl = ghPageUrl(appId)
        updatePS(pid, 11, 'done', 'Merged & deploying \u2713')
        var mc = $(mergeStatusId)
        if (mc) { var card = mc.querySelector('.merge-card'); if (card) card.innerHTML = '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><a class="merge-url" href="' + liveUrl + '" target="_blank">' + liveUrl + '</a><span class="merge-meta">GitHub Pages deploys in ~60s</span></div>' }
        _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, true)
        clearPreview(appId)
        toast('\uD83C\uDF10 ' + appName + ' is deploying!', 3500)
        return 'github'
      }).catch(function (e) {
        var safeE = scrubKeys(e.message || String(e))
        updatePS(pid, 11, 'error', safeE)
        clearPreview(appId)
        _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
        addMsg({ role: 'asst', type: 'text', html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. Website saved locally.' })
        return 'local'
      })
    } else {
      updatePS(pid, 11, 'done', 'Saved locally \u2713')
      _saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
      clearPreview(appId)
      toast('\u2705 ' + appName + ' saved!', 2800)
      return 'local'
    }
  }).then(function (mode) {
    ST.activeAppId = appId
    notifyUser('Website Complete', appName + (mode === 'github' ? ' is live on GitHub Pages!' : ' has been saved.'))
    $('ihint').textContent = '\uD83D\uDCAC Describe changes for a new build'
    $('bs-proj-btn').style.display = 'flex'
    renderGrid()
    // Show cost analysis card
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
      updatePS(pid, 10, 'error', 'Changes requested')
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
    notifyUser('Website Build Failed', safeMsg)
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

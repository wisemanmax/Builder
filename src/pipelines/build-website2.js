import {
  retryStep, notifyUser, setupPipelineGuards, resolveThoughtContext,
  saveAppLocally, saveChatSession, formatTemplateInjection,
  ADVISORY_CHECK_IDS,
  ST, persist, persistBuildSession, clearBuildSession, checkPipelineCancel, clearPipelineCancel,
  $, esc, toast, grad, uniqueSlug, autoName, scrubKeys, ghPageUrl,
  MAX_FIX_PASSES,
  callClaudeRaw, callClaudeMultiTurn, callClaudeWithThinkingStream, callClaudeAudit,
  callGPTRaw2, callGPTMultiTurn2, callGPTWithStream, callGPTAudit2,
  resetCostAccum,
  calculateBuildCost,
  ghCreateBranch, ghPushFile, ghGetFileSha, ghMergeBranch, ghDeleteBranch, ghPushManifest,
  runLocalChecks,
  addMsg, updatePS, scrollBot, clearCurrentSession, registerPipeType, getPipelineSteps, clearPipelineSteps,
  setPreview, clearPreview, waitForApproval,
  createStreamingPreview, autoInjectSupabase,
  showFeedbackCard, renderGrid, openProjectSheet,
  injectProfileContext, getThoughtDesignOverrides, getTemplateSkeleton
} from './pipeline-shared.js'
import {
  SYS_WEB2_RECON, SYS_WEB2_BRAND, SYS_WEB2_STRUCTURE, SYS_WEB2_DESIGN, SYS_WEB2_BUILD, SYS_WEB2_UPDATE, SYS_WEB2_FIX, SYS_WEB2_AUDIT
} from '../config/prompts-website2.js'
import { SYS_AUDIT } from '../config/prompts.js'

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

  var guards = setupPipelineGuards(pid)

  var appName = existingApp ? existingApp.name : ((customName && customName.trim()) || autoName(prompt))
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? ('builder/site2-' + appId + '-' + Date.now().toString(36)) : ''

  var v1, v2, reconJSON, brandJSON, structureJSON, designJSON, thinkingText, _streamPreview
  var activeThought, _specText, _rulesText

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

  var _templateSkeleton = null
  var _thoughtDesign = null
  if (!existingApp && ST._pendingTemplate) {
    var pending = ST._pendingTemplate
    ST._pendingTemplate = null
    var activeThoughtTpl = ST.activeThoughtId ? ST.thoughts.find(function (t) { return t.id === ST.activeThoughtId }) : null
    _thoughtDesign = getThoughtDesignOverrides(activeThoughtTpl)
    p = p.then(function () {
      return (pending.skeleton ? Promise.resolve(pending.skeleton) : getTemplateSkeleton(pending.id))
        .then(function (skeleton) { _templateSkeleton = skeleton })
    })
  }

  p.then(function () {
    // Step 0 — Recon (Data Gathering + Content Manifest)
    updatePS(pid, 0, 'active', 'Analyzing site content and structure\u2026')
    var reconMsg = 'Analyze this website/site description and extract all content, navigation, branding, and structure. Build a CONTENT_MANIFEST of every stat, name, number, and claim found:\n\n' + prompt
    if (images && images.length) reconMsg += '\n\n[' + images.length + ' screenshot' + (images.length > 1 ? 's' : '') + ' attached \u2014 analyze the visual design, layout, colors, typography, and content from these images]'

    var thoughtCtx = resolveThoughtContext()
    activeThought = thoughtCtx.activeThought
    _specText = thoughtCtx.specText !== 'No specification provided' ? thoughtCtx.specText : ''
    _rulesText = thoughtCtx.rulesText !== 'No specific rules' ? thoughtCtx.rulesText : ''
    var effectiveReconSys = SYS_WEB2_RECON
    if (_specText) effectiveReconSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + _specText
    if (_rulesText) effectiveReconSys += '\n\nUSER RULES (follow these constraints strictly):\n' + _rulesText
    if (_templateSkeleton) {
      reconMsg += formatTemplateInjection(_templateSkeleton, _thoughtDesign)
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
    saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
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
        saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, true)
        clearPreview(appId)
        toast('\uD83C\uDF10 ' + appName + ' is deploying!', 3500)
        return 'github'
      }).catch(function (e) {
        var safeE = scrubKeys(e.message || String(e))
        updatePS(pid, 11, 'error', safeE)
        clearPreview(appId)
        saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
        addMsg({ role: 'asst', type: 'text', html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. Website saved locally.' })
        return 'local'
      })
    } else {
      updatePS(pid, 11, 'done', 'Saved locally \u2713')
      saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
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
      saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
      ST.activeAppId = appId
      addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
      toast('Pipeline stopped', 3000)
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }
    if (err.message === 'BUILDER_CLOSED') {
      clearPreview(appId)
      saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
      ST.activeAppId = appId
      renderGrid()
      return
    }
    if (err.message === 'CHANGES_REQUESTED') {
      updatePS(pid, 10, 'error', 'Changes requested')
      clearPreview(appId)
      addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
      saveAppLocally(appId, appName, appIcon, appCi, v2 || v1 || '', prompt, existingApp, false)
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
    saveChatSession(appId, prompt)
    persist()
    clearBuildSession()
    clearPipelineSteps()
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false
    guards.cleanup()
  })
}


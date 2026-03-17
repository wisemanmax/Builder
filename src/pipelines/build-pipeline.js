import { ST, persist } from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { MAX_FIX_PASSES } from '../config/constants.js'
import { SYS_BUILD, SYS_FIX, SYS_ENHANCE, SYS_BACKEND, SYS_PLAN } from '../config/prompts.js'
import { callClaude, callClaudeMultiTurn, callClaudeRaw, callClaudeWithThinkingStream, callGPT, callGPTReview } from '../lib/ai.js'
import { ghCreateBranch, ghPushFile, ghGetFileSha, ghMergeBranch, ghDeleteBranch, ghPushManifest } from '../lib/github.js'
import { runLocalChecks } from '../lib/checks.js'
import { addMsg, updatePS, scrollBot } from '../components/message.js'
import { setPreview, clearPreview, waitForApproval, waitForRetryDecision } from '../components/approval-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { openProjectSheet } from '../screens/project.js'

export function runPipeline(prompt, existingApp, customName) {
  ST._building = true; $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel'); if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid })
  }, 0)

  var _wakeLock = null
  function acquireWakeLock() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (wl) { _wakeLock = wl }).catch(function () {}) } catch (e) {} }
  acquireWakeLock()
  var _keepAlive = setInterval(function () { try { localStorage.setItem('bldr_ping', Date.now()) } catch (e) {} }, 15000)

  var appName = existingApp ? existingApp.name : ((customName && customName.trim()) || autoName(prompt))
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? ('builder/app-' + appId + '-' + Date.now().toString(36)) : ''

  var v1, v2, specText, rulesText, fixSys

  function withContext(sysPrompt) {
    return sysPrompt.replace('{SPEC}', specText).replace('{RULES}', rulesText)
  }

  // Step 0 — Branch
  var p = Promise.resolve()
  if (hasGitHub) {
    updatePS(pid, 0, 'active', 'Creating feature branch\u2026')
    p = ghCreateBranch(branchName).then(function () {
      updatePS(pid, 0, 'done', branchName)
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
    updatePS(pid, 1, 'active', 'Claude is planning the architecture\u2026')
    return callClaudeRaw(SYS_PLAN, 'App description: ' + prompt, 2000).then(function (raw) {
      planJSON = raw
      updatePS(pid, 1, 'done', 'Architecture planned \u2713')
      addMsg({ role: 'asst', type: 'text', text: 'Architecture plan ready.' })
    }).catch(function (e) {
      updatePS(pid, 1, 'warn', 'Planning skipped: ' + scrubKeys(e.message || String(e)))
    })
  }).then(function () {
    // Step 2 — Build
    updatePS(pid, 2, 'active', 'Claude is writing your app\u2026')
    var userMsg
    if (existingApp) {
      var prevPrompts = (existingApp.prompts || []).map(function (p2) { return p2.text }).join('\n\u2192 ')
      var appDesc = prevPrompts || existingApp.desc || existingApp.name || 'an existing app'
      userMsg = 'Rebuild this app from scratch with the following change:\n\nOriginal app: ' + appDesc + '\n\nChange request: ' + prompt + '\n\nRebuild the complete app with this change applied.'
    } else {
      userMsg = 'BUILD REQUEST: ' + prompt
        + '\n\nCONTEXT:'
        + '\n- This will be a single-file HTML app running in a sandboxed iframe'
        + '\n- It must work completely offline (no backend unless Supabase is configured)'
        + '\n- Data persistence: localStorage only'
        + '\n\nRESPONSIVE DESIGN REQUIREMENTS (NON-NEGOTIABLE):'
        + '\n- Mobile-first: design for 320px minimum, scale up with min-width media queries'
        + '\n- Required breakpoints: 480px, 768px, 1024px minimum'
        + '\n- Grids must use auto-fill/auto-fit with minmax() to naturally reflow'
        + '\n- Navigation must collapse to hamburger/bottom nav on mobile'
        + '\n- Modals must be full-screen on mobile, centered card on desktop'
        + '\n- All touch targets 44x44px minimum, inputs 44px+ height with 16px+ font-size'
        + '\n- Use clamp() for fluid typography'
        + '\n- No fixed widths on containers — use max-width + width: 100%'
        + '\n\nQUALITY REQUIREMENTS:'
        + '\n- Must look like a polished, professional SaaS product'
        + '\n- Include 5-8 realistic sample/demo data items so the app looks populated on first load'
        + '\n- Handle edge cases: empty states with helpful CTAs, error states with recovery, loading skeletons'
        + '\n- Smooth transitions on all view/state changes (200-300ms ease)'
        + '\n- Complete CSS custom property color system for theming'
        + '\n- Professional font pairing from Google Fonts'
    }

    var effectiveSys = SYS_BUILD
    specText = 'No specification provided'
    rulesText = 'No specific rules'
    var activeThought = ST.activeThoughtId ? ST.thoughts.find(function (t) { return t.id === ST.activeThoughtId }) : null
    if (activeThought) {
      var linkedRules = activeThought.linkedRulesId ? ST.rules.find(function (r) { return r.id === activeThought.linkedRulesId }) : null
      if (linkedRules) {
        rulesText = 'MUST DO:\n' + (linkedRules.mustRules || []).map(function (r) { return '- ' + r }).join('\n')
          + '\nMUST NOT DO:\n' + (linkedRules.mustNotRules || []).map(function (r) { return '- ' + r }).join('\n')
        if (linkedRules.niceToHave && linkedRules.niceToHave.length) {
          rulesText += '\nNICE TO HAVE:\n' + (linkedRules.niceToHave || []).map(function (r) { return '- ' + r }).join('\n')
        }
        effectiveSys += '\n\nUSER RULES (follow these constraints strictly):\n' + rulesText
      }
      if (activeThought.brief) {
        specText = 'App Name: ' + (activeThought.brief.name || 'App') + '\n'
          + 'What it does: ' + (activeThought.brief.whatItDoes || []).join(', ') + '\n'
          + 'What it won\'t do: ' + (activeThought.brief.whatItWontDo || []).join(', ') + '\n'
          + 'Target audience: ' + (activeThought.brief.audience || 'General') + '\n'
          + 'Key features: ' + (activeThought.brief.features || []).join(', ')
        if (activeThought.brief.design) {
          specText += '\nDesign: theme=' + (activeThought.brief.design.theme || 'dark') + ', accent=' + (activeThought.brief.design.accent || 'blue') + ', layout=' + (activeThought.brief.design.layout || 'standard')
        }
        effectiveSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + specText
      }
      if (!existingApp && activeThought.brief) {
        userMsg = 'Build this app based on the specification above.\n\nApp Name: ' + (activeThought.brief.name || customName || 'My App') + '\n\nAdditional notes from user: ' + prompt
      }
    }

    if (planJSON) { userMsg += '\n\nARCHITECTURE PLAN:\n' + planJSON }
    var charCount = 0
    return callClaudeWithThinkingStream(effectiveSys, userMsg, 4000, function (type, text) {
      if (type === 'text') { charCount += text.length; updatePS(pid, 2, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars') }
    })
  }).then(function (code) {
    v1 = code
    updatePS(pid, 2, 'done', 'Build complete \u2713')

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
      var criticalFails = checks.filter(function (c) { return !c.passed && ['no-innerhtml-risk', 'fetch-calls', 'inline-styles', 'no-div-onclick', 'no-innerhtml-xss', 'has-css-vars', 'has-main', 'responsive-typography', 'touch-friendly-inputs'].indexOf(c.id) === -1 })
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

          return callClaudeMultiTurn(fixSys, repairHistory).then(function (fixed) {
            repairHistory.push({ role: 'assistant', content: fixed })
            currentCode = fixed
            totalFixed += allIssues.length
            if (passNum < MAX_FIX_PASSES) {
              updatePS(pid, 5, 'active', 'Re-validating fixes' + passLabel + '\u2026')
              return runValidationPass()
            } else {
              var finalChecks = runLocalChecks(currentCode)
              var finalFails = finalChecks.filter(function (c) { return !c.passed && ['no-innerhtml-risk', 'fetch-calls', 'inline-styles', 'no-div-onclick', 'no-innerhtml-xss', 'has-css-vars', 'responsive', 'has-main'].indexOf(c.id) === -1 })
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
    var canReview = !!(ST.gptKey && ST.auditEnabled)
    if (!canReview) {
      updatePS(pid, 6, 'skip', ST.gptKey ? 'Review disabled' : 'No OpenAI key — skipped')
      updatePS(pid, 7, 'skip', 'Skipped — no review')
      updatePS(pid, 8, 'skip', 'Skipped — no review')
      return Promise.resolve()
    }
    updatePS(pid, 6, 'active', 'GPT-4o reviewing for enhancements…')
    return callGPTReview(v2).then(function (review) {
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

      return callClaude(withContext(SYS_ENHANCE), enhanceMsg).then(function (enhanced) {
        v2 = enhanced
        updatePS(pid, 7, 'done', 'Enhancements applied ✓')

        // Step 8 — GPT-4o Final Review (bug gate)
        updatePS(pid, 8, 'active', 'GPT-4o final bug review…')
        var MAX_REVIEW_PASSES = 2
        var reviewPass = 0

        function runFinalReview() {
          reviewPass++
          return callGPT(v2).then(function (bugs) {
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
              return callClaude(fixSys, fixMsg).then(function (fixed) {
                v2 = fixed
                return runFinalReview()
              })
            } else {
              updatePS(pid, 8, 'wait', criticalBugs.length + ' issue' + (criticalBugs.length !== 1 ? 's' : '') + ' remain after ' + reviewPass + ' passes')
              addMsg({ role: 'asst', type: 'retry-prompt', pid: pid, bugCount: criticalBugs.length })
              return waitForRetryDecision(pid).then(function (doRetry) {
                if (doRetry) {
                  updatePS(pid, 8, 'active', 'Claude is fixing remaining issues…')
                  var retryFixMsg = 'ISSUES TO FIX:\n' + criticalBugs.map(function (b, i) { return (i + 1) + '. [' + ((b.severity || 'medium').toUpperCase()) + '] ' + (b.issue || '') + ' — ' + (b.location || '') }).join('\n') + '\n\nORIGINAL CODE:\n' + v2
                  return callClaude(fixSys, retryFixMsg).then(function (fixed) {
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
      updatePS(pid, 6, 'error', 'Enhancement review failed: ' + safeErr)
      updatePS(pid, 7, 'skip', 'Skipped — review failed')
      updatePS(pid, 8, 'skip', 'Skipped — review failed')
      return Promise.resolve()
    })
  }).then(function () {
    // Step 9 — Backend
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
    if (hasGitHub) {
      updatePS(pid, 10, 'active', 'Pushing to ' + branchName + '\u2026')
      var appPath = 'apps/' + appId + '.html'
      return ghGetFileSha(appPath, branchName).then(function (existingSha) {
        return ghPushFile(appPath, v2, (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [branch]', branchName, existingSha)
      }).then(function () {
        updatePS(pid, 10, 'done', 'Pushed to branch \u2713')
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

    return waitForApproval(pid)
  }).then(function () {
    updatePS(pid, 12, 'done', 'Approved \u2713')

    // Step 13 — Merge
    var mergeStatusId = 'merge-' + Date.now()
    if (hasGitHub) {
      updatePS(pid, 13, 'active', 'Merging to main\u2026')
      addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })
      return ghMergeBranch(branchName, appName).then(function () {
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
    $('ihint').textContent = '\uD83D\uDCAC Describe changes for a new build'
    $('bs-proj-btn').style.display = 'flex'
    renderGrid()
    var g = grad(appCi)
    addMsg({
      role: 'asst', type: 'text',
      html: '<strong>' + esc(appName) + '</strong> ' + (mode === 'github' ? 'is live on GitHub Pages' : 'has been saved') + ' \uD83C\uDF89<br><br>'
        + '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">'
        + '<button onclick="openApp(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:' + g + ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open in Studio</button>'
        + '<button onclick="openProjectSheet(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>'
        + '</div>'
    })
  }).catch(function (err) {
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
    toast('Error: ' + safeMsg, 5000)
  }).finally(function () {
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false
    clearInterval(_keepAlive)
    if (_wakeLock) { try { _wakeLock.release() } catch (e) {} _wakeLock = null }
    try { localStorage.removeItem('bldr_ping') } catch (e) {}
  })
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

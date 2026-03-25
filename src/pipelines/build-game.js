import {
  retryStep,
  notifyUser,
  setupPipelineGuards,
  resolveThoughtContext,
  resolveTemplateWithDesign,
  buildEffectiveSys,
  buildUserMessage,
  saveAppLocally,
  saveChatSession,
  ADVISORY_CHECK_IDS,
  renderComplianceCard,
  formatTemplateInjection,
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
  SYS_SPEC_COMPLIANCE,
  callClaudeMultiTurn,
  callClaudeRaw,
  callClaudeWithThinkingStream,
  smartAudit,
  smartRaw,
  groqPreCheck,
  auditProviderLabel,
  resetCostAccum,
  calculateBuildCost,
  ghCreateBranch,
  ghPushFile,
  ghGetFileSha,
  ghMergeBranch,
  ghDeleteBranch,
  ghPushManifest,
  runLocalChecks,
  addMsg,
  updatePS,
  scrollBot,
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
  createStreamingPreview,
  autoInjectSupabase,
  showFeedbackCard,
  renderGrid,
  openProjectSheet,
  injectProfileContext,
  telemetry,
  shouldSkipStep,
  buildResumeContext,
} from './pipeline-shared.js'

import {
  SYS_BUILD_GAME,
  SYS_PLAN_GAME,
  SYS_AUDIT_GAME,
  SYS_FIX_GAME,
  SYS_GAME_CHECK_AI,
  SYS_STD_CHECK_AI,
} from '../config/prompts-game.js'

import { runGameChecks } from '../lib/checks-game.js'

// Game-specific advisory check IDs — these are informational, not blocking
var GAME_ADVISORY_IDS = [
  'has-particles',
  'has-audio',
  'has-object-pooling',
  'cdn-usage',
  'uses-threejs',
  'uses-matterjs',
  'uses-pixijs',
]

/**
 * Game Builder Pipeline — 10 steps
 * 0: Plan Game  1: Build  2: Game Checks  3: Standard Checks
 * 4: Game Audit  5: Fix  6: Push  7: Preview  8: Approval  9: Merge
 */
export function runGamePipeline(prompt, existingApp, resumeSession, images) {
  var customName = typeof resumeSession === 'string' ? resumeSession : null
  if (resumeSession && typeof resumeSession === 'string') resumeSession = null
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  registerPipeType(pid, 'game')
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel')
    if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid, pipelineType: 'game' })
  }, 0)

  // Request notification permission early
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
  } catch (e) {}

  var guards = setupPipelineGuards(pid)

  var appName = existingApp ? existingApp.name : (customName && customName.trim()) || autoName(prompt)
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName =
    (resumeSession && resumeSession.branchName) ||
    (hasGitHub ? 'builder/app-' + appId + '-' + Date.now().toString(36) : '')

  var _buildId = telemetry.startBuild(appId, 'game')
  var _br = telemetry.createBuildRecord(appId, 'game', prompt, {
    isUpdate: !!existingApp,
    thoughtId: ST.activeThoughtId || null,
    templateId: ST._pendingTemplate ? 'template' : null,
    hasImages: !!(images && images.length),
  })
  var _approvalStartTs = 0

  var v1, v2, specText, rulesText, fixSys, thinkingText, _streamPreview

  function withContext(sysPrompt) {
    return sysPrompt.replace('{SPEC}', specText).replace('{RULES}', rulesText)
  }

  // Persist build session for crash recovery
  function _persistProgress(lastStep) {
    persistBuildSession({
      pid: pid,
      appId: appId,
      appName: appName,
      appIcon: appIcon,
      appCi: appCi,
      prompt: prompt,
      pipelineMode: 'game',
      branchName: branchName,
      lastStep: lastStep,
      steps: getPipelineSteps(),
      ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: !!(v2 || v1),
    })
  }

  var _resumeCtx = resumeSession ? buildResumeContext(resumeSession) : ''
  var _isResuming = !!resumeSession
  if (_isResuming) {
    addMsg({ role: 'system', text: 'Resuming from previous session \u2014 skipping completed steps.' })
  }
  ST._resumeSession = null

  // Silent branch creation (not a visible step)
  var p = Promise.resolve()
  if (_isResuming && branchName) {
    updatePS(pid, 0, 'done', branchName + ' (reused)')
  } else if (hasGitHub) {
    p = retryStep(
      function () {
        return ghCreateBranch(branchName)
      },
      3,
      'Branch'
    ).catch(function (e) {
      console.warn('[GamePipeline] Branch creation failed, continuing local-only:', e.message)
      hasGitHub = false
      branchName = ''
    })
  }

  var planJSON = ''
  var TOTAL_STEPS = 10

  p.then(function () {
    // Start the build timer and ETA display
    startPipeTimer(pid)
    updatePipeETA(pid, '~2\u20134 min')
    updatePipeStep(pid, 1, TOTAL_STEPS)
    updatePipeProgress(pid, 2)

    // Step 0 — Plan Game Architecture
    checkPipelineCancel()
    updatePS(pid, 0, 'active', 'Planning game architecture\u2026')
    var planMsg = 'Game description: ' + prompt
    if (images && images.length)
      planMsg +=
        '\n\n[' +
        images.length +
        ' reference image' +
        (images.length > 1 ? 's' : '') +
        ' attached \u2014 study the visual style, gameplay mechanics, and UI layout]'
    if (_resumeCtx) planMsg += '\n\n' + _resumeCtx
    return retryStep(
      function () {
        return smartRaw(SYS_PLAN_GAME, planMsg, 3000, images)
      },
      2,
      'GamePlan'
    )
      .then(function (raw) {
        planJSON = raw
        updatePS(pid, 0, 'done', 'Game architecture planned \u2713')
        updatePipeStep(pid, 2, TOTAL_STEPS)
        updatePipeProgress(pid, 10)
        updatePipeETA(pid, '~2\u20133 min')
        telemetry.emit('build.plan', { planLength: raw.length })
        telemetry.updateBuildRecord(_buildId, 'plan', raw)
        _persistProgress(0)
        // Show the plan
        try {
          var plan = JSON.parse(raw)
          addMsg({
            role: 'asst',
            type: 'text',
            text:
              'Game plan: **' +
              (plan.gameName || 'Game') +
              '** (' +
              (plan.gameType || 'arcade') +
              ')\nRenderer: ' +
              (plan.renderEngine || 'canvas2d') +
              ' | Physics: ' +
              (plan.physics || 'custom') +
              ' | Audio: ' +
              (plan.audio || 'webaudio'),
          })
        } catch (e) {
          addMsg({ role: 'asst', type: 'text', text: 'Game architecture plan ready.' })
        }
      })
      .catch(function (e) {
        updatePS(pid, 0, 'warn', 'Planning skipped: ' + scrubKeys(e.message || String(e)))
      })
  })
    .then(function () {
      // Step 1 — Build the game
      checkPipelineCancel()
      updatePS(pid, 1, 'active', 'Building your game\u2026')
      updatePipeProgress(pid, 15)
      var thoughtCtx = resolveThoughtContext()
      specText = thoughtCtx.specText
      rulesText = thoughtCtx.rulesText
      var userMsg = buildUserMessage(prompt, existingApp, customName, thoughtCtx)

      // Resolve template skeleton with design customization
      var tplPromise = existingApp
        ? Promise.resolve()
        : resolveTemplateWithDesign(userMsg, thoughtCtx.thoughtDesign).then(function (msg) {
            userMsg = msg
          })

      return tplPromise.then(function () {
        // Use game-specific system prompt instead of standard SYS_BUILD
        var effectiveSys = buildEffectiveSys(SYS_BUILD_GAME, thoughtCtx)

        if (planJSON) {
          userMsg += '\n\nGAME ARCHITECTURE PLAN:\n' + planJSON
        }
        if (images && images.length) {
          userMsg +=
            '\n\n[' +
            images.length +
            ' reference image' +
            (images.length > 1 ? 's' : '') +
            ' attached \u2014 study them carefully and replicate the visual style, gameplay mechanics, and UI as closely as possible]'
        }
        var charCount = 0
        thinkingText = ''
        _streamPreview = null
        var previewIframe = $('viewer-iframe')
        if (previewIframe) _streamPreview = createStreamingPreview('viewer-iframe')

        return callClaudeWithThinkingStream(
          effectiveSys,
          userMsg,
          10000,
          function (type, text) {
            if (type === 'text') {
              charCount += text.length
              updatePS(pid, 1, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars')
              if (_streamPreview) _streamPreview.pushChunk(text)
            } else if (type === 'thinking') {
              thinkingText += text
            }
          },
          images
        )
      })
    })
    .then(function (code) {
      v1 = code
      if (_streamPreview) {
        _streamPreview.finalize(v1)
        _streamPreview.destroy()
      }
      updatePS(pid, 1, 'done', 'Game built \u2713')
      updatePipeStep(pid, 3, TOTAL_STEPS)
      updatePipeProgress(pid, 40)
      updatePipeETA(pid, '~1\u20132 min')
      telemetry.emit('build.code', { charCount: v1.length, hasThinking: !!thinkingText })
      telemetry.updateBuildRecord(_buildId, 'thinking', thinkingText || '')
      _persistProgress(1)
      saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
      if (thinkingText.trim()) {
        addMsg({ role: 'asst', type: 'thinking', text: thinkingText.trim() })
      }

      var currentCode = v1
      var passNum = 0
      var totalFixed = 0
      var repairHistory = []
      fixSys = withContext(SYS_FIX_GAME.replace('{INTENT}', prompt))

      function runValidationPass() {
        passNum++
        var passLabel = passNum > 1 ? ' (pass ' + passNum + '/' + MAX_FIX_PASSES + ')' : ''

        // Step 2 — Game-Specific Checks (local + AI via OpenAI top model)
        updatePS(pid, 2, 'active', 'Running game checks' + passLabel + '\u2026')
        if (passNum === 1) {
          updatePipeStep(pid, 3, TOTAL_STEPS)
          updatePipeProgress(pid, 45)
        }
        var gameChecks = runGameChecks(currentCode)
        var gameFails = gameChecks.filter(function (c) {
          return !c.passed && GAME_ADVISORY_IDS.indexOf(c.id) === -1
        })
        addMsg({ role: 'asst', type: 'checks', checks: gameChecks })

        // AI-powered game check (Gemini > GPT > Claude)
        var aiGameCheckPromise = retryStep(
          function () {
            return smartRaw(
              SYS_GAME_CHECK_AI,
              'GAME CONCEPT: ' + prompt + '\n\nGAME CODE:\n' + currentCode.slice(0, 50000),
              4000
            ).then(function (raw) {
              try {
                return JSON.parse(raw)
              } catch (e) {
                return []
              }
            })
          },
          1,
          'AIGameCheck'
        ).catch(function () {
          return []
        })

        // Step 3 — Standard Checks (local + AI via OpenAI top model)
        updatePS(pid, 3, 'active', 'Running standard checks' + passLabel + '\u2026')
        var stdChecks = runLocalChecks(currentCode)
        var criticalFails = stdChecks.filter(function (c) {
          return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
        })
        // For games, some standard checks are less relevant — filter out
        criticalFails = criticalFails.filter(function (c) {
          // Games legitimately use inline event handlers, may skip semantic <main>, etc.
          var gameExempt = [
            'no-inline-event-handlers',
            'has-main',
            'no-div-onclick',
            'has-media-queries',
            'multiple-breakpoints',
            'has-mobile-breakpoint',
            'no-fixed-widths',
            'responsive-containers',
            'responsive-typography',
            'has-css-vars',
          ]
          return gameExempt.indexOf(c.id) === -1
        })
        addMsg({ role: 'asst', type: 'checks', checks: stdChecks })

        // AI-powered standard check (Gemini > GPT > Claude)
        var aiStdCheckPromise = retryStep(
          function () {
            return smartRaw(SYS_STD_CHECK_AI, 'CODE:\n' + currentCode.slice(0, 50000), 3000).then(function (raw) {
              try {
                return JSON.parse(raw)
              } catch (e) {
                return []
              }
            })
          },
          1,
          'AIStdCheck'
        ).catch(function () {
          return []
        })

        // Wait for both AI checks to complete
        return Promise.all([aiGameCheckPromise, aiStdCheckPromise]).then(function (aiResults) {
          var aiGameBugs = Array.isArray(aiResults[0]) ? aiResults[0] : []
          var aiStdBugs = Array.isArray(aiResults[1]) ? aiResults[1] : []

          // Merge AI game check results into gameFails
          var aiGameFails = aiGameBugs.map(function (b) {
            return {
              cat: 'AI Game Check',
              id: 'ai-game-' + Math.random().toString(36).slice(2, 8),
              label: b.issue,
              passed: false,
              detail: b.location || '',
            }
          })
          if (aiGameFails.length) {
            addMsg({ role: 'asst', type: 'checks', checks: aiGameFails })
          }

          // Merge AI standard check results into criticalFails
          var aiStdFails = aiStdBugs.map(function (b) {
            return {
              cat: 'AI Standard Check',
              id: 'ai-std-' + Math.random().toString(36).slice(2, 8),
              label: b.issue,
              passed: false,
              detail: b.location || '',
            }
          })
          if (aiStdFails.length) {
            addMsg({ role: 'asst', type: 'checks', checks: aiStdFails })
          }

          var totalGameFails = gameFails.concat(aiGameFails)
          var totalCriticalFails = criticalFails.concat(aiStdFails)

          updatePS(
            pid,
            2,
            totalGameFails.length ? 'warn' : 'done',
            totalGameFails.length
              ? totalGameFails.length + ' game issue' + (totalGameFails.length !== 1 ? 's' : '') + passLabel
              : 'Game checks passed' + passLabel + ' \u2713'
          )
          updatePS(
            pid,
            3,
            totalCriticalFails.length ? 'warn' : 'done',
            totalCriticalFails.length
              ? totalCriticalFails.length + ' standard issue' + (totalCriticalFails.length !== 1 ? 's' : '') + passLabel
              : 'Standard checks passed' + passLabel + ' \u2713'
          )

          // Telemetry: capture combined check results
          telemetry.emit('build.checks', {
            passCount: gameChecks.concat(stdChecks).filter(function (c) {
              return c.passed
            }).length,
            totalCount: gameChecks.length + stdChecks.length + aiGameBugs.length + aiStdBugs.length,
            criticalFails: totalGameFails.length + totalCriticalFails.length,
          })
          telemetry.updateBuildRecord(_buildId, 'checks', gameChecks.concat(stdChecks))

          // Replace gameFails and criticalFails with merged totals for downstream
          gameFails = totalGameFails
          criticalFails = totalCriticalFails

          // Step 4 — Game-Specific Audit (Claude — deep analysis)
          if (passNum === 1) {
            updatePipeStep(pid, 5, TOTAL_STEPS)
            updatePipeProgress(pid, 55)
            updatePipeETA(pid, '~1 min')
          }
          updatePS(pid, 4, 'active', 'Auditing gameplay' + passLabel + '\u2026')
          return retryStep(
            function () {
              return callClaudeRaw(
                SYS_AUDIT_GAME,
                'GAME CONCEPT: ' + prompt + '\n\nGAME CODE:\n' + currentCode.slice(0, 60000),
                4000
              ).then(function (raw) {
                try {
                  return JSON.parse(raw)
                } catch (e) {
                  return []
                }
              })
            },
            2,
            'GameAudit'
          )
            .then(function (bugs) {
              updatePS(
                pid,
                4,
                'done',
                bugs.length
                  ? 'Found ' + bugs.length + ' gameplay issue' + (bugs.length !== 1 ? 's' : '') + passLabel
                  : 'Gameplay is clean' + passLabel + ' \u2713'
              )
              if (bugs.length) addMsg({ role: 'asst', type: 'audit', bugs: bugs, source: 'game-audit' })
              telemetry.emit('build.audit', { bugCount: bugs.length, auditor: 'game-audit' })
              telemetry.updateBuildRecord(_buildId, 'auditBugs', bugs)
              return { gameFails: gameFails, criticalFails: criticalFails, bugs: bugs }
            })
            .catch(function (e) {
              var auditErr = scrubKeys(e.message || String(e))
              updatePS(pid, 4, 'error', 'Game audit failed' + passLabel + ': ' + auditErr)
              return { gameFails: gameFails, criticalFails: criticalFails, bugs: [] }
            })
            .then(function (result) {
              // Merge all issues
              var allIssues = result.gameFails
                .map(function (c) {
                  return {
                    severity: 'medium',
                    issue: '[Game] ' + c.label + (c.detail ? ' \u2014 ' + c.detail : ''),
                    location: c.cat,
                  }
                })
                .concat(
                  result.criticalFails.map(function (c) {
                    return {
                      severity: 'low',
                      issue: '[Standard] ' + c.label + (c.detail ? ' \u2014 ' + c.detail : ''),
                      location: c.cat,
                    }
                  })
                )
                .concat(result.bugs)

              // Step 5 — Fix
              if (passNum === 1) {
                updatePipeStep(pid, 6, TOTAL_STEPS)
                updatePipeProgress(pid, 65)
              }
              if (allIssues.length > 0) {
                updatePS(
                  pid,
                  5,
                  'active',
                  'Fixing ' + allIssues.length + ' issue' + (allIssues.length !== 1 ? 's' : '') + passLabel + '\u2026'
                )
                var issueList = allIssues
                  .map(function (b, i) {
                    return (
                      i +
                      1 +
                      '. [' +
                      (b.severity || 'medium').toUpperCase() +
                      '] ' +
                      (b.issue || '') +
                      ' \u2014 ' +
                      (b.location || '')
                    )
                  })
                  .join('\n')

                var fm =
                  (passNum > 1 ? 'REMAINING ISSUES after pass ' + (passNum - 1) : 'ISSUES TO FIX') +
                  ':\n' +
                  issueList +
                  '\n\nCURRENT CODE:\n' +
                  currentCode +
                  (passNum > 1 ? '\n\nFix these without reintroducing previously resolved issues.' : '')
                repairHistory.push({ role: 'user', content: fm })

                return retryStep(
                  function () {
                    return callClaudeMultiTurn(fixSys, repairHistory)
                  },
                  2,
                  'Fix'
                )
                  .then(function (fixed) {
                    repairHistory.push({ role: 'assistant', content: fixed })
                    currentCode = fixed
                    totalFixed += allIssues.length
                    telemetry.emit('build.fix', { passNum: passNum, issuesFixed: allIssues.length })
                    var _existingPasses = _br.fixPasses || []
                    _existingPasses.push({ pass: passNum, fixed: allIssues.length })
                    telemetry.updateBuildRecord(_buildId, 'fixPasses', _existingPasses)
                    if (passNum < MAX_FIX_PASSES) {
                      updatePS(pid, 5, 'active', 'Re-validating fixes' + passLabel + '\u2026')
                      return runValidationPass()
                    } else {
                      var finalGameChecks = runGameChecks(currentCode)
                      var finalGameFails = finalGameChecks.filter(function (c) {
                        return !c.passed && GAME_ADVISORY_IDS.indexOf(c.id) === -1
                      })
                      if (finalGameFails.length > 0) {
                        updatePS(
                          pid,
                          5,
                          'warn',
                          finalGameFails.length +
                            ' issue' +
                            (finalGameFails.length !== 1 ? 's' : '') +
                            ' remain after ' +
                            MAX_FIX_PASSES +
                            ' passes'
                        )
                      } else {
                        updatePS(
                          pid,
                          5,
                          'done',
                          'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713'
                        )
                      }
                      v2 = currentCode
                      addMsg({
                        role: 'asst',
                        type: 'text',
                        text:
                          'Game validation: ' +
                          totalFixed +
                          ' issue' +
                          (totalFixed !== 1 ? 's' : '') +
                          ' addressed across ' +
                          passNum +
                          ' pass' +
                          (passNum !== 1 ? 'es' : '') +
                          '.' +
                          (finalGameFails.length > 0
                            ? ' ' +
                              finalGameFails.length +
                              ' minor issue' +
                              (finalGameFails.length !== 1 ? 's' : '') +
                              ' may remain.'
                            : ''),
                      })
                    }
                  })
                  .catch(function (e) {
                    v2 = currentCode
                    var errMsg = scrubKeys(e.message || String(e))
                    updatePS(
                      pid,
                      5,
                      'error',
                      'Fix pass failed \u2014 using ' + (passNum > 1 ? 'last good version' : 'original')
                    )
                    addMsg({ role: 'asst', type: 'text', text: 'Fix error: ' + errMsg })
                  })
              } else {
                v2 = currentCode
                if (passNum === 1) {
                  updatePS(pid, 5, 'done', 'No fixes needed \u2713')
                } else {
                  updatePS(
                    pid,
                    5,
                    'done',
                    'All issues resolved after ' + passNum + ' pass' + (passNum !== 1 ? 'es' : '') + ' \u2713'
                  )
                  addMsg({
                    role: 'asst',
                    type: 'text',
                    text:
                      'Game validation: ' +
                      totalFixed +
                      ' issue' +
                      (totalFixed !== 1 ? 's' : '') +
                      ' addressed across ' +
                      passNum +
                      ' pass' +
                      (passNum !== 1 ? 'es' : '') +
                      '. Game is clean \u2713',
                  })
                }
                return Promise.resolve()
              }
            })
        }) // end Promise.all AI checks
      }

      return runValidationPass()
    })
    .then(function () {
      // Spec compliance check (runs when a thought brief is active)
      var activeThought = ST.activeThoughtId
        ? ST.thoughts.find(function (t) {
            return t.id === ST.activeThoughtId
          })
        : null
      if (activeThought && activeThought.brief && v2) {
        var complianceInput =
          'APP SPECIFICATION:\n' +
          specText +
          '\n\nUSER RULES:\n' +
          rulesText +
          '\n\nGENERATED CODE:\n' +
          v2.slice(0, 40000)
        return retryStep(
          function () {
            return callClaudeRaw(SYS_SPEC_COMPLIANCE, complianceInput, 2000)
          },
          1,
          'Compliance'
        )
          .then(function (raw) {
            try {
              var compliance = JSON.parse(raw)
              addMsg({ role: 'asst', type: 'text', html: renderComplianceCard(compliance) })
            } catch (e) {
              /* compliance parse failed — non-critical */
            }
          })
          .catch(function () {
            /* compliance check failed — non-critical, continue */
          })
      }
      return Promise.resolve()
    })
    .then(function () {
      // Step 6 — Push to branch
      checkPipelineCancel()
      updatePipeStep(pid, 7, TOTAL_STEPS)
      updatePipeProgress(pid, 75)
      updatePipeETA(pid, '~30s')
      if (hasGitHub) {
        updatePS(pid, 6, 'active', 'Pushing to ' + branchName + '\u2026')
        var appPath = 'apps/' + appId + '.html'
        return retryStep(
          function () {
            return ghGetFileSha(appPath, branchName).then(function (existingSha) {
              return ghPushFile(
                appPath,
                v2,
                (existingApp ? 'Update' : 'Add') + ' ' + appName + ' [branch]',
                branchName,
                existingSha
              )
            })
          },
          3,
          'Push'
        )
          .then(function () {
            updatePS(pid, 6, 'done', 'Pushed to branch \u2713')
            _persistProgress(6)
          })
          .catch(function (e) {
            updatePS(pid, 6, 'error', e.message)
            throw new Error('Branch push failed: ' + e.message)
          })
      } else {
        updatePS(pid, 6, 'skip', 'Local-only')
        return Promise.resolve()
      }
    })
    .then(function () {
      // Step 7 — Preview
      updatePipeStep(pid, 8, TOTAL_STEPS)
      updatePipeProgress(pid, 85)
      updatePS(pid, 7, 'done', 'Preview ready')
      setPreview(appId, v2)
      addMsg({
        role: 'asst',
        type: 'preview-card',
        code: v2,
        appName: appName,
        branch: branchName || 'local',
        appId: appId,
        pid: pid,
      })

      // Step 8 — Final Validation (approval gate)
      updatePipeStep(pid, 9, TOTAL_STEPS)
      updatePipeProgress(pid, 90)
      updatePipeETA(pid, 'Awaiting approval')
      stopPipeTimer(pid)
      updatePS(pid, 8, 'wait', 'Waiting for your approval\u2026')
      addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
      notifyUser('Game Ready for Review', appName + ' is waiting for your approval.')
      _approvalStartTs = Date.now()

      return waitForApproval(pid)
    })
    .then(function () {
      updatePS(pid, 8, 'done', 'Approved \u2713')
      startPipeTimer(pid)
      updatePipeStep(pid, 10, TOTAL_STEPS)
      updatePipeProgress(pid, 92)
      updatePipeETA(pid, 'Finishing up\u2026')
      var _approvalMs = _approvalStartTs ? Date.now() - _approvalStartTs : null
      telemetry.emit('user.approval', { approved: true, timeMs: _approvalMs })
      telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'approved')
      telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalMs)

      // Step 9 — Merge to main
      var mergeStatusId = 'merge-' + Date.now()
      if (hasGitHub) {
        updatePS(pid, 9, 'active', 'Merging to main\u2026')
        addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })
        return retryStep(
          function () {
            return ghMergeBranch(branchName, appName)
          },
          3,
          'Merge'
        )
          .then(function () {
            return ghPushManifest('main').catch(function () {})
          })
          .then(function () {
            ghDeleteBranch(branchName)
            var liveUrl = ghPageUrl(appId)
            updatePS(pid, 9, 'done', 'Merged & deploying \u2713')
            var mc = $(mergeStatusId)
            if (mc) {
              var card = mc.querySelector('.merge-card')
              if (card)
                card.innerHTML =
                  '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><a class="merge-url" href="' +
                  liveUrl +
                  '" target="_blank">' +
                  liveUrl +
                  '</a><span class="merge-meta">GitHub Pages deploys in ~60s</span></div>'
            }
            saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, true)
            clearPreview(appId)
            toast('\uD83C\uDFAE ' + appName + ' is deploying!', 3500)
            return 'github'
          })
          .catch(function (e) {
            var safeE = scrubKeys(e.message || String(e))
            updatePS(pid, 9, 'error', safeE)
            clearPreview(appId)
            saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
            addMsg({
              role: 'asst',
              type: 'text',
              html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. Game saved locally.',
            })
            return 'local'
          })
      } else {
        updatePS(pid, 9, 'done', 'Saved locally \u2713')
        saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
        clearPreview(appId)
        toast('\u2705 ' + appName + ' saved!', 2800)
        return 'local'
      }
    })
    .then(function (mode) {
      ST.activeAppId = appId
      finishPipeHeader(pid)
      notifyUser('Game Complete', appName + (mode === 'github' ? ' is live on GitHub Pages!' : ' has been saved.'))
      $('ihint').textContent = '\uD83C\uDFAE Describe changes for your game'
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      // Show cost analysis card
      var costData = calculateBuildCost()
      if (costData.breakdown.length > 0) {
        addMsg({ role: 'asst', type: 'cost', cost: costData })
        for (var ci = 0; ci < ST.apps.length; ci++) {
          if (ST.apps[ci].id === appId) {
            if (!ST.apps[ci].costs) ST.apps[ci].costs = []
            ST.apps[ci].costs.push({
              rawCost: costData.rawCost,
              userPrice: costData.userPrice,
              markup: costData.markup,
              totalInput: costData.totalInput,
              totalOutput: costData.totalOutput,
              ts: costData.ts,
            })
            if (ST.apps[ci].costs.length > 50) ST.apps[ci].costs = ST.apps[ci].costs.slice(-50)
            break
          }
        }
      }
      var g = grad(appCi)
      addMsg({
        role: 'asst',
        type: 'text',
        html:
          '<strong>' +
          esc(appName) +
          '</strong> ' +
          (mode === 'github' ? 'is live on GitHub Pages' : 'has been saved') +
          ' \uD83C\uDFAE<br><br>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">' +
          '<button onclick="B.openApp(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:' +
          g +
          ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83C\uDFAE Open in Studio</button>' +
          '<button onclick="B.openProjectSheet(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>' +
          '</div>',
      })
      telemetry.completeBuildRecord(_buildId, {
        finalCodeSize: v2 ? v2.length : 0,
        costData: costData.breakdown.length
          ? {
              rawCost: costData.rawCost,
              userPrice: costData.userPrice,
              totalInput: costData.totalInput,
              totalOutput: costData.totalOutput,
            }
          : null,
        approved: true,
      })
      return showFeedbackCard(appId, appName, prompt)
    })
    .catch(function (err) {
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
        telemetry.emit('user.approval', {
          approved: false,
          timeMs: _approvalStartTs ? Date.now() - _approvalStartTs : null,
        })
        telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'rejected')
        telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalStartTs ? Date.now() - _approvalStartTs : null)
        updatePS(pid, 8, 'error', 'Changes requested')
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
      telemetry.emit('build.error', { message: safeMsg })
      telemetry.completeBuildRecord(_buildId, { cancelled: true })
      addMsg({ role: 'asst', type: 'text', text: 'Game build error: ' + safeMsg })
      toast('Build failed', 3000)
      if (v2 || v1) {
        saveAppLocally(appId, appName, appIcon, appCi, v2 || v1, prompt, existingApp, false)
        ST.activeAppId = appId
        $('bs-proj-btn').style.display = 'flex'
        renderGrid()
      }
    })
    .finally(function () {
      stopPipeTimer(pid)
      telemetry.endBuild(_buildId)
      saveChatSession(appId, prompt)
      persist()
      clearBuildSession()
      clearPipelineSteps()
      ST._building = false
      var sb = $('send-btn')
      if (sb) sb.disabled = false
      guards.cleanup()
    })
}

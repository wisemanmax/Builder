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
  verifyFeatureChecklist,
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
  SYS_BUILD,
  SYS_UPDATE,
  SYS_FIX,
  SYS_ENHANCE,
  SYS_BACKEND,
  SYS_PLAN,
  SYS_SPEC_COMPLIANCE,
  callClaude,
  callClaudeMultiTurn,
  callClaudeRaw,
  callClaudeWithThinkingStream,
  callGPT,
  callGPTReview,
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
  getPipelineSteps,
  clearPipelineSteps,
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
  openProjectSheet,
  injectProfileContext,
  telemetry,
} from './pipeline-shared.js'

export function runPipeline(prompt, existingApp, customName, images) {
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel')
    if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid })
  }, 0)

  var guards = setupPipelineGuards(pid)

  var appName = existingApp ? existingApp.name : (customName && customName.trim()) || autoName(prompt)
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? 'builder/app-' + appId + '-' + Date.now().toString(36) : ''

  var v1, v2, specText, rulesText, fixSys, thinkingText, _streamPreview
  var _buildId = telemetry.startBuild(appId, 'builder1')
  var _br = telemetry.createBuildRecord(appId, 'builder1', prompt, {
    isUpdate: !!existingApp,
    thoughtId: ST.activeThoughtId || null,
    templateId: ST._pendingTemplate ? 'template' : null,
    hasImages: !!(images && images.length),
  })
  var _approvalStartTs = 0

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
      pipelineMode: 'builder1',
      branchName: branchName,
      lastStep: lastStep,
      steps: getPipelineSteps(),
      ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: !!(v2 || v1),
    })
  }

  // Step 0 — Branch
  var p = Promise.resolve()
  if (hasGitHub) {
    updatePS(pid, 0, 'active', 'Creating feature branch\u2026')
    p = retryStep(
      function () {
        return ghCreateBranch(branchName)
      },
      3,
      'Branch'
    )
      .then(function () {
        updatePS(pid, 0, 'done', branchName)
        _persistProgress(0)
      })
      .catch(function (e) {
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
    if (images && images.length)
      planMsg +=
        '\n\n[' +
        images.length +
        ' reference image' +
        (images.length > 1 ? 's' : '') +
        ' attached — use them to understand the desired design/layout]'
    return retryStep(
      function () {
        return callClaudeRaw(SYS_PLAN, planMsg, 2000, images)
      },
      2,
      'Plan'
    )
      .then(function (raw) {
        planJSON = raw
        telemetry.emit('build.plan', { planLength: raw.length })
        telemetry.updateBuildRecord(_buildId, 'plan', raw)
        updatePS(pid, 1, 'done', 'Architecture planned \u2713')
        _persistProgress(1)
        addMsg({ role: 'asst', type: 'text', text: 'Architecture plan ready.' })
      })
      .catch(function (e) {
        updatePS(pid, 1, 'warn', 'Planning skipped: ' + scrubKeys(e.message || String(e)))
      })
  })
    .then(function () {
      // Step 2 — Build
      checkPipelineCancel()
      updatePS(pid, 2, 'active', 'Claude is writing your app\u2026')
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
        var effectiveSys = buildEffectiveSys(existingApp ? SYS_UPDATE : SYS_BUILD, thoughtCtx)

        if (planJSON) {
          userMsg += '\n\nARCHITECTURE PLAN:\n' + planJSON
        }
        if (images && images.length) {
          userMsg +=
            '\n\n[' +
            images.length +
            ' reference image' +
            (images.length > 1 ? 's' : '') +
            ' attached — study them carefully and replicate the design, layout, colors, and style as closely as possible]'
        }
        var charCount = 0
        thinkingText = ''
        // Set up streaming live preview
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
              updatePS(pid, 2, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars')
              if (_streamPreview) _streamPreview.pushChunk(text)
            } else if (type === 'thinking') {
              thinkingText += text
            }
          },
          images
        )
      }) // end tplPromise.then
    })
    .then(function (code) {
      v1 = code
      if (_streamPreview) {
        _streamPreview.finalize(v1)
        _streamPreview.destroy()
      }
      updatePS(pid, 2, 'done', 'Build complete \u2713')
      _persistProgress(2)
      // Save app locally early so code survives a crash
      saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
      telemetry.emit('build.code', { charCount: v1.length, hasThinking: !!thinkingText })
      telemetry.updateBuildRecord(_buildId, 'thinking', thinkingText || '')
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
        var criticalFails = checks.filter(function (c) {
          return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
        })
        if (passNum === 1) {
          telemetry.emit('build.checks', { passCount: checks.filter(function (c) { return c.passed }).length, totalCount: checks.length, criticalFails: criticalFails.length })
          telemetry.updateBuildRecord(_buildId, 'checks', checks)
        }
        addMsg({ role: 'asst', type: 'checks', checks: checks })
        updatePS(
          pid,
          3,
          criticalFails.length ? 'warn' : 'done',
          criticalFails.length
            ? criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found' + passLabel
            : 'All checks passed' + passLabel + ' \u2713'
        )

        var auditPromise
        if (canAudit) {
          updatePS(pid, 4, 'active', 'GPT-4o reviewing' + passLabel + '\u2026')
          auditPromise = callGPT(currentCode)
            .then(function (bugs) {
              updatePS(
                pid,
                4,
                'done',
                bugs.length
                  ? 'Found ' + bugs.length + ' issue' + (bugs.length !== 1 ? 's' : '') + passLabel
                  : 'Code is clean' + passLabel + ' \u2713'
              )
              addMsg({ role: 'asst', type: 'audit', bugs: bugs })
              if (passNum === 1) {
                telemetry.emit('build.audit', { bugCount: bugs.length, auditor: 'gpt' })
                telemetry.updateBuildRecord(_buildId, 'auditBugs', bugs)
              }
              return { criticalFails: criticalFails, bugs: bugs }
            })
            .catch(function (e) {
              var auditErr = scrubKeys(e.message || String(e))
              updatePS(pid, 4, 'error', 'Audit failed' + passLabel + ': ' + auditErr)
              return { criticalFails: criticalFails, bugs: [] }
            })
        } else {
          if (passNum === 1) updatePS(pid, 4, 'skip', ST.gptKey ? 'Audit disabled' : 'No OpenAI key \u2014 skipped')
          auditPromise = Promise.resolve({ criticalFails: criticalFails, bugs: [] })
        }

        return auditPromise.then(function (result) {
          var allIssues = result.criticalFails
            .map(function (c) {
              return { severity: 'medium', issue: c.label + (c.detail ? ' \u2014 ' + c.detail : ''), location: c.cat }
            })
            .concat(result.bugs)

          if (allIssues.length > 0) {
            // Interactive checkpoint after first audit — let user decide
            var checkpointPromise = Promise.resolve('fix')
            if (passNum === 1 && allIssues.length > 0) {
              var issueTexts = allIssues.map(function (b) {
                return '[' + (b.severity || 'medium').toUpperCase() + '] ' + (b.issue || '')
              })
              addMsg({ role: 'asst', type: 'checkpoint', pid: pid, issueCount: allIssues.length, issues: issueTexts })
              notifyUser('Checkpoint', allIssues.length + ' issues found — fix, skip, or stop?')
              checkpointPromise = waitForCheckpoint(pid)
            }
            return checkpointPromise.then(function (decision) {
            telemetry.emit('user.checkpoint', { decision: decision, issueCount: allIssues.length })
            telemetry.updateBuildRecord(_buildId, 'checkpointDecision', decision)
            if (decision === 'stop') {
              throw new Error('PIPELINE_CANCELLED')
            }
            if (decision === 'skip') {
              v2 = currentCode
              updatePS(pid, 5, 'done', 'Skipped fixes \u2014 using current version')
              return Promise.resolve()
            }
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

            // Always include full code so the model has complete context (like a chat conversation)
            var fm =
              (passNum > 1 ? 'REMAINING ISSUES after pass ' + (passNum - 1) : 'ISSUES TO FIX') +
              ':\n' + issueList +
              '\n\nCURRENT CODE:\n' + currentCode +
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
                var _existingPasses = (_br && _br.fixPasses) || []
                _existingPasses.push({ passNum: passNum, issuesBefore: allIssues.length })
                telemetry.updateBuildRecord(_buildId, 'fixPasses', _existingPasses)
                if (passNum < MAX_FIX_PASSES) {
                  updatePS(pid, 5, 'active', 'Re-validating fixes' + passLabel + '\u2026')
                  return runValidationPass()
                } else {
                  var finalChecks = runLocalChecks(currentCode)
                  var finalFails = finalChecks.filter(function (c) {
                    return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
                  })
                  if (finalFails.length > 0) {
                    updatePS(
                      pid,
                      5,
                      'warn',
                      finalFails.length +
                        ' issue' +
                        (finalFails.length !== 1 ? 's' : '') +
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
                      'Validation summary: ' +
                      totalFixed +
                      ' issue' +
                      (totalFixed !== 1 ? 's' : '') +
                      ' addressed across ' +
                      passNum +
                      ' pass' +
                      (passNum !== 1 ? 'es' : '') +
                      '.' +
                      (finalFails.length > 0
                        ? ' ' +
                          finalFails.length +
                          ' minor issue' +
                          (finalFails.length !== 1 ? 's' : '') +
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
            }) // end checkpointPromise.then
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
                  'Validation summary: ' +
                  totalFixed +
                  ' issue' +
                  (totalFixed !== 1 ? 's' : '') +
                  ' addressed across ' +
                  passNum +
                  ' pass' +
                  (passNum !== 1 ? 'es' : '') +
                  '. Code is clean \u2713',
              })
            }
            return Promise.resolve()
          }
        })
      }

      return runValidationPass()
    })
    .then(function () {
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
      return retryStep(
        function () {
          return callGPTReview(v2)
        },
        2,
        'EnhReview'
      )
        .then(function (review) {
          telemetry.emit('build.enhance', { enhancementCount: review.enhancements.length, bugCount: review.bugs.length })
          telemetry.updateBuildRecord(_buildId, 'enhancementReview', { enhancements: review.enhancements, bugs: review.bugs })
          var totalSuggestions = review.enhancements.length + review.bugs.length
          updatePS(
            pid,
            6,
            'done',
            totalSuggestions
              ? review.enhancements.length +
                  ' enhancement' +
                  (review.enhancements.length !== 1 ? 's' : '') +
                  ', ' +
                  review.bugs.length +
                  ' bug' +
                  (review.bugs.length !== 1 ? 's' : '')
              : 'Code looks great ✓'
          )
          if (review.enhancements.length) {
            addMsg({
              role: 'asst',
              type: 'text',
              text:
                'Enhancement suggestions: ' +
                review.enhancements
                  .map(function (e, i) {
                    return i + 1 + '. [' + e.priority.toUpperCase() + '] ' + e.suggestion
                  })
                  .join('; '),
            })
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
          enhanceMsg += review.enhancements
            .map(function (e, i) {
              return (
                i +
                1 +
                '. [' +
                (e.priority || 'medium').toUpperCase() +
                '] ' +
                (e.suggestion || '') +
                ' — ' +
                (e.location || '') +
                (e.reason ? ' (Reason: ' + e.reason + ')' : '')
              )
            })
            .join('\n')
          if (review.bugs.length) {
            enhanceMsg += '\n\nBUGS TO FIX:\n'
            enhanceMsg += review.bugs
              .map(function (b, i) {
                return (
                  i +
                  1 +
                  '. [' +
                  (b.severity || 'medium').toUpperCase() +
                  '] ' +
                  (b.issue || '') +
                  ' — ' +
                  (b.location || '')
                )
              })
              .join('\n')
          }
          enhanceMsg += '\n\nORIGINAL CODE:\n' + v2

          return retryStep(
            function () {
              return callClaude(withContext(SYS_ENHANCE), enhanceMsg)
            },
            2,
            'Enhance'
          ).then(function (enhanced) {
            v2 = enhanced
            updatePS(pid, 7, 'done', 'Enhancements applied ✓')

            // Step 8 — GPT-4o Final Review (bug gate)
            updatePS(pid, 8, 'active', 'GPT-4o final bug review…')
            var MAX_REVIEW_PASSES = 2
            var reviewPass = 0

            function runFinalReview() {
              reviewPass++
              return retryStep(
                function () {
                  return callGPT(v2)
                },
                2,
                'FinalReview'
              ).then(function (bugs) {
                var criticalBugs = bugs.filter(function (b) {
                  return b.severity === 'high' || b.severity === 'medium'
                })
                if (criticalBugs.length === 0) {
                  updatePS(
                    pid,
                    8,
                    'done',
                    (reviewPass > 1 ? 'Clean after ' + reviewPass + ' passes' : 'Code is clean') + ' ✓'
                  )
                  if (bugs.length > 0) {
                    addMsg({
                      role: 'asst',
                      type: 'text',
                      text:
                        'Final review: ' +
                        bugs.length +
                        ' low-severity note' +
                        (bugs.length !== 1 ? 's' : '') +
                        ' (acceptable).',
                    })
                  }
                  return Promise.resolve()
                }

                addMsg({ role: 'asst', type: 'audit', bugs: criticalBugs })

                if (reviewPass < MAX_REVIEW_PASSES) {
                  updatePS(
                    pid,
                    8,
                    'active',
                    'Sending ' +
                      criticalBugs.length +
                      ' issue' +
                      (criticalBugs.length !== 1 ? 's' : '') +
                      ' back to Claude (pass ' +
                      reviewPass +
                      ')…'
                  )
                  var fixMsg =
                    'ISSUES TO FIX:\n' +
                    criticalBugs
                      .map(function (b, i) {
                        return (
                          i +
                          1 +
                          '. [' +
                          (b.severity || 'medium').toUpperCase() +
                          '] ' +
                          (b.issue || '') +
                          ' — ' +
                          (b.location || '')
                        )
                      })
                      .join('\n') +
                    '\n\nORIGINAL CODE:\n' +
                    v2
                  return retryStep(
                    function () {
                      return callClaude(fixSys, fixMsg)
                    },
                    2,
                    'ReviewFix'
                  ).then(function (fixed) {
                    v2 = fixed
                    return runFinalReview()
                  })
                } else {
                  updatePS(
                    pid,
                    8,
                    'wait',
                    criticalBugs.length +
                      ' issue' +
                      (criticalBugs.length !== 1 ? 's' : '') +
                      ' remain after ' +
                      reviewPass +
                      ' passes'
                  )
                  addMsg({ role: 'asst', type: 'retry-prompt', pid: pid, bugCount: criticalBugs.length })
                  notifyUser('Action Required', criticalBugs.length + ' issues found — retry or proceed?')
                  return waitForRetryDecision(pid).then(function (doRetry) {
                    if (doRetry) {
                      updatePS(pid, 8, 'active', 'Claude is fixing remaining issues…')
                      var retryFixMsg =
                        'ISSUES TO FIX:\n' +
                        criticalBugs
                          .map(function (b, i) {
                            return (
                              i +
                              1 +
                              '. [' +
                              (b.severity || 'medium').toUpperCase() +
                              '] ' +
                              (b.issue || '') +
                              ' — ' +
                              (b.location || '')
                            )
                          })
                          .join('\n') +
                        '\n\nORIGINAL CODE:\n' +
                        v2
                      return retryStep(
                        function () {
                          return callClaude(fixSys, retryFixMsg)
                        },
                        2,
                        'RetryFix'
                      ).then(function (fixed) {
                        v2 = fixed
                        reviewPass = 0
                        return runFinalReview()
                      })
                    } else {
                      updatePS(
                        pid,
                        8,
                        'warn',
                        criticalBugs.length + ' issue' + (criticalBugs.length !== 1 ? 's' : '') + ' remain — proceeding'
                      )
                      addMsg({ role: 'asst', type: 'text', text: 'Proceeding with best version.' })
                      return Promise.resolve()
                    }
                  })
                }
              })
            }

            return runFinalReview()
          })
        })
        .catch(function (e) {
          var safeErr = scrubKeys(e.message || String(e))
          updatePS(pid, 6, 'warn', 'Enhancement review skipped: ' + safeErr)
          updatePS(pid, 7, 'skip', 'Skipped — review unavailable')
          updatePS(pid, 8, 'skip', 'Skipped — review unavailable')
          addMsg({ role: 'asst', type: 'text', text: 'Enhancement review skipped — continuing with current build.' })
          return Promise.resolve()
        })
    })
    .then(function () {
      // Spec compliance check (runs when a thought brief is active)
      var activeThought = ST.activeThoughtId
        ? ST.thoughts.find(function (t) {
            return t.id === ST.activeThoughtId
          })
        : null
      if (activeThought && activeThought.brief && v2) {
        var featureChecklist = activeThought.featureChecklist || []
        var complianceInput =
          'APP SPECIFICATION:\n' +
          specText +
          '\n\nUSER RULES:\n' +
          rulesText
        if (featureChecklist.length) {
          complianceInput += '\n\nFEATURE CHECKLIST (verify each):\n' +
            featureChecklist.map(function (f, i) {
              return (i + 1) + '. ' + (f.required ? '[REQUIRED] ' : '[OPTIONAL] ') + f.text
            }).join('\n')
        }
        complianceInput += '\n\nGENERATED CODE:\n' + v2.slice(0, 40000)
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
              var verifiedChecklist = verifyFeatureChecklist(featureChecklist, compliance)
              addMsg({ role: 'asst', type: 'text', html: renderComplianceCard(compliance, verifiedChecklist) })

              // Auto-fix if required features are missing and score is below threshold
              var missingRequired = verifiedChecklist.filter(function (f) { return f.required && !f.verified })
              if (missingRequired.length > 0 && compliance.score < 70) {
                addMsg({
                  role: 'asst',
                  type: 'text',
                  text: 'Auto-fixing ' + missingRequired.length + ' missing required feature' + (missingRequired.length !== 1 ? 's' : '') + '\u2026',
                })
                var fixMsg = 'MISSING REQUIRED FEATURES — add these to the app:\n' +
                  missingRequired.map(function (f, i) { return (i + 1) + '. ' + f.text }).join('\n')
                if (compliance.missing && compliance.missing.length) {
                  fixMsg += '\n\nADDITIONAL MISSING REQUIREMENTS:\n' +
                    compliance.missing.map(function (m, i) { return (i + 1) + '. ' + m }).join('\n')
                }
                fixMsg += '\n\nCURRENT CODE:\n' + v2
                return retryStep(
                  function () {
                    return callClaude(withContext(SYS_FIX.replace('{INTENT}', prompt)), fixMsg)
                  },
                  2,
                  'ComplianceFix'
                ).then(function (fixed) {
                  v2 = fixed
                  addMsg({ role: 'asst', type: 'text', text: 'Compliance fix applied \u2014 ' + missingRequired.length + ' feature' + (missingRequired.length !== 1 ? 's' : '') + ' added.' })
                })
              } else if (compliance.score < 50) {
                addMsg({
                  role: 'asst',
                  type: 'text',
                  text: 'Low spec compliance (' + compliance.score + '/100). The built app may not match your ideation brief.',
                })
              }
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
      // Step 9 — Backend
      checkPipelineCancel()
      if (ST.backendEnabled && ST.sbUrl) {
        updatePS(pid, 9, 'active', 'Generating Supabase backend\u2026')
        return callClaudeRaw(SYS_BACKEND, 'App code:\n\n' + v2.slice(0, 60000), 4000)
          .then(function (raw) {
            var backend = JSON.parse(raw)
            var tables = backend.tables || []
            var allSql = tables
              .map(function (t) {
                return t.sql || ''
              })
              .concat(backend.rls || [])
              .filter(Boolean)
              .join('\n\n')
            updatePS(pid, 9, 'done', tables.length + ' table' + (tables.length !== 1 ? 's' : '') + ' designed \u2713')
            addMsg({ role: 'asst', type: 'schema', sql: allSql, tables: tables })
            if (
              backend.injectedHTML &&
              backend.injectedHTML.indexOf('<!DOCTYPE') >= 0 &&
              backend.injectedHTML.length > 500
            ) {
              v2 = autoInjectSupabase(backend.injectedHTML)
            }
          })
          .catch(function (e) {
            updatePS(pid, 9, 'warn', 'Backend gen skipped: ' + scrubKeys(e.message || String(e)))
          })
      } else {
        updatePS(pid, 9, 'skip', 'Backend off')
        return Promise.resolve()
      }
    })
    .then(function () {
      // Step 10 — Push to branch
      checkPipelineCancel()
      if (hasGitHub) {
        updatePS(pid, 10, 'active', 'Pushing to ' + branchName + '\u2026')
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
            updatePS(pid, 10, 'done', 'Pushed to branch \u2713')
            _persistProgress(10)
          })
          .catch(function (e) {
            updatePS(pid, 10, 'error', e.message)
            throw new Error('Branch push failed: ' + e.message)
          })
      } else {
        updatePS(pid, 10, 'skip', 'Local-only')
        return Promise.resolve()
      }
    })
    .then(function () {
      // Step 11 — Preview
      updatePS(pid, 11, 'done', 'Preview ready')
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

      // Step 12 — Approval gate
      updatePS(pid, 12, 'wait', 'Waiting for your approval\u2026')
      addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
      notifyUser('Build Ready for Review', appName + ' is waiting for your approval.')
      _approvalStartTs = Date.now()

      return waitForApproval(pid)
    })
    .then(function () {
      updatePS(pid, 12, 'done', 'Approved \u2713')
      var _approvalMs = _approvalStartTs ? Date.now() - _approvalStartTs : null
      telemetry.emit('user.approval', { approved: true, timeMs: _approvalMs })
      telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'approved')
      telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalMs)

      // Step 13 — Merge
      var mergeStatusId = 'merge-' + Date.now()
      if (hasGitHub) {
        updatePS(pid, 13, 'active', 'Merging to main\u2026')
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
            updatePS(pid, 13, 'done', 'Merged & deploying \u2713')
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
            toast('\uD83D\uDE80 ' + appName + ' is deploying!', 3500)
            return 'github'
          })
          .catch(function (e) {
            var safeE = scrubKeys(e.message || String(e))
            updatePS(pid, 13, 'error', safeE)
            clearPreview(appId)
            saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
            addMsg({
              role: 'asst',
              type: 'text',
              html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. App saved locally.',
            })
            return 'local'
          })
      } else {
        updatePS(pid, 13, 'done', 'Saved locally \u2713')
        saveAppLocally(appId, appName, appIcon, appCi, v2, prompt, existingApp, false)
        clearPreview(appId)
        toast('\u2705 ' + appName + ' saved!', 2800)
        return 'local'
      }
    })
    .then(function (mode) {
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
          ' \uD83C\uDF89<br><br>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">' +
          '<button onclick="B.openApp(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:' +
          g +
          ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open in Studio</button>' +
          '<button onclick="B.openProjectSheet(\'' +
          appId +
          '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>' +
          '</div>',
      })
      // Complete build record with outcomes
      telemetry.completeBuildRecord(_buildId, {
        finalCodeSize: v2 ? v2.length : 0,
        costData: costData.breakdown.length ? { rawCost: costData.rawCost, userPrice: costData.userPrice, totalInput: costData.totalInput, totalOutput: costData.totalOutput } : null,
        approved: true,
      })
      // Show feedback card if a profile is active
      return showFeedbackCard(appId, appName, prompt).then(function () {
        // Show thought feedback if this build used a thought (only once per thought)
        if (ST.activeThoughtId) return showThoughtFeedback(ST.activeThoughtId)
      })
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
        telemetry.emit('user.approval', { approved: false, timeMs: _approvalStartTs ? Date.now() - _approvalStartTs : null })
        telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'rejected')
        telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalStartTs ? Date.now() - _approvalStartTs : null)
        updatePS(pid, 12, 'error', 'Changes requested')
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
      addMsg({ role: 'asst', type: 'text', text: 'Pipeline error: ' + safeMsg + '. Please try again.' })
      notifyUser('Build Failed', safeMsg)
      toast('Error: ' + safeMsg, 5000)
    })
    .finally(function () {
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

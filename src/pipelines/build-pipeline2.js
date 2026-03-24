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
  SYS_PLAN,
  SYS_SPEC_COMPLIANCE,
  callClaudeMultiTurn,
  callClaudeRaw,
  callClaudeWithThinkingStream,
  callClaudeAudit,
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
  setPreview,
  clearPreview,
  waitForApproval,
  waitForRetryDecision,
  createStreamingPreview,
  autoInjectSupabase,
  showFeedbackCard,
  showThoughtFeedback,
  renderGrid,
  openProjectSheet,
  injectProfileContext,
  telemetry,
  shouldSkipStep,
  buildResumeContext,
} from './pipeline-shared.js'

/**
 * Builder2 — Claude-only pipeline (9 steps)
 * 0: Plan  1: Build  2: Checks  3: Claude Audit  4: Fix
 * 5: Push  6: Preview  7: Approval  8: Merge
 */
export function runPipeline2(prompt, existingApp, resumeSession, images) {
  var customName = typeof resumeSession === 'string' ? resumeSession : null
  if (resumeSession && typeof resumeSession === 'string') resumeSession = null
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  registerPipeType(pid, 'builder2')
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel')
    if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid, pipelineType: 'builder2' })
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

  var v1, v2, specText, rulesText, fixSys, thinkingText, _streamPreview
  var _buildId = telemetry.startBuild(appId, 'builder2')
  var _br = telemetry.createBuildRecord(appId, 'builder2', prompt, {
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
      pipelineMode: 'builder2',
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
  if (hasGitHub) {
    if (_isResuming && branchName) {
      updatePS(pid, 0, 'done', branchName + ' (reused)')
    } else {
      p = retryStep(
        function () {
          return ghCreateBranch(branchName)
        },
        3,
        'Branch'
      ).catch(function (e) {
        console.warn('[Pipeline2] Branch creation failed, continuing local-only:', e.message)
        hasGitHub = false
        branchName = ''
      })
    }
  }

  var planJSON = ''

  p.then(function () {
    // Step 0 — Plan
    checkPipelineCancel()
    updatePS(pid, 0, 'active', 'Claude is planning the architecture\u2026')
    var planMsg = 'App description: ' + prompt
    if (images && images.length)
      planMsg +=
        '\n\n[' +
        images.length +
        ' reference image' +
        (images.length > 1 ? 's' : '') +
        ' attached \u2014 use them to understand the desired design/layout]'
    if (_resumeCtx) planMsg += '\n\n' + _resumeCtx
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
        updatePS(pid, 0, 'done', 'Architecture planned \u2713')
        _persistProgress(0)
        addMsg({ role: 'asst', type: 'text', text: 'Architecture plan ready.' })
      })
      .catch(function (e) {
        updatePS(pid, 0, 'warn', 'Planning skipped: ' + scrubKeys(e.message || String(e)))
      })
  })
    .then(function () {
      // Step 1 — Build
      checkPipelineCancel()
      updatePS(pid, 1, 'active', 'Claude is writing your app\u2026')
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
            ' attached \u2014 study them carefully and replicate the design, layout, colors, and style as closely as possible]'
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
              updatePS(pid, 1, 'active', 'Building\u2026 ' + Math.round(charCount / 1000) + 'k chars')
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
      updatePS(pid, 1, 'done', 'Build complete \u2713')
      _persistProgress(1)
      // Save app locally early so code survives a crash
      saveAppLocally(appId, appName, appIcon, appCi, v1, prompt, existingApp, false)
      telemetry.emit('build.code', { charCount: v1.length, hasThinking: !!thinkingText })
      telemetry.updateBuildRecord(_buildId, 'thinking', thinkingText || '')
      if (thinkingText.trim()) {
        addMsg({ role: 'asst', type: 'thinking', text: thinkingText.trim() })
      }

      var currentCode = v1
      var passNum = 0
      var totalFixed = 0
      var repairHistory = []
      fixSys = withContext(SYS_FIX.replace('{INTENT}', prompt))

      function runValidationPass() {
        passNum++
        var passLabel = passNum > 1 ? ' (pass ' + passNum + '/' + MAX_FIX_PASSES + ')' : ''

        // Step 2 — Automated Checks
        updatePS(pid, 2, 'active', 'Running checks' + passLabel + '\u2026')
        var checks = runLocalChecks(currentCode)
        var criticalFails = checks.filter(function (c) {
          return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
        })
        if (passNum === 1) {
          telemetry.emit('build.checks', {
            passCount: checks.filter(function (c) {
              return c.passed
            }).length,
            totalCount: checks.length,
            criticalFails: criticalFails.length,
          })
          telemetry.updateBuildRecord(_buildId, 'checks', checks)
        }
        addMsg({ role: 'asst', type: 'checks', checks: checks })
        updatePS(
          pid,
          2,
          criticalFails.length ? 'warn' : 'done',
          criticalFails.length
            ? criticalFails.length + ' issue' + (criticalFails.length !== 1 ? 's' : '') + ' found' + passLabel
            : 'All checks passed' + passLabel + ' \u2713'
        )

        // Step 3 — Claude Audit
        updatePS(pid, 3, 'active', 'Claude auditing code' + passLabel + '\u2026')
        return retryStep(
          function () {
            return callClaudeAudit(currentCode)
          },
          2,
          'ClaudeAudit'
        )
          .then(function (bugs) {
            updatePS(
              pid,
              3,
              'done',
              bugs.length
                ? 'Found ' + bugs.length + ' issue' + (bugs.length !== 1 ? 's' : '') + passLabel
                : 'Code is clean' + passLabel + ' \u2713'
            )
            if (bugs.length) addMsg({ role: 'asst', type: 'audit', bugs: bugs, source: 'claude' })
            if (passNum === 1) {
              telemetry.emit('build.audit', { bugCount: bugs.length, auditor: 'claude' })
              telemetry.updateBuildRecord(_buildId, 'auditBugs', bugs)
            }
            return { criticalFails: criticalFails, bugs: bugs }
          })
          .catch(function (e) {
            var auditErr = scrubKeys(e.message || String(e))
            updatePS(pid, 3, 'error', 'Audit failed' + passLabel + ': ' + auditErr)
            return { criticalFails: criticalFails, bugs: [] }
          })
          .then(function (result) {
            var allIssues = result.criticalFails
              .map(function (c) {
                return { severity: 'medium', issue: c.label + (c.detail ? ' \u2014 ' + c.detail : ''), location: c.cat }
              })
              .concat(result.bugs)

            // Step 4 — Claude Fix
            if (allIssues.length > 0) {
              updatePS(
                pid,
                4,
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

              // Always include full code so the model has complete context
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
                  var _ep = (_br && _br.fixPasses) || []
                  _ep.push({ passNum: passNum, issuesBefore: allIssues.length })
                  telemetry.updateBuildRecord(_buildId, 'fixPasses', _ep)
                  if (passNum < MAX_FIX_PASSES) {
                    updatePS(pid, 4, 'active', 'Re-validating fixes' + passLabel + '\u2026')
                    return runValidationPass()
                  } else {
                    var finalChecks = runLocalChecks(currentCode)
                    var finalFails = finalChecks.filter(function (c) {
                      return !c.passed && ADVISORY_CHECK_IDS.indexOf(c.id) === -1
                    })
                    if (finalFails.length > 0) {
                      updatePS(
                        pid,
                        4,
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
                        4,
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
                    4,
                    'error',
                    'Fix pass failed \u2014 using ' + (passNum > 1 ? 'last good version' : 'original')
                  )
                  addMsg({ role: 'asst', type: 'text', text: 'Fix error: ' + errMsg })
                })
            } else {
              v2 = currentCode
              if (passNum === 1) {
                updatePS(pid, 4, 'done', 'No fixes needed \u2713')
              } else {
                updatePS(
                  pid,
                  4,
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
      // Spec compliance check (runs when a thought brief is active)
      var activeThought = ST.activeThoughtId
        ? ST.thoughts.find(function (t) {
            return t.id === ST.activeThoughtId
          })
        : null
      if (activeThought && activeThought.brief && v2) {
        var featureChecklist = activeThought.featureChecklist || []
        var complianceInput = 'APP SPECIFICATION:\n' + specText + '\n\nUSER RULES:\n' + rulesText
        if (featureChecklist.length) {
          complianceInput +=
            '\n\nFEATURE CHECKLIST (verify each):\n' +
            featureChecklist
              .map(function (f, i) {
                return i + 1 + '. ' + (f.required ? '[REQUIRED] ' : '[OPTIONAL] ') + f.text
              })
              .join('\n')
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
              if (compliance.score < 50) {
                addMsg({
                  role: 'asst',
                  type: 'text',
                  text:
                    'Low spec compliance (' +
                    compliance.score +
                    '/100). The built app may not match your ideation brief. Consider re-running the think engine or providing more specific requirements.',
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
      // Supabase auto-injection
      if (v2 && ST.backendEnabled && ST.sbUrl) {
        v2 = autoInjectSupabase(v2)
      }

      // Step 5 — Push to branch
      checkPipelineCancel()
      if (hasGitHub) {
        updatePS(pid, 5, 'active', 'Pushing to ' + branchName + '\u2026')
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
            updatePS(pid, 5, 'done', 'Pushed to branch \u2713')
            _persistProgress(5)
          })
          .catch(function (e) {
            updatePS(pid, 5, 'error', e.message)
            throw new Error('Branch push failed: ' + e.message)
          })
      } else {
        updatePS(pid, 5, 'skip', 'Local-only')
        return Promise.resolve()
      }
    })
    .then(function () {
      // Step 6 — Preview
      updatePS(pid, 6, 'done', 'Preview ready')
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

      // Step 7 — Final Validation (approval gate)
      updatePS(pid, 7, 'wait', 'Waiting for your approval\u2026')
      addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
      notifyUser('Build Ready for Review', appName + ' is waiting for your approval.')
      _approvalStartTs = Date.now()

      return waitForApproval(pid)
    })
    .then(function () {
      updatePS(pid, 7, 'done', 'Approved \u2713')
      var _approvalMs = _approvalStartTs ? Date.now() - _approvalStartTs : null
      telemetry.emit('user.approval', { approved: true, timeMs: _approvalMs })
      telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'approved')
      telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalMs)

      // Step 8 — Merge to main
      var mergeStatusId = 'merge-' + Date.now()
      if (hasGitHub) {
        updatePS(pid, 8, 'active', 'Merging to main\u2026')
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
            updatePS(pid, 8, 'done', 'Merged & deploying \u2713')
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
            updatePS(pid, 8, 'error', safeE)
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
        updatePS(pid, 8, 'done', 'Saved locally \u2713')
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
      return showFeedbackCard(appId, appName, prompt).then(function () {
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
        telemetry.emit('user.approval', {
          approved: false,
          timeMs: _approvalStartTs ? Date.now() - _approvalStartTs : null,
        })
        telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'rejected')
        updatePS(pid, 7, 'error', 'Changes requested')
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

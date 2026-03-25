import {
  retryStep,
  notifyUser,
  setupPipelineGuards,
  resolveThoughtContext,
  saveWebsiteApp,
  saveChatSession,
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
  callClaudeRaw,
  modelRaw,
  selectedModelLabel,
  hasSelectedModelKey,
  selectedModelKeyName,
  resetCostAccum,
  calculateBuildCost,
  ghCreateBranch,
  ghMergeBranch,
  ghDeleteBranch,
  ghPushManifest,
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
  autoInjectSupabase,
  showFeedbackCard,
  renderGrid,
  openProjectSheet,
  injectProfileContext,
  getThoughtDesignOverrides,
  getTemplateSkeleton,
  telemetry,
  shouldSkipStep,
  buildResumeContext,
} from './pipeline-shared.js'
import { ghPushTree } from '../lib/github.js'
import {
  SYS_WEB_DECOMPOSE,
  SYS_WEB_SCAFFOLD,
  SYS_WEB_TOKENS,
  SYS_WEB_DATA,
  SYS_WEB_SHARED,
  SYS_WEB_FEATURES,
  SYS_WEB_LAYOUT,
  SYS_WEB_PAGES,
  SYS_WEB_ROUTING,
  SYS_WEB_DOCS,
  SYS_WEB_PREVIEW,
} from '../config/prompts-website.js'

// Parse JSON from Claude response, with fallback extraction
function parseJSON(raw) {
  try {
    return JSON.parse(raw)
  } catch (e) {}
  var start = raw.indexOf('{')
  var end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.substring(start, end + 1))
    } catch (e2) {}
  }
  throw new Error('Claude returned invalid JSON')
}

// Build a file manifest string (paths only) from accumulated files
function fileManifest(files) {
  return Object.keys(files).join('\n')
}

// Build a full content dump for specific file patterns
function filesMatching(files, pattern) {
  var result = ''
  var keys = Object.keys(files)
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(pattern) >= 0) {
      result += '\n--- ' + keys[i] + ' ---\n' + files[keys[i]]
    }
  }
  return result
}

// Get full content of specific file
function fileContent(files, path) {
  return files[path] || ''
}

/**
 * Website Builder — Claude-only multi-file pipeline (14 steps)
 * 0: Decompose  1: Scaffold  2: Design Tokens  3: Data Layer
 * 4: Shared Components  5: Feature Components  6: Layout Components
 * 7: Pages  8: Routing  9: Documentation
 * 10: Push  11: Preview  12: Approval  13: Merge
 */
export function runWebsitePipeline(prompt, existingApp, resumeSession, images) {
  var customName = typeof resumeSession === 'string' ? resumeSession : null
  if (resumeSession && typeof resumeSession === 'string') resumeSession = null
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  registerPipeType(pid, 'website')
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel')
    if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid, pipelineType: 'website' })
  }, 0)

  var guards = setupPipelineGuards(pid)

  var appName = existingApp ? existingApp.name : (customName && customName.trim()) || autoName(prompt)
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName =
    (resumeSession && resumeSession.branchName) ||
    (hasGitHub ? 'builder/site-' + appId + '-' + Date.now().toString(36) : '')

  var _buildId = telemetry.startBuild(appId, 'website')
  var _br = telemetry.createBuildRecord(appId, 'website', prompt, {
    isUpdate: !!existingApp,
    thoughtId: ST.activeThoughtId || null,
    templateId: ST._pendingTemplate ? ST._pendingTemplate.id || 'template' : null,
    hasImages: !!(images && images.length),
  })
  var _approvalStartTs = 0

  var files = {} // accumulated: { 'package.json': '...', 'src/global.css': '...' }
  var decomposition = '' // raw JSON string from step 0
  var previewHtml = '' // bundled single-file preview

  function _persistProgress(lastStep) {
    persistBuildSession({
      pid: pid,
      appId: appId,
      appName: appName,
      appIcon: appIcon,
      appCi: appCi,
      prompt: prompt,
      pipelineMode: 'website',
      branchName: branchName,
      lastStep: lastStep,
      steps: getPipelineSteps(),
      ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: Object.keys(files).length > 0,
    })
  }

  // Merge new files into accumulated files
  function mergeFiles(newFiles) {
    if (!newFiles) return
    for (var path in newFiles) {
      files[path] = newFiles[path]
    }
  }

  // Call Claude for a generation step, parse JSON response with files
  function generateStep(sysPrompt, userMsg, maxTokens, label) {
    return retryStep(
      function () {
        return modelRaw(sysPrompt, userMsg, maxTokens || 12000, null)
      },
      2,
      label
    ).then(function (raw) {
      var parsed = parseJSON(raw)
      if (parsed.files) {
        mergeFiles(parsed.files)
        return parsed
      }
      return parsed
    })
  }

  var _resumeCtx = resumeSession ? buildResumeContext(resumeSession) : ''
  var _isResuming = !!resumeSession
  if (_isResuming) {
    addMsg({ role: 'system', text: 'Resuming from previous session \u2014 skipping completed steps.' })
  }
  ST._resumeSession = null

  // Silent branch creation
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
      console.warn('[Website] Branch creation failed, continuing local-only:', e.message)
      hasGitHub = false
      branchName = ''
    })
  }

  var _templateSkeleton = null
  var _thoughtDesign = null
  if (!existingApp && ST._pendingTemplate) {
    var pending = ST._pendingTemplate
    ST._pendingTemplate = null
    var activeThought = ST.activeThoughtId
      ? ST.thoughts.find(function (t) {
          return t.id === ST.activeThoughtId
        })
      : null
    _thoughtDesign = getThoughtDesignOverrides(activeThought)
    p = p.then(function () {
      return (pending.skeleton ? Promise.resolve(pending.skeleton) : getTemplateSkeleton(pending.id)).then(
        function (skeleton) {
          _templateSkeleton = skeleton
        }
      )
    })
  }

  p.then(function () {
    // Step 0 — Decompose
    checkPipelineCancel()
    updatePS(pid, 0, 'active', 'Analyzing requirements\u2026')
    var decomposeMsg = 'Build a website for: ' + prompt
    if (images && images.length)
      decomposeMsg += '\n\n[' + images.length + ' reference image' + (images.length > 1 ? 's' : '') + ' attached]'
    var effectiveDecomposeSys = injectProfileContext(SYS_WEB_DECOMPOSE)

    var thoughtCtx = resolveThoughtContext()
    if (thoughtCtx.activeThought) {
      if (thoughtCtx.specText !== 'No specification provided') {
        effectiveDecomposeSys += '\n\nAPP SPECIFICATION (from user ideation session):\n' + thoughtCtx.specText
      }
      if (thoughtCtx.rulesText !== 'No specific rules') {
        effectiveDecomposeSys += '\n\nUSER RULES (follow these constraints strictly):\n' + thoughtCtx.rulesText
      }
      if (!existingApp && thoughtCtx.activeThought.brief) {
        decomposeMsg =
          'Build a website based on the specification above.\n\nSite Name: ' +
          (thoughtCtx.activeThought.brief.name || customName || 'My Site') +
          '\n\nAdditional notes: ' +
          prompt
        if (images && images.length)
          decomposeMsg += '\n\n[' + images.length + ' reference image' + (images.length > 1 ? 's' : '') + ' attached]'
      }
    }
    if (_templateSkeleton) {
      decomposeMsg += formatTemplateInjection(_templateSkeleton, _thoughtDesign)
    }
    if (_resumeCtx) decomposeMsg += '\n\n' + _resumeCtx
    return retryStep(
      function () {
        return modelRaw(effectiveDecomposeSys, decomposeMsg, 4000, images)
      },
      2,
      'Decompose'
    ).then(function (raw) {
      decomposition = raw
      updatePS(pid, 0, 'done', 'Decomposition complete \u2713')
      telemetry.emit('build.plan', { planLength: raw.length })
      telemetry.updateBuildRecord(_buildId, 'plan', raw)
      _persistProgress(0)
      addMsg({ role: 'asst', type: 'text', text: 'Architecture decomposed. Starting build\u2026' })
    })
  })
    .then(function () {
      // Step 1 — Scaffold
      checkPipelineCancel()
      updatePS(pid, 1, 'active', 'Generating project skeleton\u2026')
      var sys = SYS_WEB_SCAFFOLD.replace('{DECOMPOSE}', decomposition)
      return generateStep(
        sys,
        'Generate the project scaffold based on the decomposition above.',
        8000,
        'Scaffold'
      ).then(function () {
        updatePS(pid, 1, 'done', Object.keys(files).length + ' files \u2713')
        _persistProgress(1)
      })
    })
    .then(function () {
      // Step 2 — Design Tokens
      updatePS(pid, 2, 'active', 'Building design system\u2026')
      var sys = SYS_WEB_TOKENS.replace('{DECOMPOSE}', decomposition)
      return generateStep(sys, 'Generate the complete CSS design token system.', 8000, 'Tokens').then(function () {
        updatePS(pid, 2, 'done', 'Design tokens ready \u2713')
        _persistProgress(2)
      })
    })
    .then(function () {
      // Step 3 — Data Layer
      updatePS(pid, 3, 'active', 'Writing data files\u2026')
      var sys = SYS_WEB_DATA.replace('{DECOMPOSE}', decomposition).replace(
        '{TOKENS}',
        fileContent(files, 'src/global.css')
      )
      return generateStep(sys, 'Generate all data layer files with realistic content.', 10000, 'Data').then(
        function () {
          updatePS(pid, 3, 'done', 'Data layer complete \u2713')
          _persistProgress(3)
        }
      )
    })
    .then(function () {
      // Step 4 — Shared Components
      updatePS(pid, 4, 'active', 'Building shared components\u2026')
      var sys = SYS_WEB_SHARED.replace('{DECOMPOSE}', decomposition)
        .replace('{TOKENS}', fileContent(files, 'src/global.css'))
        .replace('{DATA_MANIFEST}', filesMatching(files, 'src/data/'))
      return generateStep(sys, 'Build all shared/leaf UI components.', 16000, 'Shared').then(function () {
        var sharedCount = Object.keys(files).filter(function (f) {
          return f.indexOf('shared/') >= 0
        }).length
        updatePS(pid, 4, 'done', sharedCount + ' shared component' + (sharedCount !== 1 ? 's' : '') + ' \u2713')
        _persistProgress(4)
      })
    })
    .then(function () {
      // Step 5 — Feature Components
      updatePS(pid, 5, 'active', 'Building feature components\u2026')
      var sys = SYS_WEB_FEATURES.replace('{DECOMPOSE}', decomposition)
        .replace('{TOKENS}', fileContent(files, 'src/global.css'))
        .replace('{DATA}', filesMatching(files, 'src/data/'))
        .replace('{SHARED}', filesMatching(files, 'shared/'))
      return generateStep(sys, 'Build all feature/section components.', 16000, 'Features').then(function () {
        var featCount = Object.keys(files).filter(function (f) {
          return f.indexOf('features/') >= 0
        }).length
        updatePS(pid, 5, 'done', featCount + ' feature component' + (featCount !== 1 ? 's' : '') + ' \u2713')
        _persistProgress(5)
      })
    })
    .then(function () {
      // Step 6 — Layout Components
      updatePS(pid, 6, 'active', 'Building layout components\u2026')
      var sys = SYS_WEB_LAYOUT.replace('{DECOMPOSE}', decomposition)
        .replace('{TOKENS}', fileContent(files, 'src/global.css'))
        .replace('{NAV_DATA}', fileContent(files, 'src/data/navigation.js'))
        .replace('{SETTINGS_DATA}', fileContent(files, 'src/data/settings.js'))
        .replace('{SHARED}', filesMatching(files, 'shared/'))
      return generateStep(sys, 'Build Header, Footer, and any layout wrapper components.', 12000, 'Layout').then(
        function () {
          updatePS(pid, 6, 'done', 'Layout components ready \u2713')
          _persistProgress(6)
        }
      )
    })
    .then(function () {
      // Step 7 — Pages
      updatePS(pid, 7, 'active', 'Assembling pages\u2026')
      var sys = SYS_WEB_PAGES.replace('{DECOMPOSE}', decomposition)
        .replace('{FEATURES}', filesMatching(files, 'features/'))
        .replace(
          '{SHARED}',
          fileManifest(files)
            .split('\n')
            .filter(function (f) {
              return f.indexOf('shared/') >= 0
            })
            .join('\n')
        )
      return generateStep(sys, 'Build all page components as assemblers of feature sections.', 12000, 'Pages').then(
        function () {
          var pageCount = Object.keys(files).filter(function (f) {
            return f.indexOf('pages/') >= 0
          }).length
          updatePS(pid, 7, 'done', pageCount + ' page' + (pageCount !== 1 ? 's' : '') + ' \u2713')
          _persistProgress(7)
        }
      )
    })
    .then(function () {
      // Step 8 — Routing
      updatePS(pid, 8, 'active', 'Wiring routes\u2026')
      var sys = SYS_WEB_ROUTING.replace('{DECOMPOSE}', decomposition)
        .replace('{PAGES}', filesMatching(files, 'pages/'))
        .replace('{LAYOUT}', filesMatching(files, 'layout/'))
      return generateStep(sys, 'Generate the final App.jsx with all routes wired.', 6000, 'Routing').then(function () {
        updatePS(pid, 8, 'done', 'Routing complete \u2713')
        _persistProgress(8)
      })
    })
    .then(function () {
      // Step 9 — Documentation
      updatePS(pid, 9, 'active', 'Writing documentation\u2026')
      var sys = SYS_WEB_DOCS.replace('{DECOMPOSE}', decomposition).replace('{MANIFEST}', fileManifest(files))
      return generateStep(sys, 'Generate a comprehensive README.md.', 6000, 'Docs').then(function () {
        updatePS(pid, 9, 'done', 'Documentation ready \u2713')
        _persistProgress(9)
        var _totalCodeSize = 0
        var _fileKeys = Object.keys(files)
        for (var fi = 0; fi < _fileKeys.length; fi++) _totalCodeSize += (files[_fileKeys[fi]] || '').length
        telemetry.emit('build.code', { charCount: _totalCodeSize, fileCount: _fileKeys.length })
        addMsg({
          role: 'asst',
          type: 'text',
          text: _fileKeys.length + ' files generated. Preparing preview\u2026',
        })
      })
    })
    .then(function () {
      // Step 10 — Push to Branch
      if (hasGitHub) {
        updatePS(pid, 10, 'active', 'Pushing ' + Object.keys(files).length + ' files\u2026')
        var prefixedFiles = {}
        var paths = Object.keys(files)
        for (var i = 0; i < paths.length; i++) {
          prefixedFiles['sites/' + appId + '/' + paths[i]] = files[paths[i]]
        }
        return retryStep(
          function () {
            return ghPushTree(prefixedFiles, (existingApp ? 'Update' : 'Add') + ' website: ' + appName, branchName)
          },
          3,
          'PushTree'
        )
          .then(function () {
            updatePS(pid, 10, 'done', 'Pushed ' + paths.length + ' files \u2713')
            _persistProgress(10)
          })
          .catch(function (e) {
            updatePS(pid, 10, 'error', scrubKeys(e.message))
            throw new Error('Push failed: ' + e.message)
          })
      } else {
        updatePS(pid, 10, 'skip', 'Local-only')
        return Promise.resolve()
      }
    })
    .then(function () {
      // Generate bundled preview
      updatePS(pid, 11, 'active', 'Bundling preview\u2026')
      var allFilesStr = ''
      var keys = Object.keys(files)
      for (var i = 0; i < keys.length; i++) {
        allFilesStr += '\n--- ' + keys[i] + ' ---\n' + files[keys[i]]
      }
      return retryStep(
        function () {
          return modelRaw(SYS_WEB_PREVIEW, allFilesStr, 16000, null)
        },
        2,
        'Preview'
      )
        .then(function (html) {
          previewHtml = html
        })
        .catch(function (e) {
          console.warn('[Website] Preview generation failed:', e.message)
          // Fallback: show file tree only
          previewHtml =
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
            esc(appName) +
            ' Preview</title><style>body{background:#0a0a0a;color:#fff;font-family:system-ui;padding:40px;text-align:center}h1{font-size:24px;margin-bottom:16px}p{color:rgba(255,255,255,.5);margin-bottom:32px}.files{text-align:left;max-width:500px;margin:0 auto}.f{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.1);font-family:monospace;font-size:13px;color:rgba(255,255,255,.7)}</style></head><body><h1>' +
            esc(appName) +
            '</h1><p>' +
            keys.length +
            ' files generated — clone the repo and run npm install && npm run dev to preview</p><div class="files">' +
            keys
              .map(function (f) {
                return '<div class="f">' + esc(f) + '</div>'
              })
              .join('') +
            '</div></body></html>'
        })
    })
    .then(function () {
      // Supabase auto-injection
      if (previewHtml && ST.backendEnabled && ST.sbUrl) {
        previewHtml = autoInjectSupabase(previewHtml)
      }

      // Step 11 — Preview
      updatePS(pid, 11, 'done', 'Preview ready')
      setPreview(appId, previewHtml)
      addMsg({
        role: 'asst',
        type: 'preview-card',
        code: previewHtml,
        appName: appName,
        branch: branchName || 'local',
        appId: appId,
        pid: pid,
      })
      // Show file tree
      addMsg({ role: 'asst', type: 'file-tree', files: Object.keys(files).sort() })

      // Step 12 — Approval
      updatePS(pid, 12, 'wait', 'Waiting for your approval\u2026')
      addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
      notifyUser('Website Ready for Review', appName + ' is waiting for your approval.')
      _approvalStartTs = Date.now()

      return waitForApproval(pid)
    })
    .then(function () {
      updatePS(pid, 12, 'done', 'Approved \u2713')
      var _approvalMs = _approvalStartTs ? Date.now() - _approvalStartTs : null
      telemetry.emit('user.approval', { approved: true, timeMs: _approvalMs })
      telemetry.updateBuildRecord(_buildId, 'approvalDecision', 'approved')
      telemetry.updateBuildRecord(_buildId, 'approvalTimeMs', _approvalMs)

      // Step 13 — Merge to main
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
            updatePS(pid, 13, 'done', 'Merged & deploying \u2713')
            var mc = $(mergeStatusId)
            if (mc) {
              var card = mc.querySelector('.merge-card')
              if (card)
                card.innerHTML =
                  '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><span class="merge-meta">Website source in sites/' +
                  appId +
                  '/</span></div>'
            }
            saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, true)
            clearPreview(appId)
            toast('\uD83C\uDF10 ' + appName + ' merged!', 3500)
            return 'github'
          })
          .catch(function (e) {
            var safeE = scrubKeys(e.message || String(e))
            updatePS(pid, 13, 'error', safeE)
            clearPreview(appId)
            saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
            addMsg({
              role: 'asst',
              type: 'text',
              html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. Website saved locally.',
            })
            return 'local'
          })
      } else {
        updatePS(pid, 13, 'done', 'Saved locally \u2713')
        saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
        clearPreview(appId)
        toast('\u2705 ' + appName + ' saved!', 2800)
        return 'local'
      }
    })
    .then(function (mode) {
      ST.activeAppId = appId
      notifyUser('Website Complete', appName + (mode === 'github' ? ' has been merged!' : ' has been saved.'))
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
          (mode === 'github' ? 'has been merged to main' : 'has been saved') +
          ' \uD83C\uDF89' +
          '<br><span style="font-size:11px;color:rgba(255,255,255,.5)">' +
          Object.keys(files).length +
          ' files generated</span>' +
          '<br><br>' +
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
      var _finalSize = 0
      var _fk = Object.keys(files)
      for (var fsi = 0; fsi < _fk.length; fsi++) _finalSize += (files[_fk[fsi]] || '').length
      telemetry.completeBuildRecord(_buildId, {
        finalCodeSize: _finalSize,
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
        if (Object.keys(files).length)
          saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
        ST.activeAppId = appId
        addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
        toast('Pipeline stopped', 3000)
        $('bs-proj-btn').style.display = 'flex'
        renderGrid()
        return
      }
      if (err.message === 'BUILDER_CLOSED') {
        clearPreview(appId)
        if (Object.keys(files).length)
          saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
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
        updatePS(pid, 12, 'error', 'Changes requested')
        clearPreview(appId)
        addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
        if (Object.keys(files).length)
          saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
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
      notifyUser('Website Build Failed', safeMsg)
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

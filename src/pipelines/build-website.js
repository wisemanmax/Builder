import { ST, persist } from '../lib/state.js'
import { $, esc, toast, grad, uniqueSlug, autoName, scrubKeys } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { callClaudeRaw, resetCostAccum } from '../lib/ai.js'
import { calculateBuildCost } from '../lib/cost.js'
import { injectProfileContext } from '../lib/profile-context.js'
import { ghCreateBranch, ghPushTree, ghMergeBranch, ghDeleteBranch, ghPushManifest } from '../lib/github.js'
import { addMsg, updatePS, scrollBot, getCurrentSession, clearCurrentSession, registerPipeType, getPipelineSteps, clearPipelineSteps } from '../components/message.js'
import { persistBuildSession, clearBuildSession, checkPipelineCancel, clearPipelineCancel } from '../lib/state.js'
import { setPreview, clearPreview, waitForApproval } from '../components/approval-card.js'
import { showFeedbackCard } from '../components/feedback-card.js'
import { renderGrid } from '../components/app-icon.js'
import { pushToSupabase } from '../lib/storage.js'
import { openProjectSheet } from '../screens/project.js'
import {
  SYS_WEB_DECOMPOSE, SYS_WEB_SCAFFOLD, SYS_WEB_TOKENS, SYS_WEB_DATA,
  SYS_WEB_SHARED, SYS_WEB_FEATURES, SYS_WEB_LAYOUT, SYS_WEB_PAGES,
  SYS_WEB_ROUTING, SYS_WEB_DOCS, SYS_WEB_PREVIEW
} from '../config/prompts-website.js'

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
        console.warn('[Website] ' + (label || 'Step') + ' failed (attempt ' + (n + 1) + '), retrying in ' + (delay / 1000) + 's:', e.message)
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
        tag: 'website-pipeline',
        renotify: true,
      })
      n.onclick = function () { window.focus(); n.close() }
    }
  } catch (e) {}
}

// Parse JSON from Claude response, with fallback extraction
function parseJSON(raw) {
  try { return JSON.parse(raw) } catch (e) {}
  var start = raw.indexOf('{')
  var end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.substring(start, end + 1)) } catch (e2) {}
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
export function runWebsitePipeline(prompt, existingApp, customName, images) {
  clearCurrentSession()
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true; $('send-btn').disabled = true
  var pid = 'p' + Date.now()
  var hasGitHub = !!(ST.ghToken && ST.ghUser && ST.ghRepo)
  registerPipeType(pid, 'website')
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var skelEl = $('typing-pipe-skel'); if (skelEl) skelEl.remove()
    addMsg({ role: 'asst', type: 'pipeline', id: pid, pipelineType: 'website' })
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
      navigator.locks.request('website-pipeline-' + pid, { mode: 'exclusive' }, function () {
        return new Promise(function (resolve) { _lockRelease = resolve })
      })
    }
  } catch (e) {}

  var appName = existingApp ? existingApp.name : ((customName && customName.trim()) || autoName(prompt))
  var appIcon = ST.pendingIcon
  var appCi = ST.pendingColor
  var appId = existingApp ? existingApp.id : uniqueSlug(appName)
  var branchName = hasGitHub ? ('builder/site-' + appId + '-' + Date.now().toString(36)) : ''

  var files = {}       // accumulated: { 'package.json': '...', 'src/global.css': '...' }
  var decomposition = '' // raw JSON string from step 0
  var previewHtml = ''   // bundled single-file preview

  function _persistProgress(lastStep) {
    persistBuildSession({
      pid: pid, appId: appId, appName: appName, appIcon: appIcon,
      appCi: appCi, prompt: prompt, pipelineMode: 'website',
      branchName: branchName, lastStep: lastStep,
      steps: getPipelineSteps(), ts: new Date().toISOString(),
      existingAppId: existingApp ? existingApp.id : null,
      hasCode: Object.keys(files).length > 0
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
    return retryStep(function () {
      return callClaudeRaw(sysPrompt, userMsg, maxTokens || 12000, null)
    }, 2, label).then(function (raw) {
      var parsed = parseJSON(raw)
      if (parsed.files) {
        mergeFiles(parsed.files)
        return parsed
      }
      return parsed
    })
  }

  // Silent branch creation
  var p = Promise.resolve()
  if (hasGitHub) {
    p = retryStep(function () { return ghCreateBranch(branchName) }, 3, 'Branch').catch(function (e) {
      console.warn('[Website] Branch creation failed, continuing local-only:', e.message)
      hasGitHub = false
      branchName = ''
    })
  }

  p.then(function () {
    // Step 0 — Decompose
    checkPipelineCancel()
    updatePS(pid, 0, 'active', 'Analyzing requirements\u2026')
    var decomposeMsg = 'Build a website for: ' + prompt
    if (images && images.length) decomposeMsg += '\n\n[' + images.length + ' reference image' + (images.length > 1 ? 's' : '') + ' attached]'
    var effectiveDecomposeSys = injectProfileContext(SYS_WEB_DECOMPOSE)
    return retryStep(function () { return callClaudeRaw(effectiveDecomposeSys, decomposeMsg, 4000, images) }, 2, 'Decompose').then(function (raw) {
      decomposition = raw
      updatePS(pid, 0, 'done', 'Decomposition complete \u2713')
      _persistProgress(0)
      addMsg({ role: 'asst', type: 'text', text: 'Architecture decomposed. Starting build\u2026' })
    })
  }).then(function () {
    // Step 1 — Scaffold
    checkPipelineCancel()
    updatePS(pid, 1, 'active', 'Generating project skeleton\u2026')
    var sys = SYS_WEB_SCAFFOLD.replace('{DECOMPOSE}', decomposition)
    return generateStep(sys, 'Generate the project scaffold based on the decomposition above.', 8000, 'Scaffold').then(function () {
      updatePS(pid, 1, 'done', Object.keys(files).length + ' files \u2713')
      _persistProgress(1)
    })
  }).then(function () {
    // Step 2 — Design Tokens
    updatePS(pid, 2, 'active', 'Building design system\u2026')
    var sys = SYS_WEB_TOKENS.replace('{DECOMPOSE}', decomposition)
    return generateStep(sys, 'Generate the complete CSS design token system.', 8000, 'Tokens').then(function () {
      updatePS(pid, 2, 'done', 'Design tokens ready \u2713')
      _persistProgress(2)
    })
  }).then(function () {
    // Step 3 — Data Layer
    updatePS(pid, 3, 'active', 'Writing data files\u2026')
    var sys = SYS_WEB_DATA
      .replace('{DECOMPOSE}', decomposition)
      .replace('{TOKENS}', fileContent(files, 'src/global.css'))
    return generateStep(sys, 'Generate all data layer files with realistic content.', 10000, 'Data').then(function () {
      updatePS(pid, 3, 'done', 'Data layer complete \u2713')
      _persistProgress(3)
    })
  }).then(function () {
    // Step 4 — Shared Components
    updatePS(pid, 4, 'active', 'Building shared components\u2026')
    var sys = SYS_WEB_SHARED
      .replace('{DECOMPOSE}', decomposition)
      .replace('{TOKENS}', fileContent(files, 'src/global.css'))
      .replace('{DATA_MANIFEST}', filesMatching(files, 'src/data/'))
    return generateStep(sys, 'Build all shared/leaf UI components.', 16000, 'Shared').then(function () {
      var sharedCount = Object.keys(files).filter(function (f) { return f.indexOf('shared/') >= 0 }).length
      updatePS(pid, 4, 'done', sharedCount + ' shared component' + (sharedCount !== 1 ? 's' : '') + ' \u2713')
      _persistProgress(4)
    })
  }).then(function () {
    // Step 5 — Feature Components
    updatePS(pid, 5, 'active', 'Building feature components\u2026')
    var sys = SYS_WEB_FEATURES
      .replace('{DECOMPOSE}', decomposition)
      .replace('{TOKENS}', fileContent(files, 'src/global.css'))
      .replace('{DATA}', filesMatching(files, 'src/data/'))
      .replace('{SHARED}', filesMatching(files, 'shared/'))
    return generateStep(sys, 'Build all feature/section components.', 16000, 'Features').then(function () {
      var featCount = Object.keys(files).filter(function (f) { return f.indexOf('features/') >= 0 }).length
      updatePS(pid, 5, 'done', featCount + ' feature component' + (featCount !== 1 ? 's' : '') + ' \u2713')
      _persistProgress(5)
    })
  }).then(function () {
    // Step 6 — Layout Components
    updatePS(pid, 6, 'active', 'Building layout components\u2026')
    var sys = SYS_WEB_LAYOUT
      .replace('{DECOMPOSE}', decomposition)
      .replace('{TOKENS}', fileContent(files, 'src/global.css'))
      .replace('{NAV_DATA}', fileContent(files, 'src/data/navigation.js'))
      .replace('{SETTINGS_DATA}', fileContent(files, 'src/data/settings.js'))
      .replace('{SHARED}', filesMatching(files, 'shared/'))
    return generateStep(sys, 'Build Header, Footer, and any layout wrapper components.', 12000, 'Layout').then(function () {
      updatePS(pid, 6, 'done', 'Layout components ready \u2713')
      _persistProgress(6)
    })
  }).then(function () {
    // Step 7 — Pages
    updatePS(pid, 7, 'active', 'Assembling pages\u2026')
    var sys = SYS_WEB_PAGES
      .replace('{DECOMPOSE}', decomposition)
      .replace('{FEATURES}', filesMatching(files, 'features/'))
      .replace('{SHARED}', fileManifest(files).split('\n').filter(function (f) { return f.indexOf('shared/') >= 0 }).join('\n'))
    return generateStep(sys, 'Build all page components as assemblers of feature sections.', 12000, 'Pages').then(function () {
      var pageCount = Object.keys(files).filter(function (f) { return f.indexOf('pages/') >= 0 }).length
      updatePS(pid, 7, 'done', pageCount + ' page' + (pageCount !== 1 ? 's' : '') + ' \u2713')
      _persistProgress(7)
    })
  }).then(function () {
    // Step 8 — Routing
    updatePS(pid, 8, 'active', 'Wiring routes\u2026')
    var sys = SYS_WEB_ROUTING
      .replace('{DECOMPOSE}', decomposition)
      .replace('{PAGES}', filesMatching(files, 'pages/'))
      .replace('{LAYOUT}', filesMatching(files, 'layout/'))
    return generateStep(sys, 'Generate the final App.jsx with all routes wired.', 6000, 'Routing').then(function () {
      updatePS(pid, 8, 'done', 'Routing complete \u2713')
      _persistProgress(8)
    })
  }).then(function () {
    // Step 9 — Documentation
    updatePS(pid, 9, 'active', 'Writing documentation\u2026')
    var sys = SYS_WEB_DOCS
      .replace('{DECOMPOSE}', decomposition)
      .replace('{MANIFEST}', fileManifest(files))
    return generateStep(sys, 'Generate a comprehensive README.md.', 6000, 'Docs').then(function () {
      updatePS(pid, 9, 'done', 'Documentation ready \u2713')
      _persistProgress(9)
      addMsg({ role: 'asst', type: 'text', text: Object.keys(files).length + ' files generated. Preparing preview\u2026' })
    })
  }).then(function () {
    // Step 10 — Push to Branch
    if (hasGitHub) {
      updatePS(pid, 10, 'active', 'Pushing ' + Object.keys(files).length + ' files\u2026')
      var prefixedFiles = {}
      var paths = Object.keys(files)
      for (var i = 0; i < paths.length; i++) {
        prefixedFiles['sites/' + appId + '/' + paths[i]] = files[paths[i]]
      }
      return retryStep(function () {
        return ghPushTree(prefixedFiles, (existingApp ? 'Update' : 'Add') + ' website: ' + appName, branchName)
      }, 3, 'PushTree').then(function () {
        updatePS(pid, 10, 'done', 'Pushed ' + paths.length + ' files \u2713')
        _persistProgress(10)
      }).catch(function (e) {
        updatePS(pid, 10, 'error', scrubKeys(e.message))
        throw new Error('Push failed: ' + e.message)
      })
    } else {
      updatePS(pid, 10, 'skip', 'Local-only')
      return Promise.resolve()
    }
  }).then(function () {
    // Generate bundled preview
    updatePS(pid, 11, 'active', 'Bundling preview\u2026')
    var allFilesStr = ''
    var keys = Object.keys(files)
    for (var i = 0; i < keys.length; i++) {
      allFilesStr += '\n--- ' + keys[i] + ' ---\n' + files[keys[i]]
    }
    return retryStep(function () {
      return callClaudeRaw(SYS_WEB_PREVIEW, allFilesStr, 16000, null)
    }, 2, 'Preview').then(function (html) {
      previewHtml = html
    }).catch(function (e) {
      console.warn('[Website] Preview generation failed:', e.message)
      // Fallback: show file tree only
      previewHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(appName) + ' Preview</title><style>body{background:#0a0a0a;color:#fff;font-family:system-ui;padding:40px;text-align:center}h1{font-size:24px;margin-bottom:16px}p{color:rgba(255,255,255,.5);margin-bottom:32px}.files{text-align:left;max-width:500px;margin:0 auto}.f{padding:6px 0;border-bottom:1px solid rgba(255,255,255,.1);font-family:monospace;font-size:13px;color:rgba(255,255,255,.7)}</style></head><body><h1>' + esc(appName) + '</h1><p>' + keys.length + ' files generated — clone the repo and run npm install && npm run dev to preview</p><div class="files">' + keys.map(function (f) { return '<div class="f">' + esc(f) + '</div>' }).join('') + '</div></body></html>'
    })
  }).then(function () {
    // Step 11 — Preview
    updatePS(pid, 11, 'done', 'Preview ready')
    setPreview(appId, previewHtml)
    addMsg({ role: 'asst', type: 'preview-card', code: previewHtml, appName: appName, branch: branchName || 'local', appId: appId, pid: pid })
    // Show file tree
    addMsg({ role: 'asst', type: 'file-tree', files: Object.keys(files).sort() })

    // Step 12 — Approval
    updatePS(pid, 12, 'wait', 'Waiting for your approval\u2026')
    addMsg({ role: 'asst', type: 'approval', id: 'appr-' + Date.now(), pid: pid, branch: branchName || 'local' })
    notifyUser('Website Ready for Review', appName + ' is waiting for your approval.')

    return waitForApproval(pid)
  }).then(function () {
    updatePS(pid, 12, 'done', 'Approved \u2713')

    // Step 13 — Merge to main
    var mergeStatusId = 'merge-' + Date.now()
    if (hasGitHub) {
      updatePS(pid, 13, 'active', 'Merging to main\u2026')
      addMsg({ role: 'asst', type: 'merge-status', mergeId: mergeStatusId, status: 'merging' })
      return retryStep(function () { return ghMergeBranch(branchName, appName) }, 3, 'Merge').then(function () {
        return ghPushManifest('main').catch(function () {})
      }).then(function () {
        ghDeleteBranch(branchName)
        updatePS(pid, 13, 'done', 'Merged & deploying \u2713')
        var mc = $(mergeStatusId)
        if (mc) { var card = mc.querySelector('.merge-card'); if (card) card.innerHTML = '<div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">Merged to main \u2713</span><span class="merge-meta">Website source in sites/' + appId + '/</span></div>' }
        _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, true)
        clearPreview(appId)
        toast('\uD83C\uDF10 ' + appName + ' merged!', 3500)
        return 'github'
      }).catch(function (e) {
        var safeE = scrubKeys(e.message || String(e))
        updatePS(pid, 13, 'error', safeE)
        clearPreview(appId)
        _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
        addMsg({ role: 'asst', type: 'text', html: 'Merge failed: <strong>' + esc(safeE) + '</strong>. Website saved locally.' })
        return 'local'
      })
    } else {
      updatePS(pid, 13, 'done', 'Saved locally \u2713')
      _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
      clearPreview(appId)
      toast('\u2705 ' + appName + ' saved!', 2800)
      return 'local'
    }
  }).then(function (mode) {
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
          ST.apps[ci].costs.push({ rawCost: costData.rawCost, userPrice: costData.userPrice, markup: costData.markup, totalInput: costData.totalInput, totalOutput: costData.totalOutput, ts: costData.ts })
          if (ST.apps[ci].costs.length > 50) ST.apps[ci].costs = ST.apps[ci].costs.slice(-50)
          break
        }
      }
    }
    var g = grad(appCi)
    addMsg({
      role: 'asst', type: 'text',
      html: '<strong>' + esc(appName) + '</strong> ' + (mode === 'github' ? 'has been merged to main' : 'has been saved') + ' \uD83C\uDF89'
        + '<br><span style="font-size:11px;color:rgba(255,255,255,.5)">' + Object.keys(files).length + ' files generated</span>'
        + '<br><br>'
        + '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px">'
        + '<button onclick="openApp(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:' + g + ';border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open in Studio</button>'
        + '<button onclick="openProjectSheet(\'' + appId + '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDCCB Project</button>'
        + '</div>'
    })
    return showFeedbackCard(appId, appName, prompt)
  }).catch(function (err) {
    if (err.message === 'PIPELINE_CANCELLED') {
      clearPreview(appId)
      if (Object.keys(files).length) _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
      ST.activeAppId = appId
      addMsg({ role: 'asst', type: 'text', text: 'Pipeline stopped by user. Progress saved.' })
      toast('Pipeline stopped', 3000)
      $('bs-proj-btn').style.display = 'flex'
      renderGrid()
      return
    }
    if (err.message === 'BUILDER_CLOSED') {
      clearPreview(appId)
      if (Object.keys(files).length) _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
      ST.activeAppId = appId
      renderGrid()
      return
    }
    if (err.message === 'CHANGES_REQUESTED') {
      updatePS(pid, 12, 'error', 'Changes requested')
      clearPreview(appId)
      addMsg({ role: 'asst', type: 'text', text: 'No problem! Describe what you want changed.' })
      if (Object.keys(files).length) _saveWebsiteApp(appId, appName, appIcon, appCi, files, previewHtml, prompt, existingApp, false)
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

function _saveWebsiteApp(id, name, icon, ci, siteFiles, preview, prompt, existingApp, ghPushed) {
  if (existingApp) {
    var idx = -1
    for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { idx = i; break } }
    if (idx !== -1) {
      ST.apps[idx].versions = [{ code: ST.apps[idx].code, ts: ST.apps[idx].updatedAt }].concat((ST.apps[idx].versions || []).slice(0, 9))
      ST.apps[idx].prompts = (ST.apps[idx].prompts || []).concat([{ text: prompt, ts: new Date().toISOString(), type: 'update' }])
      ST.apps[idx].code = preview
      ST.apps[idx].type = 'website'
      ST.apps[idx].files = siteFiles
      ST.apps[idx].updatedAt = new Date().toISOString()
      ST.apps[idx].ghPushed = ghPushed || ST.apps[idx].ghPushed || false
    } else {
      ST.apps.unshift({ id: id, name: name, icon: icon, ci: ci, desc: prompt.slice(0, 90), code: preview, type: 'website', files: siteFiles, versions: [], prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'update' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ghPushed: ghPushed })
    }
  } else {
    var exists = false; for (var j = 0; j < ST.apps.length; j++) { if (ST.apps[j].id === id) { exists = true; break } }
    if (!exists) {
      ST.apps.unshift({ id: id, name: name, icon: icon, ci: ci, desc: prompt.slice(0, 90), code: preview, type: 'website', files: siteFiles, versions: [], prompts: [{ text: prompt, ts: new Date().toISOString(), type: 'initial' }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ghPushed: ghPushed })
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

import { ST, persist, saveKeys } from '../lib/state.js'
import { hydrateBuildSession, clearBuildSession, requestPipelineCancel } from '../lib/state.js'
import { $, esc, escAttr, toast, autoResize } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { GRADS, PIPE_NAMES, PIPE_ICONS, PIPE2_NAMES, PIPE2_ICONS, PIPE3_NAMES, PIPE3_ICONS, PIPE4_NAMES, PIPE4_ICONS, PIPE5_NAMES, PIPE5_ICONS } from '../config/constants.js'
import { _syncStitchGate } from './settings.js'
import { TEMPLATES } from '../config/templates.js'
import { addMsg, resetChat, hydrateLiveChat } from '../components/message.js'
import { renderThoughtSelector } from '../components/thought-card.js'
import { getPreviewPid, getApprovalGates } from '../components/approval-card.js'
import { runPipeline } from '../pipelines/build-pipeline.js'
import { runPipeline2 } from '../pipelines/build-pipeline2.js'
import { runWebsitePipeline } from '../pipelines/build-website.js'
import { runWebsite2Pipeline } from '../pipelines/build-website2.js'
import { runSelfUpdatePipeline } from '../pipelines/builder-plus.js'
import { runStitchPipeline } from '../pipelines/build-stitch.js'
import { renderStitchTracker, updateStitchStage, updateStitchEstimate, updateStitchTime } from '../components/stitch-tracker.js'
import { classifyIntent, callClaudeChat, callClaudeRaw, resetCostAccum } from '../lib/ai.js'
import { clearPipelineCancel } from '../lib/state.js'
import { runQuickEdit } from '../pipelines/quick-edit.js'

// Pending images for next message (array of {base64, mediaType, name})
var _pendingImages = []

export function getPendingImages() { return _pendingImages }
export function clearPendingImages() { _pendingImages = []; _renderImagePreviews() }

function _renderImagePreviews() {
  var row = $('img-preview-row')
  if (!row) return
  if (!_pendingImages.length) { row.style.display = 'none'; row.innerHTML = ''; return }
  row.style.display = 'flex'
  var html = ''
  for (var i = 0; i < _pendingImages.length; i++) {
    html += '<div class="img-thumb" data-idx="' + i + '">'
      + '<img src="data:' + _pendingImages[i].mediaType + ';base64,' + _pendingImages[i].base64 + '" alt="' + escAttr(_pendingImages[i].name) + '">'
      + '<button class="img-thumb-rm" data-idx="' + i + '">&times;</button>'
      + '</div>'
  }
  row.innerHTML = html
}

export function removeImage(idx) {
  _pendingImages.splice(idx, 1)
  _renderImagePreviews()
}

export function handleImageFiles(files) {
  if (!files || !files.length) return
  var maxImages = 5
  var remaining = maxImages - _pendingImages.length
  if (remaining <= 0) { toast('Max ' + maxImages + ' images', 2000); return }
  var toProcess = Math.min(files.length, remaining)
  var maxSizeMB = 5
  for (var i = 0; i < toProcess; i++) {
    var file = files[i]
    if (!file.type.match(/^image\/(png|jpeg|gif|webp)$/)) { toast('Unsupported format: ' + file.name, 2000); continue }
    if (file.size > maxSizeMB * 1024 * 1024) { toast(file.name + ' exceeds ' + maxSizeMB + 'MB limit', 2000); continue }
    ;(function (f) {
      var reader = new FileReader()
      reader.onload = function () {
        var base64 = reader.result.split(',')[1]
        _pendingImages.push({ base64: base64, mediaType: f.type, name: f.name })
        _renderImagePreviews()
      }
      reader.readAsDataURL(f)
    })(file)
  }
}

export function stopPipeline() {
  if (!ST._building) return
  requestPipelineCancel()
  var btn = $('bs-stop-btn')
  if (btn) { btn.textContent = 'Stopping\u2026'; btn.disabled = true }
  addMsg({ role: 'system', text: 'Stop requested \u2014 pipeline will halt at next step.' })
}

// Show/hide stop button based on build state
export function syncStopButton() {
  var btn = $('bs-stop-btn')
  if (!btn) return
  if (ST._building) {
    btn.style.display = 'flex'
    btn.disabled = false
    btn.textContent = '\u23F9 Stop'
    btn.classList.add('active')
  } else {
    btn.style.display = 'none'
    btn.classList.remove('active')
  }
}

export function openBuilder(editId) {
  var app = editId ? ST.apps.find(function (a) { return a.id === editId }) : null
  if (editId && !app) editId = null
  ST.activeAppId = editId || null
  ST.pendingIcon = app ? app.icon : '\uD83C\uDFAF'
  ST.pendingColor = app ? app.ci : Math.floor(Math.random() * GRADS.length)
  $('emoji-pick-btn').textContent = ST.pendingIcon
  $('bs-title').textContent = app ? 'Editing: ' + app.name : 'Build an App'
  _updatePipelineSub(app)
  _syncToggle()
  $('bs-proj-btn').style.display = app ? 'flex' : 'none'
  var nameRow = $('name-row'), nameInp = $('app-name-input')
  if (app) { nameRow.style.display = 'none'; nameInp.value = '' }
  else { nameRow.style.display = ''; nameInp.value = '' }
  resetChat()
  if (app) {
    addMsg({ role: 'system', text: 'Editing: ' + app.name })
    var liveUrl = ghPageUrl(app.id)
    addMsg({ role: 'asst', type: 'text', html: 'Loaded <strong>' + esc(app.name) + '</strong>. Describe what to change.' + (liveUrl ? '<br><span style="font-family:var(--fm);font-size:10px;color:rgba(255,255,255,.35)">\uD83C\uDF10 ' + liveUrl + '</span>' : '') })
  }
  $('think-sheet').classList.remove('open')
  $('builder-sheet').classList.add('open')
  renderThoughtSelector()
  setTimeout(function () { $('chat-input').focus() }, 420)
}

export function closeBuilder() {
  $('builder-sheet').classList.remove('open')
  ST._selfUpdateMode = false
  if (getPreviewPid()) return
  var gates = getApprovalGates()
  var keys = Object.keys(gates)
  for (var i = 0; i < keys.length; i++) {
    if (gates[keys[i]]) gates[keys[i]].reject(new Error('BUILDER_CLOSED'))
    delete gates[keys[i]]
  }
  ST._building = false
  var sb = $('send-btn'); if (sb) sb.disabled = false
}

export function openCustomizeBuilder() {
  ST._selfUpdateMode = true
  ST.activeAppId = null
  $('emoji-pick-btn').textContent = '\uD83D\uDD27'
  $('bs-title').textContent = 'Customize The Builder'
  $('bs-sub').textContent = 'Describe an improvement \u2192 Claude rewrites \u2192 Push \u2192 Reload'
  $('bs-proj-btn').style.display = 'none'
  $('name-row').style.display = 'none'
  $('app-name-input').value = ''
  resetChat()
  var w = $('chat-welcome'); if (w) {
    w.innerHTML = '<div class="cw-icon">\uD83D\uDD27</div>'
      + '<div class="cw-title">Customize The Builder</div>'
      + '<div class="cw-sub">Describe any improvement and Claude will rewrite The Builder itself, push to GitHub, and reload.</div>'
      + '<div class="chips">'
      + '<div class="chip" onclick="chipSend(\'Add a dark/light theme toggle to the home screen\')">\uD83C\uDF19 Dark mode</div>'
      + '<div class="chip" onclick="chipSend(\'Improve the app grid layout and animations\')">\u2728 Better grid</div>'
      + '<div class="chip" onclick="chipSend(\'Add app search/filter on the home screen\')">\uD83D\uDD0D Search</div>'
      + '<div class="chip" onclick="chipSend(\'Add app categories and folders on the home screen\')">\uD83D\uDCC2 Folders</div>'
      + '</div>'
    w.style.display = ''
  }
  $('builder-sheet').classList.add('open')
  setTimeout(function () { $('chat-input').focus() }, 420)
}

export function chipSend(t) { $('chat-input').value = t; autoResize($('chat-input')); sendMsg() }

export function templateSend(templateId) {
  var tpl = TEMPLATES.find(function (t) { return t.id === templateId })
  if (!tpl) return
  ST._pendingTemplate = tpl
  $('chat-input').value = 'Build a ' + tpl.name.toLowerCase()
  autoResize($('chat-input'))
  var w = $('chat-welcome'); if (w) w.style.display = 'none'
  addMsg({ role: 'system', text: 'Template selected: ' + tpl.icon + ' ' + tpl.name + ' \u2014 customize your prompt and hit send.' })
  $('chat-input').focus()
}

export function sendMsg() {
  var inp = $('chat-input')
  var text = inp.value.trim()
  if (!text && !_pendingImages.length) return
  if (!text && _pendingImages.length) { toast('Add a description with your images', 2000); return }
  if (ST._building) return
  if (!ST.key) { toast('Add your Anthropic API key in Settings first', 4000); return }
  inp.value = ''; autoResize(inp)
  var images = _pendingImages.slice()
  clearPendingImages()
  addMsg({ role: 'user', text: text, images: images })
  if (ST._selfUpdateMode) {
    runSelfUpdatePipeline(text)
    return
  }
  var customName = $('app-name-input').value.trim()
  var existing = ST.activeAppId ? ST.apps.find(function (a) { return a.id === ST.activeAppId }) : null
  // If editing an existing app, classify change magnitude for quick vs full pipeline
  if (existing) {
    $('app-name-input').value = ''
    // Quick edit for small changes (CSS tweaks, text, colors, simple additions)
    _classifyAndRoute(text, existing, customName, images)
    return
  }
  // Classify intent before routing
  ST._building = true; $('send-btn').disabled = true
  classifyIntent(text, images).then(function (intent) {
    ST._building = false; $('send-btn').disabled = false
    if (intent === 'chat') {
      _handleChat(text, images)
    } else {
      $('app-name-input').value = ''
      _runBuild(text, existing, customName, images)
    }
  })
}

function _runBuild(text, existing, customName, images) {
  if (ST.pipelineMode === 'stitch') {
    _runStitchBuild(text, existing, customName, images)
  } else if (ST.pipelineMode === 'website2') {
    runWebsite2Pipeline(text, existing, customName, images)
  } else if (ST.pipelineMode === 'website') {
    runWebsitePipeline(text, existing, customName, images)
  } else if (ST.pipelineMode === 'builder2') {
    runPipeline2(text, existing, customName, images)
  } else {
    runPipeline(text, existing, customName, images)
  }
  syncStopButton()
  _startStopBtnSync()
}

var SYS_CLASSIFY_MAGNITUDE = 'Classify this change request for an existing web app as either "quick" or "full".\nQuick: CSS tweaks, color changes, text edits, simple style updates, adding/removing a single element, toggling visibility, font changes.\nFull: New features, new pages/views, adding data models, architectural changes, API integrations, complex interactive components.\nReturn ONLY JSON: {"magnitude":"quick"} or {"magnitude":"full"}'

function _classifyAndRoute(text, existing, customName, images) {
  // Short prompts that look like simple edits → quick classify
  var isLikelyQuick = text.length < 100 && !images.length
  if (!isLikelyQuick) {
    _runBuild(text, existing, customName, images)
    return
  }
  ST._building = true; $('send-btn').disabled = true
  callClaudeRaw(SYS_CLASSIFY_MAGNITUDE, text, 50).then(function (raw) {
    ST._building = false; $('send-btn').disabled = false
    try {
      var parsed = JSON.parse(raw)
      if (parsed.magnitude === 'quick') {
        runQuickEdit(text, existing, images)
        syncStopButton()
        _startStopBtnSync()
        return
      }
    } catch (e) {}
    _runBuild(text, existing, customName, images)
  }).catch(function () {
    ST._building = false; $('send-btn').disabled = false
    _runBuild(text, existing, customName, images)
  })
}

function _runStitchBuild(text, existing, customName, images) {
  resetCostAccum()
  clearPipelineCancel()
  ST._building = true
  var sb = $('send-btn'); if (sb) sb.disabled = true
  var pid = 'sp' + Date.now()
  var containerId = 'stitch-' + Date.now()

  // Render the 7-stage tracker
  addMsg({ role: 'asst', type: 'typing-pipeline' })
  setTimeout(function () {
    var typingEl = document.querySelector('.msg-typing-pipeline')
    if (typingEl) typingEl.remove()
    addMsg({ role: 'asst', type: 'text', html: '<div id="' + containerId + '"></div>' })
    setTimeout(function () {
      renderStitchTracker(containerId)

      // Build context object
      var activeThought = ST.activeThoughtId
        ? ST.thoughts.find(function (t) { return t.id === ST.activeThoughtId })
        : null

      var context = {
        prompt: text,
        activeThought: activeThought,
        pid: pid,
        containerId: containerId,
        existingApp: existing,
        customName: customName
      }

      var callbacks = {
        updateStage: function (idx, status, detail) {
          updateStitchStage(containerId, idx,
            status === 'running' ? 'running' : status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'running',
            detail)
        },
        updateEstimate: function (text) {
          updateStitchEstimate(containerId, text)
        },
        updateTime: function (text) {
          updateStitchTime(containerId, text)
        }
      }

      runStitchPipeline(context, callbacks).catch(function (err) {
        ST._building = false
        var sb2 = $('send-btn'); if (sb2) sb2.disabled = false
        if (err.message === 'STITCH_HALT') {
          var safeMsg = err.originalError || 'Pipeline halted'
          addMsg({
            role: 'asst', type: 'text',
            html: '<strong>Pipeline halted at ' + esc(err.stageName || 'unknown') + '</strong>: ' + esc(safeMsg)
              + '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">'
              + '<button class="chip" onclick="chipSend(\'Retry from ' + esc(err.stageName || '') + '\')">🔄 (a) Retry</button>'
              + '<button class="chip" onclick="document.querySelector(\'[data-mode=standard]\').click()">↩ (b) Standard pipeline</button>'
              + '<button class="chip" onclick="void(0)">✕ (c) Abort</button>'
              + '</div>'
          })
        }
      })
    }, 50)
  }, 300)
}

function _handleChat(text, images) {
  addMsg({ role: 'asst', type: 'typing' })
  callClaudeChat(text, images).then(function (reply) {
    var typingEl = document.querySelector('.msg-typing')
    if (typingEl) typingEl.remove()
    addMsg({ role: 'asst', type: 'text', text: reply })
  }).catch(function (e) {
    var typingEl = document.querySelector('.msg-typing')
    if (typingEl) typingEl.remove()
    addMsg({ role: 'asst', type: 'text', text: 'Sorry, something went wrong: ' + (e.message || String(e)) })
  })
}

// Pipeline mode toggle helpers
function _updatePipelineSub(app) {
  if (app) {
    $('bs-sub').textContent = 'Describe changes'
  } else if (ST.pipelineMode === 'stitch') {
    $('bs-sub').textContent = 'Intake \u2192 Blueprint \u2192 Assemble \u2192 Verify \u2192 Review \u2192 Polish \u2192 Deliver'
  } else if (ST.pipelineMode === 'website2') {
    $('bs-sub').textContent = 'Recon \u2192 Structure \u2192 Design \u2192 Build \u2192 Check \u2192 Audit \u2192 Fix \u2192 Push \u2192 Preview \u2192 Approve \u2192 Merge'
  } else if (ST.pipelineMode === 'website') {
    $('bs-sub').textContent = 'Decompose \u2192 Scaffold \u2192 Tokens \u2192 Data \u2192 Components \u2192 Pages \u2192 Route \u2192 Docs \u2192 Push \u2192 Merge'
  } else if (ST.pipelineMode === 'builder2') {
    $('bs-sub').textContent = 'Plan \u2192 Build \u2192 Check \u2192 Audit \u2192 Fix \u2192 Push \u2192 Preview \u2192 Approve \u2192 Merge'
  } else {
    $('bs-sub').textContent = 'Branch \u2192 Build \u2192 Check \u2192 Audit \u2192 Fix \u2192 Preview \u2192 Approve \u2192 Merge'
  }
}

function _syncToggle() {
  var btns = document.querySelectorAll('#pipe-toggle .pt-btn')
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].dataset.mode === ST.pipelineMode) btns[i].classList.add('active')
    else btns[i].classList.remove('active')
  }
  _syncStitchGate()
  // Show model toggle only for website2
  var mt = $('model-toggle')
  if (mt) {
    mt.style.display = ST.pipelineMode === 'website2' ? 'flex' : 'none'
    var mbtns = mt.querySelectorAll('.mt-btn')
    for (var j = 0; j < mbtns.length; j++) {
      if (mbtns[j].dataset.provider === ST.website2Provider) mbtns[j].classList.add('active')
      else mbtns[j].classList.remove('active')
    }
  }
}

// --- Interrupted build recovery ---
export function checkInterruptedBuild() {
  var session = hydrateBuildSession()
  if (!session) return false
  // If the build completed normally, clearBuildSession was called, so we won't get here.
  // This means the build was interrupted.
  return session
}

export function recoverInterruptedBuild(session) {
  var app = session.appId ? ST.apps.find(function (a) { return a.id === session.appId }) : null
  ST.activeAppId = session.appId || null
  ST.pendingIcon = session.appIcon || '\uD83C\uDFAF'
  ST.pendingColor = session.appCi || 0
  $('emoji-pick-btn').textContent = ST.pendingIcon
  $('bs-title').textContent = 'Interrupted Build: ' + (session.appName || 'App')
  $('bs-sub').textContent = 'This build was interrupted. Review progress below.'
  $('bs-proj-btn').style.display = app ? 'flex' : 'none'
  $('name-row').style.display = 'none'
  $('app-name-input').value = ''
  resetChat()

  // Add a system message about the interruption
  addMsg({ role: 'system', text: 'Build interrupted — showing recovered progress for "' + (session.appName || 'App') + '"' })

  // Restore the saved chat messages
  var savedChat = hydrateLiveChat()
  if (savedChat && savedChat.length) {
    for (var i = 0; i < savedChat.length; i++) {
      var m = savedChat[i]
      if (m.role === 'user') {
        addMsg({ role: 'user', text: m.text || '' })
      } else if (m.role === 'system') {
        addMsg({ role: 'system', text: m.text || '' })
      } else {
        // Restore assistant messages as text
        addMsg({ role: 'asst', type: 'text', html: m.html || undefined, text: m.text || '' })
      }
    }
  }

  // Show pipeline progress summary
  if (session.steps) {
    var isStitch = session.pipelineMode === 'stitch'
    var isWeb2 = session.pipelineMode === 'website2'
    var isWeb = session.pipelineMode === 'website'
    var isB2 = session.pipelineMode === 'builder2'
    var names = isStitch ? PIPE5_NAMES : isWeb2 ? PIPE4_NAMES : isWeb ? PIPE3_NAMES : isB2 ? PIPE2_NAMES : PIPE_NAMES
    var icons = isStitch ? PIPE5_ICONS : isWeb2 ? PIPE4_ICONS : isWeb ? PIPE3_ICONS : isB2 ? PIPE2_ICONS : PIPE_ICONS
    var modeLabel = isStitch ? 'Flawless Pipeline' : isWeb2 ? 'Website 2' : isWeb ? 'Website' : isB2 ? 'Claude-Only' : 'Standard'
    var summaryHtml = '<div style="margin-top:4px"><strong>Pipeline Progress</strong> <span style="font-size:10px;color:rgba(255,255,255,.35)">(' + modeLabel + ')</span></div>'
    summaryHtml += '<div style="display:flex;flex-direction:column;gap:3px;margin-top:6px">'
    var pid = session.pid || 'recovered'
    var stepData = session.steps[pid] || {}
    for (var si = 0; si < names.length; si++) {
      var sd = stepData[si]
      var stateClass = sd ? sd.state : 'idle'
      var stateIcon = stateClass === 'done' ? '\u2713' : stateClass === 'error' ? '\u2717' : stateClass === 'warn' ? '\u26A0' : stateClass === 'active' ? '\u25CF' : '\u00B7'
      var stateColor = stateClass === 'done' ? 'rgba(0,230,118,.8)' : stateClass === 'error' ? 'rgba(255,82,82,.8)' : stateClass === 'warn' ? 'rgba(255,214,0,.8)' : stateClass === 'active' ? 'rgba(61,90,254,.8)' : 'rgba(255,255,255,.2)'
      summaryHtml += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px">'
        + '<span style="width:16px;text-align:center;color:' + stateColor + '">' + stateIcon + '</span>'
        + '<span style="color:rgba(255,255,255,.5)">' + (icons[si] || '') + '</span>'
        + '<span style="color:rgba(255,255,255,.7)">' + esc(names[si]) + '</span>'
        + (sd && sd.detail ? '<span style="margin-left:auto;font-size:10px;font-family:var(--fm);color:rgba(255,255,255,.3)">' + esc(sd.detail) + '</span>' : '')
        + '</div>'
    }
    summaryHtml += '</div>'
    addMsg({ role: 'asst', type: 'text', html: summaryHtml })
  }

  // Add action buttons
  var hasCode = session.hasCode
  var actionHtml = '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:4px">'
  if (hasCode && app) {
    actionHtml += '<button onclick="openApp(\'' + esc(session.appId) + '\')" style="padding:8px 16px;border-radius:9px;background:var(--g1);border:none;color:#fff;font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\uD83D\uDE80 Open Saved Version</button>'
  }
  actionHtml += '<button onclick="dismissRecovery()" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\u2713 Dismiss</button>'
  if (app) {
    actionHtml += '<button onclick="openBuilder(\'' + esc(session.appId) + '\')" style="padding:8px 16px;border-radius:9px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);font-family:var(--fh);font-size:11px;font-weight:700;cursor:pointer">\u270F\uFE0F Retry Build</button>'
  }
  actionHtml += '</div>'
  addMsg({ role: 'asst', type: 'text', html: actionHtml })

  // Save chat session to the app's history so it persists permanently
  if (app) {
    if (!app.chatHistory) app.chatHistory = []
    var recoveredMessages = savedChat || []
    if (recoveredMessages.length) {
      app.chatHistory.unshift({
        id: 's' + Date.now(), ts: session.ts || new Date().toISOString(),
        prompt: '(Interrupted) ' + (session.prompt || '').slice(0, 180),
        messages: recoveredMessages
      })
      if (app.chatHistory.length > 10) app.chatHistory = app.chatHistory.slice(0, 10)
      persist()
    }
  }

  // Clear the interrupted session data (now saved to chat history)
  clearBuildSession()
  try { localStorage.removeItem('bldr_live_chat') } catch (e) {}

  // Open the builder sheet
  $('think-sheet').classList.remove('open')
  $('builder-sheet').classList.add('open')
}

export function dismissRecovery() {
  closeBuilder()
}

// Poll to sync stop button visibility when build state changes
var _stopBtnInterval = null
function _startStopBtnSync() {
  if (_stopBtnInterval) return
  _stopBtnInterval = setInterval(function () {
    syncStopButton()
    if (!ST._building && _stopBtnInterval) {
      clearInterval(_stopBtnInterval)
      _stopBtnInterval = null
    }
  }, 500)
}

export function initPipelineToggle() {
  var toggle = $('pipe-toggle')
  if (!toggle) return
  _syncStitchGate()
  toggle.addEventListener('click', function (e) {
    var btn = e.target.closest('.pt-btn')
    if (!btn || !btn.dataset.mode) return
    // Gate stitch mode behind key
    if (btn.dataset.mode === 'stitch' && !ST.stitchKey) {
      _showStitchModal()
      return
    }
    ST.pipelineMode = btn.dataset.mode
    try { localStorage.setItem('bldr_pipeline', ST.pipelineMode) } catch (x) {}
    _syncToggle()
    var app = ST.activeAppId ? ST.apps.find(function (a) { return a.id === ST.activeAppId }) : null
    _updatePipelineSub(app)
  })
  // Model provider toggle (Claude vs ChatGPT for Website 2)
  var mt = $('model-toggle')
  if (mt) {
    mt.addEventListener('click', function (e) {
      var btn = e.target.closest('.mt-btn')
      if (!btn || !btn.dataset.provider) return
      ST.website2Provider = btn.dataset.provider
      saveKeys()
      _syncToggle()
      var providerLabel = ST.website2Provider === 'chatgpt' ? 'ChatGPT (GPT-4o)' : 'Claude Sonnet'
      toast('Website 2 model: ' + providerLabel)
      if (ST.website2Provider === 'chatgpt' && !ST.gptKey) {
        toast('Add your OpenAI key in Settings to use ChatGPT', 4000)
      }
    })
  }
  _syncToggle()
  // Stitch key modal
  var stitchModalSettings = $('stitch-modal-settings')
  var stitchModalClose = $('stitch-modal-close')
  if (stitchModalSettings) {
    stitchModalSettings.addEventListener('click', function () {
      $('stitch-key-modal').classList.remove('on')
      if (typeof window.openSettings === 'function') window.openSettings()
    })
  }
  if (stitchModalClose) {
    stitchModalClose.addEventListener('click', function () { $('stitch-key-modal').classList.remove('on') })
  }
  var stitchOverlay = $('stitch-key-modal')
  if (stitchOverlay) {
    stitchOverlay.addEventListener('click', function (e) { if (e.target === stitchOverlay) stitchOverlay.classList.remove('on') })
  }
}

function _showStitchModal() {
  var modal = $('stitch-key-modal')
  if (modal) modal.classList.add('on')
}

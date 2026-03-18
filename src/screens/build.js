import { ST } from '../lib/state.js'
import { $, esc, toast, autoResize } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { GRADS } from '../config/constants.js'
import { addMsg, resetChat } from '../components/message.js'
import { renderThoughtSelector } from '../components/thought-card.js'
import { getPreviewPid, getApprovalGates } from '../components/approval-card.js'
import { runPipeline } from '../pipelines/build-pipeline.js'
import { runPipeline2 } from '../pipelines/build-pipeline2.js'
import { runSelfUpdatePipeline } from '../pipelines/builder-plus.js'
import { classifyIntent, callClaudeChat } from '../lib/ai.js'

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
      + '<img src="data:' + _pendingImages[i].mediaType + ';base64,' + _pendingImages[i].base64 + '" alt="' + esc(_pendingImages[i].name) + '">'
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
  // If editing an existing app, skip classification — always run pipeline
  if (existing || images.length) {
    $('app-name-input').value = ''
    _runBuild(text, existing, customName, images)
    return
  }
  // Classify intent before routing
  ST._building = true; $('send-btn').disabled = true
  classifyIntent(text).then(function (intent) {
    ST._building = false; $('send-btn').disabled = false
    if (intent === 'chat') {
      _handleChat(text)
    } else {
      $('app-name-input').value = ''
      _runBuild(text, existing, customName, images)
    }
  })
}

function _runBuild(text, existing, customName, images) {
  if (ST.pipelineMode === 'builder2') {
    runPipeline2(text, existing, customName, images)
  } else {
    runPipeline(text, existing, customName, images)
  }
}

function _handleChat(text) {
  addMsg({ role: 'asst', type: 'typing' })
  callClaudeChat(text).then(function (reply) {
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
}

export function initPipelineToggle() {
  var toggle = $('pipe-toggle')
  if (!toggle) return
  toggle.addEventListener('click', function (e) {
    var btn = e.target.closest('.pt-btn')
    if (!btn || !btn.dataset.mode) return
    ST.pipelineMode = btn.dataset.mode
    try { localStorage.setItem('bldr_pipeline', ST.pipelineMode) } catch (x) {}
    _syncToggle()
    var app = ST.activeAppId ? ST.apps.find(function (a) { return a.id === ST.activeAppId }) : null
    _updatePipelineSub(app)
  })
  _syncToggle()
}

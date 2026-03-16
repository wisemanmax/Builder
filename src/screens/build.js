import { ST } from '../lib/state.js'
import { $, esc, toast, autoResize } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { GRADS } from '../config/constants.js'
import { addMsg, resetChat } from '../components/message.js'
import { renderThoughtSelector } from '../components/thought-card.js'
import { getPreviewPid, getApprovalGates } from '../components/approval-card.js'
import { runPipeline } from '../pipelines/build-pipeline.js'
import { runSelfUpdatePipeline } from '../pipelines/builder-plus.js'

export function openBuilder(editId) {
  var app = editId ? ST.apps.find(function (a) { return a.id === editId }) : null
  if (editId && !app) editId = null
  ST.activeAppId = editId || null
  ST.pendingIcon = app ? app.icon : '\uD83C\uDFAF'
  ST.pendingColor = app ? app.ci : Math.floor(Math.random() * GRADS.length)
  $('emoji-pick-btn').textContent = ST.pendingIcon
  $('bs-title').textContent = app ? 'Editing: ' + app.name : 'Build an App'
  $('bs-sub').textContent = app ? 'Describe changes' : 'Branch \u2192 Build \u2192 Check \u2192 Audit \u2192 Fix \u2192 Preview \u2192 Approve \u2192 Merge'
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
  if (!text || ST._building) return
  if (!ST.key) { toast('Add your Anthropic API key in Settings first', 4000); return }
  inp.value = ''; autoResize(inp)
  addMsg({ role: 'user', text: text })
  if (ST._selfUpdateMode) {
    runSelfUpdatePipeline(text)
    return
  }
  var customName = $('app-name-input').value.trim()
  $('app-name-input').value = ''
  var existing = ST.activeAppId ? ST.apps.find(function (a) { return a.id === ST.activeAppId }) : null
  runPipeline(text, existing, customName)
}

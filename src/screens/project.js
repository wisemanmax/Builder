import { ST, persist } from '../lib/state.js'
import { $, esc, grad, toast, fmtDate, showScreen, copyToClipboard } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { renderGrid } from '../components/app-icon.js'
import { openBuilder } from './build.js'
import { costSummaryHTML } from '../lib/cost.js'
import { generateShareUrl } from '../lib/share.js'

export function openProjectSheet(id) {
  ST.projectAppId = id
  var app = null; for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { app = ST.apps[i]; break } }
  if (!app) return
  var g = grad(app.ci)
  $('psh-icon').textContent = app.icon
  $('psh-icon').style.background = g
  $('psh-name').textContent = app.name
  $('psh-url-line').textContent = app.ghPushed ? ghPageUrl(id) : 'Local only'
  $('proj-url-display').textContent = app.ghPushed ? ghPageUrl(id) : 'Push to GitHub to get a live URL'
  $('proj-status').textContent = app.ghPushed ? '\u2713 Live on GitHub Pages' : 'Saved locally only'
  $('proj-path').textContent = 'apps/' + id + '.html'
  $('proj-created').textContent = fmtDate(app.createdAt)
  $('proj-updated').textContent = fmtDate(app.updatedAt)
  $('proj-builds').textContent = ((app.prompts && app.prompts.length) || 1) + ' build' + ((((app.prompts && app.prompts.length) || 1) !== 1) ? 's' : '')
  var ph = $('prompt-history')
  var prompts = app.prompts || [{ text: app.desc || 'Initial build', ts: app.createdAt, type: 'initial' }]
  var phhtml = ''
  for (var j = prompts.length - 1; j >= 0; j--) {
    var p = prompts[j]
    phhtml += '<div class="ph-item"><div class="ph-meta"><span class="ph-tag">' + (p.type === 'initial' ? '\uD83D\uDD28 Initial Build' : '\u270F\uFE0F Update') + '</span><span class="ph-date">' + fmtDate(p.ts) + '</span></div><div class="ph-text">' + esc(p.text) + '</div></div>'
  }
  ph.innerHTML = phhtml

  // Conversation history
  var ch = $('chat-history')
  var sessions = app.chatHistory || []
  if (!sessions.length) {
    ch.innerHTML = '<div class="ch-empty">No conversation history yet</div>'
  } else {
    var chhtml = ''
    for (var si = 0; si < sessions.length; si++) {
      var sess = sessions[si]
      var sessId = 'ch-sess-' + si
      chhtml += '<div class="ch-session">'
        + '<div class="ch-session-hdr" data-target="' + sessId + '">'
        + '<div class="ch-session-info"><span class="ch-session-prompt">' + esc((sess.prompt || 'Build session').slice(0, 80)) + '</span><span class="ch-session-date">' + fmtDate(sess.ts) + '</span></div>'
        + '<div class="ch-session-toggle">&#x25B6;</div></div>'
        + '<div class="ch-session-body" id="' + sessId + '" style="display:none">'
      var msgs = sess.messages || []
      for (var mi = 0; mi < msgs.length; mi++) {
        var m = msgs[mi]
        var roleClass = m.role === 'user' ? 'ch-user' : m.role === 'system' ? 'ch-sys' : 'ch-asst'
        var icon = m.role === 'user' ? '&#x1F464;' : m.role === 'system' ? '&#x2699;&#xFE0F;' : '&#x26A1;'
        var content = m.html ? m.html : esc(m.text || '')
        if (m.type === 'thinking') {
          content = '<span class="ch-thinking-label">&#x1F9E0; Thought Process</span><pre class="ch-thinking-text">' + esc(m.text || '') + '</pre>'
        }
        chhtml += '<div class="ch-msg ' + roleClass + '"><span class="ch-msg-icon">' + icon + '</span><div class="ch-msg-content">' + content + '</div></div>'
      }
      chhtml += '</div></div>'
    }
    ch.innerHTML = chhtml
    // Attach toggle listeners
    var hdrs = ch.querySelectorAll('.ch-session-hdr')
    for (var hi = 0; hi < hdrs.length; hi++) {
      hdrs[hi].addEventListener('click', function () {
        var body = document.getElementById(this.dataset.target)
        var tog = this.querySelector('.ch-session-toggle')
        if (body.style.display === 'none') { body.style.display = 'block'; tog.innerHTML = '&#x25BC;' }
        else { body.style.display = 'none'; tog.innerHTML = '&#x25B6;' }
      })
    }
  }

  // Build costs section
  var costSection = $('proj-cost-section')
  var costDetails = $('proj-cost-details')
  if (costSection && costDetails) {
    var costs = app.costs || []
    if (costs.length > 0) {
      costSection.style.display = ''
      costDetails.innerHTML = costSummaryHTML(costs)
    } else {
      costSection.style.display = 'none'
      costDetails.innerHTML = ''
    }
  }

  $('project-sheet').classList.add('open')
}

export function closeProject() { $('project-sheet').classList.remove('open'); ST.projectAppId = null }

export function copyUrl() {
  var app = null; var id = ST.projectAppId || ST.activeAppId
  for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { app = ST.apps[i]; break } }
  if (app && app.ghPushed && ghPageUrl(app.id)) {
    copyToClipboard(ghPageUrl(app.id), 'URL')
  } else if (app) {
    // Generate a compressed share link as fallback
    generateShareUrl(app).then(function (url) {
      if (url) copyToClipboard(url, 'Share link')
      else toast('App too large to share via link. Push to GitHub for a live URL.', 4000)
    })
  } else {
    toast('No app found', 3000)
  }
}

export function editCurrentApp() {
  var id = ST.projectAppId || ST.activeAppId
  if (id) { closeProject(); openBuilder(id) }
}

export function delApp(id) {
  if (!confirm('Delete this app locally?')) return
  ST.apps = ST.apps.filter(function (a) { return a.id !== id })
  persist(); renderGrid()
  if (ST.activeAppId === id) ST.activeAppId = null
  if (ST.viewingApp && ST.viewingApp.id === id) {
    ST.viewingApp = null
    if ($('s-viewer').classList.contains('active')) { showScreen('home'); renderGrid() }
  }
  if (ST.projectAppId === id) { ST.projectAppId = null; closeProject() }
  toast('App deleted locally')
}

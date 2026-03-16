import { ST, persist } from '../lib/state.js'
import { $, esc, grad, toast, fmtDate, showScreen, copyToClipboard } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { renderGrid } from '../components/app-icon.js'
import { openBuilder } from './build.js'

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
  $('project-sheet').classList.add('open')
}

export function closeProject() { $('project-sheet').classList.remove('on'); $('project-sheet').classList.remove('open'); ST.projectAppId = null }

export function copyUrl() {
  var app = null; var id = ST.projectAppId || ST.activeAppId
  for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { app = ST.apps[i]; break } }
  if (app && app.ghPushed && ghPageUrl(app.id)) copyToClipboard(ghPageUrl(app.id), 'URL')
  else toast('Push to GitHub first', 3000)
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

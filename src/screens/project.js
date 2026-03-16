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
    var tagLabel = p.type === 'initial' ? '\uD83D\uDD28 Initial Build' : p.type === 'restore' ? '\uD83D\uDD04 Restore' : '\u270F\uFE0F Update'
    phhtml += '<div class="ph-item"><div class="ph-meta"><span class="ph-tag">' + tagLabel + '</span><span class="ph-date">' + fmtDate(p.ts) + '</span></div><div class="ph-text">' + esc(p.text) + '</div></div>'
  }
  ph.innerHTML = phhtml

  // Version history
  var versions = app.versions || []
  var vSec = $('version-section')
  var vList = $('version-list')
  if (versions.length > 0) {
    vSec.style.display = ''
    var vhtml = ''
    for (var vi = 0; vi < versions.length; vi++) {
      var ver = versions[vi]
      var verLabel = 'v' + (versions.length - vi) + ' \u2014 ' + fmtDate(ver.ts)
      var verSize = ver.code ? Math.round(ver.code.length / 1024) + ' KB' : ''
      vhtml += '<div class="ver-item">'
        + '<div class="ver-info"><span class="ver-label">' + esc(verLabel) + '</span><span class="ver-size">' + verSize + '</span></div>'
        + '<button class="ver-restore" data-ver-idx="' + vi + '">Restore</button>'
        + '</div>'
    }
    vList.innerHTML = vhtml
    var restoreBtns = vList.querySelectorAll('.ver-restore')
    for (var ri = 0; ri < restoreBtns.length; ri++) {
      restoreBtns[ri].addEventListener('click', function () {
        var idx = parseInt(this.dataset.verIdx)
        restoreVersion(id, idx)
      })
    }
  } else {
    vSec.style.display = 'none'
  }

  $('project-sheet').classList.add('open')
}

function restoreVersion(appId, versionIndex) {
  if (!confirm('Restore this version? Current code will be saved as a new version entry.')) return
  var app = null
  for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === appId) { app = ST.apps[i]; break } }
  if (!app) return
  var versions = app.versions || []
  if (!versions[versionIndex]) return
  // Save current code as a version before restoring
  app.versions = [{ code: app.code, ts: app.updatedAt }].concat(versions.slice(0, 9))
  // Restore selected version
  app.code = versions[versionIndex].code
  app.updatedAt = new Date().toISOString()
  app.prompts = (app.prompts || []).concat([{ text: 'Restored version from ' + fmtDate(versions[versionIndex].ts), ts: new Date().toISOString(), type: 'restore' }])
  persist()
  toast('Version restored!', 2800)
  openProjectSheet(appId)
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

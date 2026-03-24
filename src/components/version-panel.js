import { ST, persist } from '../lib/state.js'
import { $, esc, toast } from '../lib/utils.js'

/* ---- Lightweight line-based diff ---- */

function diffLines(oldText, newText) {
  var oldLines = (oldText || '').split('\n')
  var newLines = (newText || '').split('\n')
  var result = []
  var oi = 0, ni = 0

  // Simple LCS-based diff using a greedy approach
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ type: 'add', text: newLines[ni] })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ type: 'del', text: oldLines[oi] })
      oi++
    } else if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'same', text: oldLines[oi] })
      oi++
      ni++
    } else {
      // Look ahead to find next matching line
      var foundOld = -1, foundNew = -1
      var maxLook = Math.min(20, Math.max(oldLines.length - oi, newLines.length - ni))
      for (var k = 1; k < maxLook; k++) {
        if (foundNew < 0 && ni + k < newLines.length && oldLines[oi] === newLines[ni + k]) foundNew = k
        if (foundOld < 0 && oi + k < oldLines.length && oldLines[oi + k] === newLines[ni]) foundOld = k
        if (foundOld >= 0 || foundNew >= 0) break
      }
      if (foundOld >= 0 && (foundNew < 0 || foundOld <= foundNew)) {
        for (var d = 0; d < foundOld; d++) {
          result.push({ type: 'del', text: oldLines[oi++] })
        }
      } else if (foundNew >= 0) {
        for (var a = 0; a < foundNew; a++) {
          result.push({ type: 'add', text: newLines[ni++] })
        }
      } else {
        result.push({ type: 'del', text: oldLines[oi++] })
        result.push({ type: 'add', text: newLines[ni++] })
      }
    }
  }
  return result
}

function relativeTime(ts) {
  if (!ts) return 'unknown'
  var diff = Date.now() - new Date(ts).getTime()
  var mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  var hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  var days = Math.floor(hrs / 24)
  if (days < 30) return days + 'd ago'
  return Math.floor(days / 30) + 'mo ago'
}

function codeSize(code) {
  if (!code) return '0 B'
  var bytes = new Blob([code]).size
  if (bytes < 1024) return bytes + ' B'
  return (bytes / 1024).toFixed(1) + ' KB'
}

/* ---- Panel rendering ---- */

export function openVersionPanel() {
  var app = ST.viewingApp
  if (!app) {
    toast('No app selected', 3000)
    return
  }
  var versions = app.versions || []
  if (versions.length === 0) {
    toast('No version history yet', 3000)
    return
  }

  // Remove existing panel if open
  var old = $('version-panel')
  if (old) old.remove()

  var html = '<div id="version-panel" class="version-panel">' +
    '<div class="vp-header">' +
    '<span class="vp-title">\u23F3 Version History</span>' +
    '<button id="vp-close" class="vp-close">\u2715</button>' +
    '</div>' +
    '<div class="vp-current">' +
    '<div class="vp-item-label">Current</div>' +
    '<div class="vp-item-meta">' + codeSize(app.code) + ' \u00B7 ' + relativeTime(app.updatedAt) + '</div>' +
    '</div>' +
    '<div class="vp-list">'

  for (var i = 0; i < versions.length; i++) {
    var v = versions[i]
    html += '<div class="vp-item" data-vi="' + i + '">' +
      '<div class="vp-item-row">' +
      '<div>' +
      '<div class="vp-item-label">v' + (versions.length - i) + '</div>' +
      '<div class="vp-item-meta">' + codeSize(v.code) + ' \u00B7 ' + relativeTime(v.ts) + '</div>' +
      '</div>' +
      '<div class="vp-item-btns">' +
      '<button class="vp-btn vp-diff-btn" data-vi="' + i + '">Diff</button>' +
      '<button class="vp-btn vp-restore-btn" data-vi="' + i + '">Restore</button>' +
      '</div>' +
      '</div>' +
      '</div>'
  }

  html += '</div>' +
    '<div id="vp-diff-view" class="vp-diff-view" style="display:none"></div>' +
    '</div>'

  document.body.insertAdjacentHTML('beforeend', html)

  // Event listeners
  $('vp-close').addEventListener('click', closeVersionPanel)
  $('version-panel').addEventListener('click', function (e) {
    if (e.target.id === 'version-panel') closeVersionPanel()
  })

  var diffBtns = document.querySelectorAll('.vp-diff-btn')
  for (var d = 0; d < diffBtns.length; d++) {
    diffBtns[d].addEventListener('click', function () {
      var idx = parseInt(this.getAttribute('data-vi'), 10)
      showVersionDiff(idx)
    })
  }

  var restoreBtns = document.querySelectorAll('.vp-restore-btn')
  for (var r = 0; r < restoreBtns.length; r++) {
    restoreBtns[r].addEventListener('click', function () {
      var idx = parseInt(this.getAttribute('data-vi'), 10)
      rollbackToVersion(idx)
    })
  }
}

export function closeVersionPanel() {
  var panel = $('version-panel')
  if (panel) panel.remove()
}

function showVersionDiff(versionIndex) {
  var app = ST.viewingApp
  if (!app || !app.versions || !app.versions[versionIndex]) return

  var oldCode = app.versions[versionIndex].code
  var newCode = app.code
  var lines = diffLines(oldCode, newCode)

  // Limit display to first 500 lines to avoid perf issues
  var maxLines = 500
  var truncated = lines.length > maxLines
  var displayLines = truncated ? lines.slice(0, maxLines) : lines

  var stats = { added: 0, removed: 0 }
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].type === 'add') stats.added++
    if (lines[i].type === 'del') stats.removed++
  }

  var html = '<div class="vp-diff-header">' +
    '<span>v' + (app.versions.length - versionIndex) + ' \u2192 Current</span>' +
    '<span class="vp-diff-stats">' +
    '<span style="color:#4caf50">+' + stats.added + '</span> ' +
    '<span style="color:#f44336">-' + stats.removed + '</span>' +
    '</span>' +
    '<button id="vp-diff-close" class="vp-btn">\u2715 Close</button>' +
    '</div>' +
    '<pre class="vp-diff-code">'

  for (var j = 0; j < displayLines.length; j++) {
    var line = displayLines[j]
    var cls = line.type === 'add' ? 'vp-line-add' : line.type === 'del' ? 'vp-line-del' : 'vp-line-same'
    var prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '
    html += '<div class="' + cls + '">' + prefix + ' ' + esc(line.text) + '</div>'
  }

  if (truncated) {
    html += '<div class="vp-line-same" style="color:rgba(255,255,255,.3)">... ' + (lines.length - maxLines) + ' more lines</div>'
  }
  html += '</pre>'

  var diffView = $('vp-diff-view')
  diffView.innerHTML = html
  diffView.style.display = 'block'

  $('vp-diff-close').addEventListener('click', function () {
    diffView.style.display = 'none'
  })
}

function rollbackToVersion(versionIndex) {
  var app = ST.viewingApp
  if (!app || !app.versions || !app.versions[versionIndex]) return

  var idx = -1
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === app.id) { idx = i; break }
  }
  if (idx < 0) return

  // Save current as a version before restoring (non-destructive)
  ST.apps[idx].versions = [{ code: ST.apps[idx].code, ts: ST.apps[idx].updatedAt }].concat(
    (ST.apps[idx].versions || []).slice(0, 9)
  )

  // Restore selected version
  ST.apps[idx].code = app.versions[versionIndex].code
  ST.apps[idx].updatedAt = new Date().toISOString()
  persist()

  // Update viewing state
  ST.viewingApp = ST.apps[idx]

  // Refresh iframe
  var iframe = $('viewer-iframe')
  if (iframe) iframe.srcdoc = ST.apps[idx].code

  closeVersionPanel()
  toast('Restored to v' + (app.versions.length - versionIndex), 3000)
}

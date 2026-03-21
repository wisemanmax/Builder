import { ST } from '../lib/state.js'
import { $, toast, showScreen, copyToClipboard, autoResizeSe } from '../lib/utils.js'
import { ghPageUrl } from '../lib/utils.js'
import { addMsg } from '../components/message.js'
import { setPreviewPid, getPreviewPid, approveAndMerge, requestChanges } from '../components/approval-card.js'
import { renderGrid } from '../components/app-icon.js'
import { openBuilder, closeBuilder } from './build.js'
import { openProjectSheet, closeProject } from './project.js'
import { runPipeline } from '../pipelines/build-pipeline.js'
import { renderShareCard } from '../lib/share.js'

export function openApp(id) {
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === id) {
      app = ST.apps[i]
      break
    }
  }
  if (!app) return
  ST.viewingApp = app
  ST.activeAppId = id
  $('vbar-name').textContent = app.icon + ' ' + app.name
  var url = ghPageUrl(id)
  $('vbar-url').textContent = url || 'Saved locally'
  $('vbar-url').dataset.url = url || ''
  // Show skeleton overlay while iframe loads
  var oldSkel = $('viewer-skel')
  if (oldSkel) oldSkel.remove()
  var skelHtml =
    '<div id="viewer-skel"><div class="skel skel-rect" style="height:18px;width:55%;margin:0 auto 4px"></div><div class="skel skel-rect" style="height:10px;width:35%;margin:0 auto 8px"></div><div class="skel skel-rect" style="height:140px"></div><div style="display:flex;gap:8px"><div class="skel skel-rect" style="height:36px;flex:1"></div><div class="skel skel-rect" style="height:36px;flex:1"></div></div><div class="skel skel-rect" style="height:80px"></div><div class="skel skel-rect" style="height:12px;width:60%"></div><div class="skel skel-rect" style="height:12px;width:40%"></div></div>'
  $('studio-preview').insertAdjacentHTML('beforeend', skelHtml)
  var iframe = $('viewer-iframe')
  iframe.onload = function () {
    var s = $('viewer-skel')
    if (s) {
      s.classList.add('hide')
      setTimeout(function () {
        if (s.parentNode) s.remove()
      }, 350)
    }
  }
  iframe.removeAttribute('src')
  iframe.srcdoc =
    app.code ||
    '<html><body style="background:#111;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>No code found.</p></body></html>'
  $('se-textarea').value = ''
  autoResizeSe($('se-textarea'))
  var liveBtn = $('se-liveurl-btn')
  if (liveBtn) {
    liveBtn.style.display = url ? 'block' : 'none'
    liveBtn.onclick = function () {
      copyToClipboard(url, 'URL')
    }
  }
  setPreviewPid(null)
  $('vbar-approve-row').style.display = 'none'
  $('vbar-btns').style.display = 'flex'
  if (ST._studioFullscreen) studioSetFullscreen(false)
  closeBuilder()
  closeProject()
  showScreen('viewer')
}

export function studioSetFullscreen(full) {
  ST._studioFullscreen = full
  var ed = $('studio-editor'),
    btn = $('vbar-fs-toggle')
  if (full) {
    ed.classList.add('fullscreen-mode')
    if (btn) {
      btn.textContent = '\u229E'
      btn.title = 'Exit full screen'
    }
  } else {
    ed.classList.remove('fullscreen-mode')
    if (btn) {
      btn.textContent = '\u26F6'
      btn.title = 'Full screen preview'
    }
  }
}

export function studioSend() {
  var text = $('se-textarea').value.trim()
  if (!text) return
  if (ST._building) {
    toast('A build is already running', 3000)
    return
  }
  if (!ST.key) {
    toast('Add your Anthropic API key in Settings first', 4000)
    return
  }
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === ST.activeAppId) {
      app = ST.apps[i]
      break
    }
  }
  if (!app) {
    toast('No app selected', 3000)
    return
  }
  $('se-textarea').value = ''
  autoResizeSe($('se-textarea'))
  $('se-send').disabled = true
  $('bs-title').textContent = 'Editing: ' + app.name
  $('bs-sub').textContent = 'Describe changes'
  $('bs-proj-btn').style.display = 'flex'
  ST.pendingIcon = app.icon || '\uD83C\uDFAF'
  ST.pendingColor = app.ci || 0
  $('emoji-pick-btn').textContent = ST.pendingIcon
  $('builder-sheet').classList.add('open')
  setTimeout(function () {
    addMsg({ role: 'user', text: text })
    runPipeline(text, app)
    $('se-send').disabled = false
  }, 80)
}

export function openCurrentInViewer() {
  var id = ST.projectAppId || ST.activeAppId
  if (id) {
    openApp(id)
    closeProject()
  }
}

export function copyViewerUrl() {
  var url = $('vbar-url').dataset.url
  if (url) copyToClipboard(url, 'URL')
  else toast('No live URL yet', 3000)
}

export function openShareCard() {
  var app = ST.viewingApp
  if (!app) {
    toast('No app selected', 3000)
    return
  }
  // Create share modal overlay
  var existing = $('share-overlay')
  if (existing) existing.remove()
  var overlay = document.createElement('div')
  overlay.id = 'share-overlay'
  overlay.className = 'share-overlay'
  overlay.innerHTML =
    '<div class="share-modal"><button id="share-close" class="share-close">\u2715</button><div id="share-card-container"></div></div>'
  document.body.appendChild(overlay)
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) overlay.remove()
  })
  $('share-close').addEventListener('click', function () {
    overlay.remove()
  })
  renderShareCard(app, 'share-card-container')
}

export function initStudio() {
  $('vback').addEventListener('click', function () {
    if (getPreviewPid()) {
      setPreviewPid(null)
      $('vbar-approve-row').style.display = 'none'
      $('vbar-btns').style.display = 'flex'
      renderGrid()
      showScreen('home')
      $('builder-sheet').classList.add('open')
    } else {
      showScreen('home')
      renderGrid()
    }
  })
  $('vbar-approve').addEventListener('click', function () {
    if (!getPreviewPid()) return
    var pid3 = getPreviewPid()
    setPreviewPid(null)
    this.disabled = true
    $('vbar-req-changes').disabled = true
    this.textContent = 'Merging\u2026'
    approveAndMerge(pid3)
    $('vbar-approve-row').style.display = 'none'
    $('vbar-btns').style.display = 'flex'
    $('builder-sheet').classList.add('open')
    showScreen('home')
  })
  $('vbar-req-changes').addEventListener('click', function () {
    if (!getPreviewPid()) return
    var pid4 = getPreviewPid()
    setPreviewPid(null)
    this.disabled = true
    $('vbar-approve').disabled = true
    requestChanges(pid4)
    $('vbar-approve-row').style.display = 'none'
    $('vbar-btns').style.display = 'flex'
    $('builder-sheet').classList.add('open')
    showScreen('home')
  })
  $('vbar-proj').addEventListener('click', function () {
    if (ST.viewingApp) openProjectSheet(ST.viewingApp.id)
  })
  $('vbar-fs-toggle').addEventListener('click', function () {
    studioSetFullscreen(!ST._studioFullscreen)
  })
  // Share button
  var shareBtn = $('vbar-share-btn')
  if (shareBtn) shareBtn.addEventListener('click', openShareCard)

  // Studio editor
  $('se-header-toggle').addEventListener('click', function (e) {
    if (e.target.closest('.se-hbtn')) return
    var ed = $('studio-editor')
    var isCollapsed = ed.classList.toggle('collapsed')
    $('se-collapse-btn').textContent = isCollapsed ? '\u25B2 Show' : '\u25BC Hide'
  })
  $('se-collapse-btn').addEventListener('click', function (e) {
    e.stopPropagation()
    var ed = $('studio-editor')
    var isCollapsed = ed.classList.toggle('collapsed')
    $('se-collapse-btn').textContent = isCollapsed ? '\u25B2 Show' : '\u25BC Hide'
  })
  $('se-proj-btn').addEventListener('click', function () {
    if (ST.viewingApp) openProjectSheet(ST.viewingApp.id)
  })
  var seInp = $('se-textarea')
  seInp.addEventListener('input', function () {
    autoResizeSe(seInp)
  })
  seInp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      studioSend()
    }
  })
  $('se-send').addEventListener('click', studioSend)

  // Drag handle
  ;(function () {
    var handle = $('se-drag'),
      editor = $('studio-editor'),
      body = $('studio-body')
    var startY = 0,
      startH = 0,
      dragging = false
    function onStart(clientY) {
      dragging = true
      startY = clientY
      startH = editor.offsetHeight
      editor.style.transition = 'none'
    }
    function onMove(clientY) {
      if (!dragging) return
      var delta = startY - clientY
      var newH = Math.max(52, Math.min(startH + delta, body.offsetHeight - 80))
      editor.style.height = newH + 'px'
      editor.classList.remove('collapsed')
      $('se-collapse-btn').textContent = '\u25BC Hide'
    }
    function onEnd() {
      if (!dragging) return
      dragging = false
      editor.style.transition = ''
    }
    handle.addEventListener(
      'touchstart',
      function (e) {
        if (e.touches[0]) onStart(e.touches[0].clientY)
      },
      { passive: true }
    )
    handle.addEventListener(
      'touchmove',
      function (e) {
        if (e.touches[0]) {
          onMove(e.touches[0].clientY)
          e.preventDefault()
        }
      },
      { passive: false }
    )
    handle.addEventListener('touchend', onEnd, { passive: true })
    handle.addEventListener('mousedown', function (e) {
      onStart(e.clientY)
    })
    document.addEventListener('mousemove', function (e) {
      if (dragging) onMove(e.clientY)
    })
    document.addEventListener('mouseup', onEnd)
  })()

  // Project sheet close
  $('project-sheet').addEventListener('click', function (e) {
    if (e.target.id === 'project-sheet') closeProject()
  })
}

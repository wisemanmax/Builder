import { ST, hydrate } from './lib/state.js'
import { $, showScreen, autoResize, toast, copyToClipboard } from './lib/utils.js'
import { EMOJIS } from './config/constants.js'

import { renderGrid, handleTap } from './components/app-icon.js'
import { initContextMenu, showCtx, showCtxAt, closeCtx } from './components/context-menu.js'
import { initEmojiPicker, pickEmoji } from './components/emoji-picker.js'
import { openPreview } from './components/approval-card.js'
import { resetChat } from './components/message.js'
import { renderThoughtSelector, detachThought, showThoughtPicker, pickThought } from './components/thought-card.js'

import { initOnboarding } from './screens/login.js'
import { initHome } from './screens/home.js'
import { openBuilder, closeBuilder, openCustomizeBuilder, chipSend, templateSend, sendMsg, handleImageFiles, removeImage, initPipelineToggle, checkInterruptedBuild, recoverInterruptedBuild, dismissRecovery, stopPipeline } from './screens/build.js'
import { openBuildHistory, closeBuildHistory, initBuildHistory } from './screens/build-history.js'
import { openThink, closeThink, sendThinkMsg, thinkOptionSelect, finishThink, refineThink, confirmThinkBrief, editThinkBrief, initThinkSheet } from './screens/think.js'
import { openApp, studioSend, studioSetFullscreen, openCurrentInViewer, copyViewerUrl, initStudio } from './screens/studio.js'
import { openProjectSheet, closeProject, copyUrl, editCurrentApp, delApp } from './screens/project.js'
import { openSettings, initSettings } from './screens/settings.js'
import { openOrgThink, closeOrgThink, sendOrgMsg, orgOptionSelect, finishOrgThink, refineOrgThink, initOrgThinkSheet } from './screens/org-think.js'
import { renderProfileChip, showProfilePicker, initProfilePicker, cycleProfile } from './components/profile-switcher.js'
import { initFeedbackCard } from './components/feedback-card.js'
import { renderProfilesSettings, initProfilesSettings } from './screens/profiles.js'
import { selfUpdateBuilder } from './pipelines/builder-plus.js'
import { pullFromGitHub } from './lib/github.js'
import { pullFromSupabase } from './lib/storage.js'
import { decompressShareData } from './lib/share.js'
import { openShareCard } from './screens/studio.js'

export function init() {
  // Global error guard — suppress only cross-origin/blob errors, log all others
  window.onerror = function (m, s, l, c, err) {
    if (String(m).includes('Script error') || String(s || '').includes('blob:')) return true
    console.error('[Builder] Uncaught error:', m, 'at', s, l + ':' + c, err)
    return false
  }
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason
    var msg = (reason && reason.message) || String(reason || '')
    // Suppress pipeline cancellation (intentional) but log everything else
    if (msg === 'PIPELINE_CANCELLED') { e.preventDefault(); return }
    console.warn('[Builder] Unhandled rejection:', reason)
  })

  // PWA setup
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {}) } catch (e) {}
  }
  var _installPrompt = null
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); _installPrompt = e
    setTimeout(function () { try { if (!localStorage.getItem('pwa_dis')) { var b = document.getElementById('install-banner'); if (b) b.classList.add('on') } } catch (x) {} }, 800)
  })

  // Hydrate state
  hydrate()

  // Re-acquire Wake Lock when user returns to app during a build
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && ST._building && navigator.wakeLock) {
      navigator.wakeLock.request('screen').catch(function () {})
    }
  })

  // Emoji grid
  initEmojiPicker()

  // Handle share URLs (#/share/{compressed-data})
  _handleShareUrl()

  // Initial screen
  if (ST.key) {
    showScreen('home'); renderGrid(); renderProfileChip()
    // Check for interrupted builds after a short delay to let UI settle
    setTimeout(function () {
      var interrupted = checkInterruptedBuild()
      if (interrupted) {
        toast('Recovering interrupted build\u2026', 3000)
        recoverInterruptedBuild(interrupted)
      }
    }, 600)
  }
  else showScreen('onboard')

  // Auto-sync from GitHub on startup if credentials exist but no local apps
  if (ST.key && ST.ghToken && ST.ghUser && ST.ghRepo && ST.apps.length === 0) {
    pullFromGitHub().then(function () { renderGrid() })
  }

  // Init modules
  initOnboarding()
  initHome()
  initThinkSheet()
  initOrgThinkSheet()
  initStudio()
  initSettings()
  initFeedbackCard()
  initProfilePicker()
  initProfilesSettings()
  initContextMenu(openApp, openProjectSheet, openBuilder, delApp)
  initPipelineToggle()
  initBuildHistory()

  // Builder sheet
  $('bs-close').addEventListener('click', closeBuilder)
  $('bs-stop-btn').addEventListener('click', stopPipeline)
  $('builder-sheet').addEventListener('click', function (e) { if (e.target.id === 'builder-sheet') closeBuilder() })
  $('bs-proj-btn').addEventListener('click', function () { if (ST.activeAppId) openProjectSheet(ST.activeAppId) })
  var shY = 0
  $('bs-handle').addEventListener('touchstart', function (e) { if (e.touches[0]) shY = e.touches[0].clientY }, { passive: true })
  $('bs-handle').addEventListener('touchend', function (e) { if (e.changedTouches[0] && e.changedTouches[0].clientY - shY > 55) closeBuilder() }, { passive: true })

  // Input
  var inp = $('chat-input')
  inp.addEventListener('input', function () { autoResize(inp) })
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } })
  $('send-btn').addEventListener('click', sendMsg)

  // Image upload
  $('img-upload-btn').addEventListener('click', function () { $('img-file-input').click() })
  $('img-file-input').addEventListener('change', function () { handleImageFiles(this.files); this.value = '' })
  $('img-preview-row').addEventListener('click', function (e) {
    var rmBtn = e.target.closest('.img-thumb-rm')
    if (rmBtn) removeImage(parseInt(rmBtn.dataset.idx, 10))
  })
  // Drag-and-drop images onto the input area
  var ibox = $('chat-input').closest('.ibox')
  ibox.addEventListener('dragover', function (e) { e.preventDefault(); ibox.style.borderColor = 'rgba(255,60,172,.6)' })
  ibox.addEventListener('dragleave', function () { ibox.style.borderColor = '' })
  ibox.addEventListener('drop', function (e) { e.preventDefault(); ibox.style.borderColor = ''; if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files) })
  // Paste images from clipboard
  inp.addEventListener('paste', function (e) {
    var files = []
    if (e.clipboardData && e.clipboardData.items) {
      for (var i = 0; i < e.clipboardData.items.length; i++) {
        if (e.clipboardData.items[i].type.indexOf('image/') === 0) {
          files.push(e.clipboardData.items[i].getAsFile())
        }
      }
    }
    if (files.length) handleImageFiles(files)
  })

  // PWA install banner
  $('ib-add').addEventListener('click', function () { if (_installPrompt) _installPrompt.prompt(); $('install-banner').classList.remove('on') })
  $('ib-x').addEventListener('click', function () { $('install-banner').classList.remove('on'); localStorage.setItem('pwa_dis', '1') })

  // Keyboard shortcuts for desktop
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // Close modals/sheets in priority order (topmost first)
      var stitchModal = $('stitch-key-modal')
      if (stitchModal && stitchModal.classList.contains('on')) { stitchModal.classList.remove('on'); return }
      var emojiOv = $('emoji-overlay')
      if (emojiOv && emojiOv.classList.contains('on')) { emojiOv.classList.remove('on'); return }
      var feedbackOv = $('feedback-overlay')
      if (feedbackOv && feedbackOv.classList.contains('on')) { feedbackOv.classList.remove('on'); return }
      var settingsOv = $('settings-overlay')
      if (settingsOv && settingsOv.classList.contains('on')) { settingsOv.classList.remove('on'); return }
      var bhOv = $('build-history-overlay')
      if (bhOv && bhOv.classList.contains('on')) { closeBuildHistory(); return }
      var projectSh = $('project-sheet')
      if (projectSh && projectSh.classList.contains('open')) { closeProject(); return }
      var thinkSh = $('think-sheet')
      if (thinkSh && thinkSh.classList.contains('open')) { closeThink(); return }
      var orgThinkSh = $('org-think-sheet')
      if (orgThinkSh && orgThinkSh.classList.contains('open')) { closeOrgThink(); return }
      var builderSh = $('builder-sheet')
      if (builderSh && builderSh.classList.contains('open')) { closeBuilder(); return }
      closeCtx()
    }
  })

  // Expose functions for HTML onclick handlers
  window.openBuilder = openBuilder
  window.openApp = openApp
  window.openThink = openThink
  window.openSettings = openSettings
  window.openProjectSheet = openProjectSheet
  window.openCustomizeBuilder = openCustomizeBuilder
  window.chipSend = chipSend
  window.templateSend = templateSend
  window.sendMsg = sendMsg
  window.closeBuilder = closeBuilder
  window.closeThink = closeThink
  window.closeProject = closeProject
  window.delApp = delApp
  window.handleTap = handleTap
  window.showCtx = showCtx
  window.showCtxAt = showCtxAt
  window.closeCtx = closeCtx
  window.pickEmoji = pickEmoji
  window.detachThought = detachThought
  window.showThoughtPicker = showThoughtPicker
  window.pickThought = pickThought
  window.thinkOptionSelect = thinkOptionSelect
  window.finishThink = finishThink
  window.refineThink = refineThink
  window.confirmThinkBrief = confirmThinkBrief
  window.editThinkBrief = editThinkBrief
  window.sendThinkMsg = sendThinkMsg
  window.studioSend = studioSend
  window.studioSetFullscreen = studioSetFullscreen
  window.openCurrentInViewer = openCurrentInViewer
  window.copyViewerUrl = copyViewerUrl
  window.copyUrl = copyUrl
  window.editCurrentApp = editCurrentApp
  window.openPreview = openPreview
  window.renderGrid = renderGrid
  window.openOrgThink = openOrgThink
  window.closeOrgThink = closeOrgThink
  window.sendOrgMsg = sendOrgMsg
  window.orgOptionSelect = orgOptionSelect
  window.finishOrgThink = finishOrgThink
  window.refineOrgThink = refineOrgThink
  window.showProfilePicker = showProfilePicker
  window.cycleProfile = cycleProfile
  window.selfUpdateBuilder = selfUpdateBuilder
  window.pullFromGitHub = pullFromGitHub
  window.syncFromGitHub = function () {
    var p = pullFromGitHub()
    if (p && p.then) p.then(function () { renderGrid() })
  }
  window.pullFromSupabase = pullFromSupabase
  window.copyToClipboard = copyToClipboard
  window.toast = toast
  window.dismissRecovery = dismissRecovery
  window.stopPipeline = stopPipeline
  window.openBuildHistory = openBuildHistory
  window.closeBuildHistory = closeBuildHistory
  window.openShareCard = openShareCard
}

function _handleShareUrl() {
  var hash = window.location.hash
  if (!hash || hash.indexOf('#/share/') !== 0) return
  var data = hash.substring(8) // Remove '#/share/'
  if (!data) return
  // Clear the hash
  try { history.replaceState(null, '', window.location.pathname) } catch (e) {}
  // Decompress and display
  decompressShareData(data).then(function (html) {
    if (!html) { toast('Could not load shared app', 3000); return }
    // Show in a full-screen viewer
    var viewer = document.createElement('div')
    viewer.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000'
    viewer.innerHTML = '<div style="position:absolute;top:8px;right:12px;z-index:1;display:flex;gap:8px">'
      + '<button id="share-viewer-close" style="padding:6px 14px;border-radius:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;cursor:pointer">\u2715 Close</button>'
      + '</div>'
      + '<iframe style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-forms allow-modals"></iframe>'
    document.body.appendChild(viewer)
    viewer.querySelector('iframe').srcdoc = html
    viewer.querySelector('#share-viewer-close').addEventListener('click', function () { viewer.remove() })
  })
}

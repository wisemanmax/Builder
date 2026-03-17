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
import { openBuilder, closeBuilder, openCustomizeBuilder, chipSend, sendMsg, handleImageFiles, removeImage } from './screens/build.js'
import { openThink, closeThink, sendThinkMsg, thinkOptionSelect, finishThink, refineThink, initThinkSheet } from './screens/think.js'
import { openApp, studioSend, studioSetFullscreen, openCurrentInViewer, copyViewerUrl, initStudio } from './screens/studio.js'
import { openProjectSheet, closeProject, copyUrl, editCurrentApp, delApp } from './screens/project.js'
import { openSettings, initSettings } from './screens/settings.js'
import { selfUpdateBuilder } from './pipelines/builder-plus.js'
import { pullFromGitHub } from './lib/github.js'
import { pullFromSupabase } from './lib/storage.js'

export function init() {
  // Global error guard
  window.onerror = function (m, s) { if (String(m).includes('Script error') || String(s || '').includes('blob:')) return true }
  window.addEventListener('unhandledrejection', function (e) {
    console.warn('Unhandled rejection:', e.reason)
    e.preventDefault()
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

  // Initial screen
  if (ST.key) { showScreen('home'); renderGrid() }
  else showScreen('onboard')

  // Init modules
  initOnboarding()
  initHome()
  initThinkSheet()
  initStudio()
  initSettings()
  initContextMenu(openApp, openProjectSheet, openBuilder, delApp)

  // Builder sheet
  $('bs-close').addEventListener('click', closeBuilder)
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

  // Expose functions for HTML onclick handlers
  window.openBuilder = openBuilder
  window.openApp = openApp
  window.openThink = openThink
  window.openSettings = openSettings
  window.openProjectSheet = openProjectSheet
  window.openCustomizeBuilder = openCustomizeBuilder
  window.chipSend = chipSend
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
  window.sendThinkMsg = sendThinkMsg
  window.studioSend = studioSend
  window.studioSetFullscreen = studioSetFullscreen
  window.openCurrentInViewer = openCurrentInViewer
  window.copyViewerUrl = copyViewerUrl
  window.copyUrl = copyUrl
  window.editCurrentApp = editCurrentApp
  window.openPreview = openPreview
  window.renderGrid = renderGrid
  window.selfUpdateBuilder = selfUpdateBuilder
  window.pullFromGitHub = pullFromGitHub
  window.pullFromSupabase = pullFromSupabase
  window.copyToClipboard = copyToClipboard
  window.toast = toast
}

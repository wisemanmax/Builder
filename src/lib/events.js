/**
 * Events — delegated event listeners and keyboard shortcuts, extracted from app.js
 */
import { ST } from './state.js'
import { $, autoResize } from './utils.js'
import { closeBuilder, sendMsg, handleImageFiles, removeImage, stopPipeline } from '../screens/build.js'
import { closeThink } from '../screens/think.js'
import { closeOrgThink } from '../screens/org-think.js'
import { closeTemplates } from '../screens/templates.js'
import { closeBuildHistory } from '../screens/build-history.js'
import { closeProject } from '../screens/project.js'
import { closeThoughtsFolder } from '../screens/thoughts.js'
import { closeCtx } from '../components/context-menu.js'
import { openProjectSheet } from '../screens/project.js'

export function setupBuilderSheetEvents() {
  $('bs-close').addEventListener('click', closeBuilder)
  $('bs-stop-btn').addEventListener('click', stopPipeline)
  $('builder-sheet').addEventListener('click', function (e) {
    if (e.target.id === 'builder-sheet') closeBuilder()
  })
  $('bs-proj-btn').addEventListener('click', function () {
    if (ST.activeAppId) openProjectSheet(ST.activeAppId)
  })
  var shY = 0
  $('bs-handle').addEventListener(
    'touchstart',
    function (e) {
      if (e.touches[0]) shY = e.touches[0].clientY
    },
    { passive: true }
  )
  $('bs-handle').addEventListener(
    'touchend',
    function (e) {
      if (e.changedTouches[0] && e.changedTouches[0].clientY - shY > 55) closeBuilder()
    },
    { passive: true }
  )
}

export function setupChatInputEvents() {
  var inp = $('chat-input')
  inp.addEventListener('input', function () {
    autoResize(inp)
  })
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMsg()
    }
  })
  $('send-btn').addEventListener('click', sendMsg)
}

export function setupImageEvents() {
  $('img-upload-btn').addEventListener('click', function () {
    $('img-file-input').click()
  })
  $('img-file-input').addEventListener('change', function () {
    handleImageFiles(this.files)
    this.value = ''
  })
  $('img-preview-row').addEventListener('click', function (e) {
    var rmBtn = e.target.closest('.img-thumb-rm')
    if (rmBtn) removeImage(parseInt(rmBtn.dataset.idx, 10))
  })
  var ibox = $('chat-input').closest('.ibox')
  ibox.addEventListener('dragover', function (e) {
    e.preventDefault()
    ibox.style.borderColor = 'rgba(255,60,172,.6)'
  })
  ibox.addEventListener('dragleave', function () {
    ibox.style.borderColor = ''
  })
  ibox.addEventListener('drop', function (e) {
    e.preventDefault()
    ibox.style.borderColor = ''
    if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files)
  })
  var inp = $('chat-input')
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
}

export function setupPwaEvents(pwaRef) {
  $('ib-add').addEventListener('click', function () {
    if (pwaRef.prompt) pwaRef.prompt.prompt()
    $('install-banner').classList.remove('on')
  })
  $('ib-x').addEventListener('click', function () {
    $('install-banner').classList.remove('on')
    localStorage.setItem('pwa_dis', '1')
  })
}

export function setupKeyboardShortcuts() {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var stitchModal = $('stitch-key-modal')
      if (stitchModal && stitchModal.classList.contains('on')) {
        stitchModal.classList.remove('on')
        return
      }
      var emojiOv = $('emoji-overlay')
      if (emojiOv && emojiOv.classList.contains('on')) {
        emojiOv.classList.remove('on')
        return
      }
      var feedbackOv = $('feedback-overlay')
      if (feedbackOv && feedbackOv.classList.contains('on')) {
        feedbackOv.classList.remove('on')
        return
      }
      var thoughtsOv = $('thoughts-overlay')
      if (thoughtsOv && thoughtsOv.classList.contains('on')) {
        closeThoughtsFolder()
        return
      }
      var templateOv = $('template-overlay')
      if (templateOv && templateOv.classList.contains('on')) {
        closeTemplates()
        return
      }
      var settingsOv = $('settings-overlay')
      if (settingsOv && settingsOv.classList.contains('on')) {
        settingsOv.classList.remove('on')
        return
      }
      var bhOv = $('build-history-overlay')
      if (bhOv && bhOv.classList.contains('on')) {
        closeBuildHistory()
        return
      }
      var projectSh = $('project-sheet')
      if (projectSh && projectSh.classList.contains('open')) {
        closeProject()
        return
      }
      var thinkSh = $('think-sheet')
      if (thinkSh && thinkSh.classList.contains('open')) {
        closeThink()
        return
      }
      var orgThinkSh = $('org-think-sheet')
      if (orgThinkSh && orgThinkSh.classList.contains('open')) {
        closeOrgThink()
        return
      }
      var builderSh = $('builder-sheet')
      if (builderSh && builderSh.classList.contains('open')) {
        closeBuilder()
        return
      }
      closeCtx()
    }
  })
}

/**
 * Delegated click handler for data-action attributes in index.html.
 * Replaces inline onclick handlers with a single event listener.
 */
export function setupActionDelegation(actionMap) {
  document.addEventListener('click', function (e) {
    // data-action-self: only fires when click target is the element itself
    var target = e.target
    if (target.dataset && target.dataset.actionSelf) {
      var selfFn = actionMap[target.dataset.actionSelf]
      if (selfFn) selfFn(e)
      return
    }
    // data-action: fires on element or any descendant
    var el = e.target.closest('[data-action]')
    if (!el) return
    var fn = actionMap[el.dataset.action]
    if (fn) fn(e)
  })
}

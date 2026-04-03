import { ST, hydrate } from './lib/state.js'
import { showScreen, toast, copyToClipboard } from './lib/utils.js'
import { setupErrorHandlers, setupPwa } from './lib/bootstrap.js'
import {
  setupBuilderSheetEvents,
  setupChatInputEvents,
  setupImageEvents,
  setupPwaEvents,
  setupKeyboardShortcuts,
  setupActionDelegation,
} from './lib/events.js'

import { renderGrid, handleTap } from './components/app-icon.js'
import { initContextMenu, showCtx, showCtxAt, closeCtx } from './components/context-menu.js'
import { initEmojiPicker, pickEmoji } from './components/emoji-picker.js'
import { openPreview } from './components/approval-card.js'
import { resetChat, initMessageHandlers } from './components/message.js'
import { detachThought, detachThoughtById, showThoughtPicker, pickThought } from './components/thought-card.js'

import { initOnboarding } from './screens/login.js'
import { initHome } from './screens/home.js'
import {
  openBuilder,
  closeBuilder,
  openCustomizeBuilder,
  chipSend,
  templateSend,
  sendMsg,
  initPipelineToggle,
  checkInterruptedBuild,
  recoverInterruptedBuild,
  dismissRecovery,
  resumeBuild,
  stopPipeline,
} from './screens/build.js'
import { openBuildHistory, closeBuildHistory, initBuildHistory } from './screens/build-history.js'
import {
  openThink,
  closeThink,
  sendThinkMsg,
  thinkOptionSelect,
  finishThink,
  refineThink,
  confirmThinkBrief,
  editThinkBrief,
  editThought,
  viewThoughtVersions,
  initThinkSheet,
} from './screens/think.js'
import {
  openApp,
  studioSend,
  studioSetFullscreen,
  openCurrentInViewer,
  copyViewerUrl,
  initStudio,
} from './screens/studio.js'
import { openProjectSheet, closeProject, copyUrl, editCurrentApp, delApp } from './screens/project.js'
import { openSettings, initSettings } from './screens/settings.js'
import { openTemplates, closeTemplates, initTemplateSheet, initTemplateHandlers } from './screens/templates.js'
import {
  openOrgThink,
  closeOrgThink,
  sendOrgMsg,
  orgOptionSelect,
  finishOrgThink,
  refineOrgThink,
  initOrgThinkSheet,
} from './screens/org-think.js'
import { renderProfileChip, showProfilePicker, initProfilePicker, cycleProfile } from './components/profile-switcher.js'
import { initFeedbackCard, initThoughtFeedback } from './components/feedback-card.js'
import { initProfilesSettings } from './screens/profiles.js'
import { openThoughtsFolder, closeThoughtsFolder, initThoughtsFolder, openThoughtDetail } from './screens/thoughts.js'
import { selfUpdateBuilder } from './pipelines/builder-plus.js'
import { pullFromGitHub } from './lib/github.js'
import { pullFromSupabase } from './lib/storage.js'
import { decompressShareData } from './lib/share.js'
import { openShareCard } from './screens/studio.js'
import { initAuth, isLoggedIn } from './lib/auth.js'
import { openAccount, closeAccount, initAccount } from './screens/account.js'

export function init() {
  // Global namespace for dynamic HTML onclick handlers
  window.B = {}

  setupErrorHandlers()
  var pwaRef = setupPwa()
  hydrate()
  initAuth()

  // Re-acquire Wake Lock when user returns to app during a build
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && ST._building && navigator.wakeLock) {
      navigator.wakeLock.request('screen').catch(function () {})
    }
  })

  initEmojiPicker()
  _handleShareUrl()

  // Initial screen
  if (ST.key) {
    showScreen('home')
    renderGrid()
    renderProfileChip()
    setTimeout(function () {
      var interrupted = checkInterruptedBuild()
      if (interrupted) {
        toast('Recovering interrupted build\u2026', 3000)
        recoverInterruptedBuild(interrupted)
      }
    }, 600)
  } else showScreen('onboard')

  // Auto-sync from GitHub on startup if credentials exist but no local apps
  if (ST.key && ST.ghToken && ST.ghUser && ST.ghRepo && ST.apps.length === 0) {
    pullFromGitHub().then(function () {
      renderGrid()
    })
  }

  // Init modules
  initOnboarding()
  initHome()
  initThinkSheet()
  initOrgThinkSheet()
  initStudio()
  initSettings()
  initFeedbackCard()
  initThoughtFeedback()
  initProfilePicker()
  initProfilesSettings()
  initContextMenu(openApp, openProjectSheet, openBuilder, delApp)
  initPipelineToggle()
  initBuildHistory()
  initTemplateSheet()
  initThoughtsFolder()
  initMessageHandlers()
  initTemplateHandlers()
  initAccount()

  // Events
  setupBuilderSheetEvents()
  setupChatInputEvents()
  setupImageEvents()
  setupPwaEvents(pwaRef)
  setupKeyboardShortcuts()

  // Delegated click handler for data-action attributes in index.html
  setupActionDelegation({
    showProfilePicker: showProfilePicker,
    openThink: openThink,
    openBuilder: openBuilder,
    openCustomizeBuilder: openCustomizeBuilder,
    openTemplates: openTemplates,
    openAccount: openAccount,
    openSettings: openSettings,
    copyUrl: copyUrl,
    openCurrentInViewer: openCurrentInViewer,
    editCurrentApp: editCurrentApp,
    closeProject: closeProject,
    copyViewerUrl: copyViewerUrl,
    closeTplSheetPreview: function () {
      if (window.B.closeTplSheetPreview) window.B.closeTplSheetPreview()
    },
    toggleTplSheetPreviewFullscreen: function () {
      if (window.B.toggleTplSheetPreviewFullscreen) window.B.toggleTplSheetPreviewFullscreen()
    },
  })

  // Expose functions for dynamic HTML onclick handlers (B.fnName)
  Object.assign(window.B, {
    openBuilder: openBuilder,
    openApp: openApp,
    openThink: openThink,
    openAccount: openAccount,
    closeAccount: closeAccount,
    openSettings: openSettings,
    openTemplates: openTemplates,
    openProjectSheet: openProjectSheet,
    openCustomizeBuilder: openCustomizeBuilder,
    chipSend: chipSend,
    templateSend: templateSend,
    sendMsg: sendMsg,
    closeBuilder: closeBuilder,
    closeThink: closeThink,
    closeProject: closeProject,
    delApp: delApp,
    handleTap: handleTap,
    showCtx: showCtx,
    showCtxAt: showCtxAt,
    closeCtx: closeCtx,
    pickEmoji: pickEmoji,
    detachThought: detachThought,
    detachThoughtById: detachThoughtById,
    showThoughtPicker: showThoughtPicker,
    pickThought: pickThought,
    thinkOptionSelect: thinkOptionSelect,
    finishThink: finishThink,
    refineThink: refineThink,
    confirmThinkBrief: confirmThinkBrief,
    editThinkBrief: editThinkBrief,
    sendThinkMsg: sendThinkMsg,
    studioSend: studioSend,
    studioSetFullscreen: studioSetFullscreen,
    openCurrentInViewer: openCurrentInViewer,
    copyViewerUrl: copyViewerUrl,
    copyUrl: copyUrl,
    editCurrentApp: editCurrentApp,
    openPreview: openPreview,
    renderGrid: renderGrid,
    openOrgThink: openOrgThink,
    closeOrgThink: closeOrgThink,
    sendOrgMsg: sendOrgMsg,
    orgOptionSelect: orgOptionSelect,
    finishOrgThink: finishOrgThink,
    refineOrgThink: refineOrgThink,
    showProfilePicker: showProfilePicker,
    cycleProfile: cycleProfile,
    selfUpdateBuilder: selfUpdateBuilder,
    pullFromGitHub: pullFromGitHub,
    pullFromSupabase: pullFromSupabase,
    copyToClipboard: copyToClipboard,
    toast: toast,
    dismissRecovery: dismissRecovery,
    resumeBuild: resumeBuild,
    stopPipeline: stopPipeline,
    openBuildHistory: openBuildHistory,
    closeBuildHistory: closeBuildHistory,
    openThoughtsFolder: openThoughtsFolder,
    closeThoughtsFolder: closeThoughtsFolder,
    openThoughtDetail: openThoughtDetail,
    editThoughtFromFolder: function (id) {
      closeThoughtsFolder()
      editThought(id)
    },
    viewThoughtVersionsFromFolder: function (id) {
      closeThoughtsFolder()
      viewThoughtVersions(id)
    },
    openShareCard: openShareCard,
  })
}

function _handleShareUrl() {
  var hash = window.location.hash
  if (!hash || hash.indexOf('#/share/') !== 0) return
  var data = hash.substring(8)
  if (!data) return
  try {
    history.replaceState(null, '', window.location.pathname)
  } catch (e) {}
  decompressShareData(data).then(function (html) {
    if (!html) {
      toast('Could not load shared app', 3000)
      return
    }
    var viewer = document.createElement('div')
    viewer.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000'
    viewer.innerHTML =
      '<div style="position:absolute;top:8px;right:12px;z-index:1;display:flex;gap:8px">' +
      '<button id="share-viewer-close" style="padding:6px 14px;border-radius:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:12px;cursor:pointer">\u2715 Close</button>' +
      '</div>' +
      '<iframe style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-forms allow-modals"></iframe>'
    document.body.appendChild(viewer)
    viewer.querySelector('iframe').srcdoc = html
    viewer.querySelector('#share-viewer-close').addEventListener('click', function () {
      viewer.remove()
    })
  })
}

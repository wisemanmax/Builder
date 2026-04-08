import { ST } from '../lib/state.js'
import { $, toast, showScreen } from '../lib/utils.js'

var _previewCache = {}
var _previewPid = null
var _approvalGates = {}
var _retryGates = {}

export function setPreview(id, code) {
  _previewCache[id] = code
}
export function clearPreview(id) {
  delete _previewCache[id]
}
export function getPreviewPid() {
  return _previewPid
}
export function setPreviewPid(val) {
  _previewPid = val
}

export function openPreview(id, pid) {
  var code = _previewCache[id]
  if (!code) {
    var app = null
    for (var i = 0; i < ST.apps.length; i++) {
      if (ST.apps[i].id === id) {
        app = ST.apps[i]
        break
      }
    }
    if (app) code = app.code
  }
  if (!code) {
    toast('Preview not available', 2000)
    return
  }
  _previewPid = pid || null
  var approveBtn = $('vbar-approve'),
    changesBtn = $('vbar-req-changes')
  if (approveBtn) {
    approveBtn.disabled = false
    approveBtn.textContent = '\uD83D\uDD00 Approve & Merge'
  }
  if (changesBtn) {
    changesBtn.disabled = false
  }
  $('vbar-name').textContent = '\uD83D\uDD0D Preview \u2014 Reviewing'
  $('vbar-url').textContent = 'Not merged yet \u2014 reviewing'
  $('vbar-url').dataset.url = ''
  $('viewer-iframe').removeAttribute('src')
  $('viewer-iframe').srcdoc = code
  var approveRow = $('vbar-approve-row'),
    normalBtns = $('vbar-btns')
  if (_previewPid) {
    approveRow.style.display = 'flex'
    normalBtns.style.display = 'none'
  } else {
    approveRow.style.display = 'none'
    normalBtns.style.display = 'flex'
  }
  showScreen('viewer')
}

export function waitForApproval(pid) {
  return new Promise(function (resolve, reject) {
    _approvalGates[pid] = { resolve: resolve, reject: reject }
  })
}

export function approveAndMerge(pid) {
  // Defensive guard: if a hard-fail approval card is live for this pid, the DOM
  // button is already data-blocked. This catches callers that bypass the card.
  var hardFail = document.querySelector('.appr-btn.approve[data-pid="' + pid + '"][data-blocked="1"]')
  if (hardFail) {
    toast('Resolve audit violations before merging', 2500)
    return
  }
  _previewPid = null
  if (_approvalGates[pid]) _approvalGates[pid].resolve('approved')
  delete _approvalGates[pid]
}

export function requestChanges(pid) {
  _previewPid = null
  if (_approvalGates[pid]) _approvalGates[pid].reject(new Error('CHANGES_REQUESTED'))
  delete _approvalGates[pid]
}

export function getApprovalGates() {
  return _approvalGates
}

// Blueprint approval gates — pause after Stitch scaffold to let user preview before Claude hydration
var _blueprintGates = {}

export function waitForBlueprintApproval(pid) {
  return new Promise(function (resolve, reject) {
    _blueprintGates[pid] = { resolve: resolve, reject: reject }
  })
}

export function approveBlueprintContinue(pid) {
  if (_blueprintGates[pid]) _blueprintGates[pid].resolve('approved')
  delete _blueprintGates[pid]
}

export function rejectBlueprint(pid) {
  if (_blueprintGates[pid]) _blueprintGates[pid].reject(new Error('BLUEPRINT_REJECTED'))
  delete _blueprintGates[pid]
}

export function waitForRetryDecision(pid) {
  return new Promise(function (resolve) {
    _retryGates[pid] = { resolve: resolve }
  })
}

export function resolveRetry(pid, doRetry) {
  if (_retryGates[pid]) _retryGates[pid].resolve(doRetry)
  delete _retryGates[pid]
}

// Checkpoint gates — pause pipeline after first audit to let user decide
var _checkpointGates = {}

export function waitForCheckpoint(pid) {
  return new Promise(function (resolve) {
    _checkpointGates[pid] = { resolve: resolve }
  })
}

// decision: 'fix' | 'skip' | 'stop'
export function resolveCheckpoint(pid, decision) {
  if (_checkpointGates[pid]) _checkpointGates[pid].resolve(decision)
  delete _checkpointGates[pid]
}

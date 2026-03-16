import { ST } from '../lib/state.js'
import { $, toast, showScreen } from '../lib/utils.js'

var _previewCache = {}
var _previewPid = null
var _approvalGates = {}

export function setPreview(id, code) { _previewCache[id] = code }
export function clearPreview(id) { delete _previewCache[id] }
export function getPreviewPid() { return _previewPid }
export function setPreviewPid(val) { _previewPid = val }

export function openPreview(id, pid) {
  var code = _previewCache[id]
  if (!code) {
    var app = null
    for (var i = 0; i < ST.apps.length; i++) { if (ST.apps[i].id === id) { app = ST.apps[i]; break } }
    if (app) code = app.code
  }
  if (!code) { toast('Preview not available', 2000); return }
  _previewPid = pid || null
  var approveBtn = $('vbar-approve'), changesBtn = $('vbar-req-changes')
  if (approveBtn) { approveBtn.disabled = false; approveBtn.textContent = '\uD83D\uDD00 Approve & Merge' }
  if (changesBtn) { changesBtn.disabled = false }
  $('vbar-name').textContent = '\uD83D\uDD0D Preview \u2014 Reviewing'
  $('vbar-url').textContent = 'Not merged yet \u2014 reviewing'
  $('vbar-url').dataset.url = ''
  $('viewer-iframe').removeAttribute('src')
  $('viewer-iframe').srcdoc = code
  var approveRow = $('vbar-approve-row'), normalBtns = $('vbar-btns')
  if (_previewPid) { approveRow.style.display = 'flex'; normalBtns.style.display = 'none' }
  else { approveRow.style.display = 'none'; normalBtns.style.display = 'flex' }
  showScreen('viewer')
}

export function waitForApproval(pid) {
  return new Promise(function (resolve, reject) { _approvalGates[pid] = { resolve: resolve, reject: reject } })
}

export function approveAndMerge(pid) {
  _previewPid = null
  if (_approvalGates[pid]) _approvalGates[pid].resolve('approved')
  delete _approvalGates[pid]
}

export function requestChanges(pid) {
  _previewPid = null
  if (_approvalGates[pid]) _approvalGates[pid].reject(new Error('CHANGES_REQUESTED'))
  delete _approvalGates[pid]
}

export function getApprovalGates() { return _approvalGates }

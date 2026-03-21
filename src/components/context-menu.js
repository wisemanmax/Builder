import { $ } from '../lib/utils.js'

var _ctxId = null

export function getCtxId() {
  return _ctxId
}

export function showCtxAt(x, y, id) {
  _ctxId = id
  var m = $('ctx-menu')
  m.classList.add('on')
  var mw = m.offsetWidth || 178,
    mh = m.offsetHeight || 140
  m.style.left = Math.min(x, window.innerWidth - mw - 10) + 'px'
  m.style.top = Math.min(y, window.innerHeight - mh - 10) + 'px'
}

export function showCtx(e, id) {
  showCtxAt(e.clientX || 0, e.clientY || 0, id)
}

export function closeCtx() {
  $('ctx-menu').classList.remove('on')
  _ctxId = null
}

export function initContextMenu(openApp, openProjectSheet, openBuilder, delApp) {
  $('ctx-open').addEventListener('click', function () {
    if (_ctxId) openApp(_ctxId)
    closeCtx()
  })
  $('ctx-proj').addEventListener('click', function () {
    if (_ctxId) openProjectSheet(_ctxId)
    closeCtx()
  })
  $('ctx-history').addEventListener('click', function () {
    if (_ctxId && window.openBuildHistory) window.openBuildHistory(_ctxId)
    closeCtx()
  })
  $('ctx-edit').addEventListener('click', function () {
    if (_ctxId) openBuilder(_ctxId)
    closeCtx()
  })
  $('ctx-del').addEventListener('click', function () {
    if (_ctxId) delApp(_ctxId)
    closeCtx()
  })
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#ctx-menu')) closeCtx()
  })
}

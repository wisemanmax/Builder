import { ST } from '../lib/state.js'
import { $, esc, grad } from '../lib/utils.js'
import { showCtxAt, closeCtx } from './context-menu.js'

export function renderGrid() {
  var grid = $('app-grid')
  var html = ''
  if (!ST.apps.length) {
    html += '<div class="aicon new-tile" onclick="openBuilder()"><div class="aicon-img">\u2726</div><div class="aicon-label">Build App</div></div>'
      + '<div class="home-empty" style="grid-column:1/-1;margin-top:12px">'
      + '<div class="he-icon">\uD83D\uDE80</div>'
      + '<div class="he-title">Canvas is empty</div>'
      + '<div class="he-sub">Tap Build and describe your first app</div></div>'
  } else {
    for (var i = 0; i < ST.apps.length; i++) {
      var app = ST.apps[i]
      var g = grad(app.ci)
      html += '<div class="aicon" style="animation-delay:' + i * .04 + 's" data-id="' + app.id + '" onclick="handleTap(\'' + app.id + '\')" oncontextmenu="showCtx(event,\'' + app.id + '\');return false">'
        + '<div class="aicon-img" style="background:' + g + '">' + app.icon + '</div>'
        + '<button class="aicon-del" onclick="delApp(\'' + app.id + '\');event.stopPropagation()">\u2715</button>'
        + '<div class="aicon-label">' + esc(app.name) + '</div></div>'
    }
    html += '<div class="aicon new-tile" onclick="openBuilder()"><div class="aicon-img">\u2726</div><div class="aicon-label">New App</div></div>'
  }
  grid.innerHTML = html

  // Long press
  var icons = grid.querySelectorAll('.aicon[data-id]')
  for (var j = 0; j < icons.length; j++) {
    (function (el) {
      var t
      el.addEventListener('touchstart', function (e) {
        var touch = e.touches[0]; if (!touch) return
        var cx = touch.clientX, cy = touch.clientY
        t = setTimeout(function () { showCtxAt(cx, cy, el.dataset.id); if (navigator.vibrate) navigator.vibrate(28) }, 520)
      }, { passive: true })
      el.addEventListener('touchend', function () { clearTimeout(t) }, { passive: true })
      el.addEventListener('touchmove', function () { clearTimeout(t) }, { passive: true })
    })(icons[j])
  }
}

export function handleTap(id) { closeCtx(); window.openApp(id) }

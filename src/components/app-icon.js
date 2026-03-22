import { ST } from '../lib/state.js'
import { $, esc, grad, fmtDate } from '../lib/utils.js'
import { showCtxAt, closeCtx } from './context-menu.js'

var _hoverTimer = null
var _activeTooltip = null

function _clearTooltip() {
  clearTimeout(_hoverTimer)
  if (_activeTooltip) {
    _activeTooltip.remove()
    _activeTooltip = null
  }
}

function _showTooltip(el, appId) {
  _clearTooltip()
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === appId) {
      app = ST.apps[i]
      break
    }
  }
  if (!app) return

  var buildCount = (app.prompts && app.prompts.length) || 1
  var lastBuild = app.updatedAt ? fmtDate(app.updatedAt) : 'Unknown'
  var totalCost = ''
  if (app.costs && app.costs.length) {
    var sum = 0
    for (var c = 0; c < app.costs.length; c++) sum += app.costs[c].userPrice || app.costs[c].rawCost || 0
    totalCost = '$' + sum.toFixed(4)
  }

  var tip = document.createElement('div')
  tip.className = 'aicon-tooltip'
  tip.innerHTML =
    '<div class="att-name">' +
    esc(app.name) +
    '</div>' +
    '<div class="att-row"><span>Builds</span><span>' +
    buildCount +
    '</span></div>' +
    '<div class="att-row"><span>Last updated</span><span>' +
    esc(lastBuild) +
    '</span></div>' +
    (totalCost ? '<div class="att-row"><span>Total cost</span><span>' + totalCost + '</span></div>' : '') +
    '<div class="att-view">View full build history</div>'

  tip.addEventListener('click', function (e) {
    e.stopPropagation()
    _clearTooltip()
    if (window.openBuildHistory) window.openBuildHistory(appId)
  })

  el.style.position = 'relative'
  el.appendChild(tip)
  _activeTooltip = tip
}

export function renderGrid() {
  var grid = $('app-grid')
  var html = ''
  if (!ST.apps.length) {
    html +=
      '<div class="aicon new-tile" onclick="B.openBuilder()"><div class="aicon-img">\u2726</div><div class="aicon-label">Build App</div></div>' +
      '<div class="home-empty" style="grid-column:1/-1;margin-top:12px">' +
      '<div class="he-icon">\uD83D\uDE80</div>' +
      '<div class="he-title">Canvas is empty</div>' +
      '<div class="he-sub">Tap Build and describe your first app</div></div>'
  } else {
    for (var i = 0; i < ST.apps.length; i++) {
      var app = ST.apps[i]
      var g = grad(app.ci)
      var hasLinkedThought = false
      for (var ti = 0; ti < ST.thoughts.length; ti++) {
        if (ST.thoughts[ti].linkedAppId === app.id) {
          hasLinkedThought = true
          break
        }
      }
      html +=
        '<div class="aicon" style="animation-delay:' +
        i * 0.04 +
        's" data-id="' +
        app.id +
        '" onclick="B.handleTap(\'' +
        app.id +
        '\')" oncontextmenu="B.showCtx(event,\'' +
        app.id +
        '\');return false">' +
        '<div class="aicon-img" style="background:' +
        g +
        '">' +
        app.icon +
        (hasLinkedThought ? '<span class="aicon-thought-badge">\uD83D\uDCAD</span>' : '') +
        '</div>' +
        '<button class="aicon-del" onclick="B.delApp(\'' +
        app.id +
        '\');event.stopPropagation()">\u2715</button>' +
        '<div class="aicon-label">' +
        esc(app.name) +
        '</div></div>'
    }
    if (ST.thoughts.length > 0) {
      html +=
        '<div class="aicon tf-tile" onclick="B.openThoughtsFolder()">' +
        '<div class="aicon-img" style="background:var(--g4)">\uD83D\uDCAD</div>' +
        '<div class="aicon-label">Thoughts</div></div>'
    }
    html +=
      '<div class="aicon new-tile" onclick="B.openBuilder()"><div class="aicon-img">\u2726</div><div class="aicon-label">New App</div></div>'
  }
  grid.innerHTML = html

  // Long press + hover
  var icons = grid.querySelectorAll('.aicon[data-id]')
  for (var j = 0; j < icons.length; j++) {
    ;(function (el) {
      var t
      el.addEventListener(
        'touchstart',
        function (e) {
          var touch = e.touches[0]
          if (!touch) return
          var cx = touch.clientX,
            cy = touch.clientY
          t = setTimeout(function () {
            showCtxAt(cx, cy, el.dataset.id)
            if (navigator.vibrate) navigator.vibrate(28)
          }, 520)
        },
        { passive: true }
      )
      el.addEventListener(
        'touchend',
        function () {
          clearTimeout(t)
        },
        { passive: true }
      )
      el.addEventListener(
        'touchmove',
        function () {
          clearTimeout(t)
        },
        { passive: true }
      )
      // Desktop hover tooltip
      el.addEventListener('mouseenter', function () {
        _hoverTimer = setTimeout(function () {
          _showTooltip(el, el.dataset.id)
        }, 600)
      })
      el.addEventListener('mouseleave', function () {
        _clearTooltip()
      })
    })(icons[j])
  }
}

export function renderGridSkeleton(count) {
  var grid = $('app-grid')
  var html = ''
  for (var i = 0; i < (count || 4); i++) {
    html +=
      '<div class="aicon skel-aicon" style="animation-delay:' +
      i * 0.04 +
      's"><div class="skel" style="width:66px;height:66px;border-radius:17px"></div><div class="skel skel-line" style="width:42px;height:8px;margin-top:2px"></div></div>'
  }
  grid.innerHTML = html
}

export function handleTap(id) {
  closeCtx()
  window.openApp(id)
}

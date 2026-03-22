// Interactive Market Map — SVG Scatter Plot
import { getCompetitors, getMapDimensions } from '../lib/mie-data.js'

var currentDim = 0
var _competitors = null
var _mapDimensions = null

var _signal = null

export function renderMarketMap(container, signal) {
  _signal = signal
  _competitors = getCompetitors()
  _mapDimensions = getMapDimensions()
  var dim = _mapDimensions[currentDim]

  var html = '<div class="mie-axis-controls">'
  html += '<label style="font-size:12px;color:var(--mie-text-secondary);margin-right:4px">Map View:</label>'
  html += '<select class="mie-axis-select" id="mie-map-dim">'
  for (var i = 0; i < _mapDimensions.length; i++) {
    html +=
      '<option value="' + i + '"' + (i === currentDim ? ' selected' : '') + '>' + _mapDimensions[i].label + '</option>'
  }
  html += '</select></div>'

  html += '<div class="mie-card">'
  html += '<div class="mie-scatter-wrap" id="mie-scatter-wrap">'
  html += buildSVG(dim)
  html += '<div class="mie-scatter-tooltip" id="mie-scatter-tooltip"></div>'
  html += '</div></div>'

  // Legend
  html += '<div class="mie-card" style="margin-top:16px">'
  html += '<div class="mie-card-title">Market Position Legend</div>'
  html += '<div style="display:flex;flex-wrap:wrap;gap:14px">'
  for (var j = 0; j < _competitors.length; j++) {
    var c = _competitors[j]
    html += '<div style="display:flex;align-items:center;gap:6px;font-size:12px">'
    html += '<span class="mie-comp-dot" style="background:' + c.color + '"></span>'
    html += '<span' + (c.isSelf ? ' style="color:var(--mie-accent);font-weight:600"' : '') + '>' + c.name + '</span>'
    html +=
      '<span style="font-family:var(--fm);font-size:11px;color:var(--mie-text-muted)">(' +
      c.scores[dim.xKey] +
      ', ' +
      c.scores[dim.yKey] +
      ')</span>'
    html += '</div>'
  }
  html += '</div>'

  // Whitespace note
  html +=
    '<div style="margin-top:12px;padding:10px 14px;background:rgba(170,255,0,0.05);border:1px solid rgba(170,255,0,0.15);border-radius:8px;font-size:12px;color:rgba(170,255,0,0.7)">'
  html += '<strong>Whitespace Zone:</strong> High ' + dim.xLabel + ' (65+) + High ' + dim.yLabel + ' (65+) quadrant. '
  html += 'GradBridge is targeting this unoccupied strategic position.'
  html += '</div>'
  html += '</div>'

  container.innerHTML = html

  // Dropdown change
  document.getElementById('mie-map-dim').addEventListener(
    'change',
    function () {
      currentDim = parseInt(this.value, 10)
      renderMarketMap(container, _signal)
    },
    { signal: signal }
  )

  // Tooltip interactions
  setupTooltips()
}

function buildSVG(dim) {
  var isMobile = window.matchMedia('(max-width: 768px)').matches
  var pad = isMobile ? { top: 20, right: 20, bottom: 40, left: 45 } : { top: 30, right: 30, bottom: 50, left: 60 }
  var vw = 700,
    vh = 440
  var plotW = vw - pad.left - pad.right
  var plotH = vh - pad.top - pad.bottom

  var svg = '<svg class="mie-scatter-svg" viewBox="0 0 ' + vw + ' ' + vh + '" preserveAspectRatio="xMidYMid meet">'

  // Background
  svg += '<rect width="' + vw + '" height="' + vh + '" fill="rgba(8,8,18,0.5)" rx="12"/>'

  // Whitespace zone (top-right quadrant: x>=65, y>=65)
  var wsX = pad.left + (65 / 100) * plotW
  var wsY = pad.top
  var wsW = pad.left + plotW - wsX
  var wsH = ((100 - 65) / 100) * plotH
  svg +=
    '<rect x="' +
    wsX +
    '" y="' +
    wsY +
    '" width="' +
    wsW +
    '" height="' +
    wsH +
    '" fill="rgba(170,255,0,0.04)" stroke="rgba(170,255,0,0.15)" stroke-dasharray="6,4" rx="4"/>'
  svg +=
    '<text x="' +
    (wsX + wsW / 2) +
    '" y="' +
    (wsY + 18) +
    '" text-anchor="middle" fill="rgba(170,255,0,0.3)" font-size="10" font-family="var(--fh)" font-weight="700">WHITESPACE</text>'

  // Grid lines
  for (var g = 0; g <= 100; g += 25) {
    var gx = pad.left + (g / 100) * plotW
    var gy = pad.top + ((100 - g) / 100) * plotH
    svg +=
      '<line x1="' +
      gx +
      '" y1="' +
      pad.top +
      '" x2="' +
      gx +
      '" y2="' +
      (pad.top + plotH) +
      '" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>'
    svg +=
      '<line x1="' +
      pad.left +
      '" y1="' +
      gy +
      '" x2="' +
      (pad.left + plotW) +
      '" y2="' +
      gy +
      '" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>'
    // X labels
    svg +=
      '<text x="' +
      gx +
      '" y="' +
      (vh - 14) +
      '" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-size="10" font-family="var(--fm)">' +
      g +
      '</text>'
    // Y labels
    svg +=
      '<text x="' +
      (pad.left - 10) +
      '" y="' +
      (gy + 4) +
      '" text-anchor="end" fill="rgba(255,255,255,0.25)" font-size="10" font-family="var(--fm)">' +
      g +
      '</text>'
  }

  // Axes
  svg +=
    '<line x1="' +
    pad.left +
    '" y1="' +
    (pad.top + plotH) +
    '" x2="' +
    (pad.left + plotW) +
    '" y2="' +
    (pad.top + plotH) +
    '" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>'
  svg +=
    '<line x1="' +
    pad.left +
    '" y1="' +
    pad.top +
    '" x2="' +
    pad.left +
    '" y2="' +
    (pad.top + plotH) +
    '" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>'

  // Axis labels
  svg +=
    '<text x="' +
    (pad.left + plotW / 2) +
    '" y="' +
    (vh - 2) +
    '" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="11" font-family="var(--fh)" font-weight="600">' +
    dim.xLabel +
    '</text>'
  svg +=
    '<text x="14" y="' +
    (pad.top + plotH / 2) +
    '" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="11" font-family="var(--fh)" font-weight="600" transform="rotate(-90,14,' +
    (pad.top + plotH / 2) +
    ')">' +
    dim.yLabel +
    '</text>'

  // Lender bubbles
  for (var i = 0; i < _competitors.length; i++) {
    var c = _competitors[i]
    var cx = pad.left + (c.scores[dim.xKey] / 100) * plotW
    var cy = pad.top + ((100 - c.scores[dim.yKey]) / 100) * plotH
    var r = 10 + (c.marketShareProxy / 100) * 16 // radius 10-26

    if (c.isSelf) {
      // GradBridge: gradient fill, glow
      svg +=
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="' +
        (r + 6) +
        '" fill="none" stroke="rgba(255,60,172,0.2)" stroke-width="2" stroke-dasharray="4,3"/>'
      svg +=
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="' +
        r +
        '" fill="' +
        c.color +
        '" opacity="0.85" data-id="' +
        c.id +
        '" class="mie-bubble" style="cursor:pointer;filter:drop-shadow(0 0 8px rgba(255,60,172,0.4))"/>'
    } else {
      svg +=
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="' +
        r +
        '" fill="' +
        c.color +
        '" opacity="0.7" data-id="' +
        c.id +
        '" class="mie-bubble" style="cursor:pointer"/>'
    }

    // Label
    var labelY = cy - r - 6
    if (labelY < pad.top + 10) labelY = cy + r + 14
    svg +=
      '<text x="' +
      cx +
      '" y="' +
      labelY +
      '" text-anchor="middle" fill="' +
      (c.isSelf ? '#FF3CAC' : 'rgba(255,255,255,0.6)') +
      '" font-size="10" font-family="var(--fh)" font-weight="' +
      (c.isSelf ? '800' : '600') +
      '">' +
      c.name +
      '</text>'
  }

  svg += '</svg>'
  return svg
}

function setupTooltips() {
  var wrap = document.getElementById('mie-scatter-wrap')
  var tooltip = document.getElementById('mie-scatter-tooltip')
  if (!wrap || !tooltip) return
  var signal = _signal

  function showTooltip(id, x, y) {
    var c = _competitors.find(function (comp) {
      return comp.id === id
    })
    if (!c) return
    var dim = _mapDimensions[currentDim]
    tooltip.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px;color:' +
      c.color +
      '">' +
      c.name +
      '</div>' +
      '<div style="color:rgba(255,255,255,0.5);font-size:11px">' +
      dim.xLabel +
      ': <strong style="color:#fff">' +
      c.scores[dim.xKey] +
      '</strong></div>' +
      '<div style="color:rgba(255,255,255,0.5);font-size:11px">' +
      dim.yLabel +
      ': <strong style="color:#fff">' +
      c.scores[dim.yKey] +
      '</strong></div>' +
      '<div style="color:rgba(255,255,255,0.5);font-size:11px">Composite: <strong style="color:#fff">' +
      c.scores.composite +
      '</strong></div>'
    tooltip.classList.add('show')

    var rect = wrap.getBoundingClientRect()
    tooltip.style.left = x - rect.left + 14 + 'px'
    tooltip.style.top = y - rect.top - 60 + 'px'
  }

  var bubbles = wrap.querySelectorAll('.mie-bubble')
  for (var i = 0; i < bubbles.length; i++) {
    // Mouse events
    bubbles[i].addEventListener(
      'mouseenter',
      function (e) {
        showTooltip(this.dataset.id, e.clientX, e.clientY)
      },
      { signal: signal }
    )
    bubbles[i].addEventListener(
      'mouseleave',
      function () {
        tooltip.classList.remove('show')
      },
      { signal: signal }
    )

    // Touch events
    bubbles[i].addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault()
        var touch = e.touches[0]
        showTooltip(this.dataset.id, touch.clientX, touch.clientY)
      },
      { signal: signal, passive: false }
    )
  }

  // Dismiss tooltip on touch outside bubbles
  wrap.addEventListener(
    'touchend',
    function () {
      tooltip.classList.remove('show')
    },
    { signal: signal }
  )
}

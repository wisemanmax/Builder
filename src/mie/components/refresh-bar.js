// Refresh bar component for MIE
import { hasApiKey, getApiKey, getCacheTimestamp } from '../lib/mie-data.js'
import { refreshAll, refreshSection } from '../lib/mie-ai.js'

var SECTIONS = [
  { id: 'competitors', label: 'Competitors' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'segments', label: 'Segments' },
  { id: 'alerts', label: 'Alerts' },
]

export function renderRefreshBar(container, onRefreshDone, signal) {
  if (!container) return

  var hasKey = hasApiKey()
  var ts = getCacheTimestamp()

  var html = '<div class="mie-refresh-bar">'

  if (!hasKey) {
    html += '<div class="mie-refresh-msg">'
    html += '<span class="mie-refresh-icon">&#x1F511;</span>'
    html += '<span>Set OpenAI key in Builder to enable live data</span>'
    html += '</div>'
  } else {
    html += '<div class="mie-refresh-controls">'
    html += '<button class="mie-refresh-btn" id="mie-refresh-all">'
    html += '<span class="mie-refresh-icon">&#x21BB;</span> Refresh Intelligence'
    html += '</button>'

    // Per-section dropdown
    html += '<div class="mie-refresh-dropdown-wrap">'
    html += '<button class="mie-refresh-section-btn" id="mie-refresh-section-toggle">&#x25BE;</button>'
    html += '<div class="mie-refresh-dropdown" id="mie-refresh-dropdown">'
    for (var i = 0; i < SECTIONS.length; i++) {
      html +=
        '<button class="mie-refresh-dropdown-item" data-section="' +
        SECTIONS[i].id +
        '">Refresh ' +
        SECTIONS[i].label +
        '</button>'
    }
    html += '</div></div>'

    if (ts) {
      var d = new Date(ts)
      var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      var dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      html += '<span class="mie-refresh-ts" id="mie-refresh-ts">Last refreshed: ' + dateStr + ' ' + timeStr + '</span>'
    }
    html += '</div>'
  }

  html += '<div class="mie-refresh-status" id="mie-refresh-status" style="display:none"></div>'
  html += '</div>'

  container.innerHTML = html

  if (!hasKey) return

  var opts = signal ? { signal: signal } : undefined

  // Refresh all button
  var refreshAllBtn = document.getElementById('mie-refresh-all')
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener(
      'click',
      function () {
        doRefresh(container, null, onRefreshDone)
      },
      opts
    )
  }

  // Section dropdown toggle
  var toggleBtn = document.getElementById('mie-refresh-section-toggle')
  var dropdown = document.getElementById('mie-refresh-dropdown')
  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener(
      'click',
      function (e) {
        e.stopPropagation()
        dropdown.classList.toggle('open')
      },
      opts
    )
    document.addEventListener(
      'click',
      function () {
        dropdown.classList.remove('open')
      },
      opts
    )
  }

  // Section refresh buttons
  var sectionBtns = container.querySelectorAll('.mie-refresh-dropdown-item')
  for (var j = 0; j < sectionBtns.length; j++) {
    sectionBtns[j].addEventListener(
      'click',
      function () {
        var section = this.dataset.section
        dropdown.classList.remove('open')
        doRefresh(container, section, onRefreshDone)
      },
      opts
    )
  }
}

function doRefresh(barContainer, section, onDone) {
  var status = document.getElementById('mie-refresh-status')
  var refreshBtn = document.getElementById('mie-refresh-all')
  if (!status) return

  var key = getApiKey()

  // Show loading
  status.style.display = ''
  status.className = 'mie-refresh-status loading'
  status.innerHTML =
    '<span class="mie-spinner"></span> ' +
    (section ? 'Refreshing ' + section + '...' : 'Refreshing all intelligence data...')
  if (refreshBtn) refreshBtn.disabled = true

  var promise = section ? refreshSection(key, section) : refreshAll(key)

  promise
    .then(function () {
      status.className = 'mie-refresh-status success'
      status.innerHTML =
        '&#x2713; ' + (section ? section.charAt(0).toUpperCase() + section.slice(1) + ' updated' : 'All data updated')

      // Update timestamp display
      var tsEl = document.getElementById('mie-refresh-ts')
      var now = new Date()
      var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      var dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric' })
      if (tsEl) {
        tsEl.textContent = 'Last refreshed: ' + dateStr + ' ' + timeStr
      } else {
        // Add timestamp if it didn't exist
        var controls = barContainer.querySelector('.mie-refresh-controls')
        if (controls) {
          var span = document.createElement('span')
          span.className = 'mie-refresh-ts'
          span.id = 'mie-refresh-ts'
          span.textContent = 'Last refreshed: ' + dateStr + ' ' + timeStr
          controls.appendChild(span)
        }
      }

      setTimeout(function () {
        status.style.display = 'none'
      }, 3000)
      if (onDone) onDone()
    })
    .catch(function (e) {
      status.className = 'mie-refresh-status error'
      status.innerHTML = '&#x2717; Error: ' + e.message
      setTimeout(function () {
        status.style.display = 'none'
      }, 6000)
    })
    .finally(function () {
      if (refreshBtn) refreshBtn.disabled = false
    })
}

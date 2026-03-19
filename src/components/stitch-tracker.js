import { $, esc } from '../lib/utils.js'
import { PIPE5_NAMES, PIPE5_ICONS, PIPE5_STATUS } from '../config/constants.js'

/**
 * Stitch-Claude Chat Builder — Flawless Pipeline
 * 7-stage live tracker component (shell only, no execution logic)
 */

// Render the 7-stage horizontal stepper tracker
export function renderStitchTracker(containerId) {
  var el = $(containerId)
  if (!el) return
  var html = '<div class="stitch-tracker" id="' + containerId + '-tracker">'
  // Header
  html += '<div class="stitch-tracker-hdr">'
    + '<div class="stitch-tracker-title">\uD83E\uDDF5 Flawless Pipeline</div>'
    + '<div class="stitch-tracker-time" id="' + containerId + '-time">--:--</div>'
    + '</div>'
  // Horizontal stepper rail
  html += '<div class="stitch-rail">'
  for (var i = 0; i < PIPE5_NAMES.length; i++) {
    var isLast = i === PIPE5_NAMES.length - 1
    html += '<div class="stitch-stage s-idle" id="' + containerId + '-stage-' + i + '">'
      + '<div class="stitch-node">'
      + '<div class="stitch-node-ico">' + PIPE5_ICONS[i] + '</div>'
      + '</div>'
      + '<div class="stitch-stage-label">' + esc(PIPE5_NAMES[i]) + '</div>'
      + '<div class="stitch-stage-badge" id="' + containerId + '-badge-' + i + '">Waiting</div>'
      + '</div>'
    if (!isLast) html += '<div class="stitch-connector"></div>'
  }
  html += '</div>'
  // GPT-4o review findings panel (expandable shell)
  html += '<div class="stitch-review-panel" id="' + containerId + '-review">'
    + '<div class="stitch-review-hdr" id="' + containerId + '-review-toggle">'
    + '<span class="stitch-review-title">\uD83D\uDD0D GPT-4o Review Findings</span>'
    + '<span class="stitch-review-arrow">\u25B6</span>'
    + '</div>'
    + '<div class="stitch-review-body" id="' + containerId + '-review-body" style="display:none">'
    + '<div class="stitch-review-empty">No findings yet \u2014 review will populate during pipeline execution.</div>'
    + '</div>'
    + '</div>'
  // Build time estimate
  html += '<div class="stitch-estimate" id="' + containerId + '-estimate">'
    + '<span class="stitch-estimate-label">Estimated build time</span>'
    + '<span class="stitch-estimate-value" id="' + containerId + '-eta">--</span>'
    + '</div>'
  html += '</div>'
  el.innerHTML = html
  // Wire up review panel toggle
  var revToggle = $(containerId + '-review-toggle')
  if (revToggle) {
    revToggle.addEventListener('click', function () {
      var body = $(containerId + '-review-body')
      var arrow = revToggle.querySelector('.stitch-review-arrow')
      if (body.style.display === 'none') { body.style.display = 'block'; arrow.textContent = '\u25BC' }
      else { body.style.display = 'none'; arrow.textContent = '\u25B6' }
    })
  }
}

// Update a single stage's status
export function updateStitchStage(containerId, stageIndex, status, detail) {
  var stage = $(containerId + '-stage-' + stageIndex)
  var badge = $(containerId + '-badge-' + stageIndex)
  if (!stage || !badge) return
  // Remove all status classes
  stage.className = 'stitch-stage'
  if (status === PIPE5_STATUS.RUNNING) {
    stage.classList.add('s-running')
    badge.textContent = detail || 'Running\u2026'
  } else if (status === PIPE5_STATUS.PASSED) {
    stage.classList.add('s-passed')
    badge.textContent = detail || 'Passed'
  } else if (status === PIPE5_STATUS.FAILED) {
    stage.classList.add('s-failed')
    badge.textContent = detail || 'Failed'
  } else if (status === PIPE5_STATUS.SKIPPED) {
    stage.classList.add('s-skipped')
    badge.textContent = detail || 'Skipped'
  } else {
    stage.classList.add('s-idle')
    badge.textContent = 'Waiting'
  }
}

// Update the build time estimate display
export function updateStitchEstimate(containerId, text) {
  var el = $(containerId + '-eta')
  if (el) el.textContent = text || '--'
}

// Update the elapsed time display
export function updateStitchTime(containerId, text) {
  var el = $(containerId + '-time')
  if (el) el.textContent = text || '--:--'
}

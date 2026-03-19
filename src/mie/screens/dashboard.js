// Dashboard / Overview screen with leaderboard
import { getCompetitors, getScoreDimensions, getAlerts } from '../lib/mie-data.js'
import { scoreBar, scoreBadge } from '../components/score-bar.js'
import { scoreColor } from '../lib/scoring.js'

export function renderDashboard(container, navigate, signal) {
  var COMPETITORS = getCompetitors()
  var SCORE_DIMENSIONS = getScoreDimensions()
  var COMPETITIVE_ALERTS = getAlerts()

  // Sort competitors by composite score descending
  var sorted = COMPETITORS.slice().sort(function (a, b) { return b.scores.composite - a.scores.composite })

  var html = ''

  // KPIs
  var gb = COMPETITORS.find(function (c) { return c.isSelf })
  var topComp = sorted[0]
  html += '<div class="mie-kpi-row">'
  html += kpi(gb.scores.composite, 'GB Composite', scoreColor(gb.scores.composite))
  html += kpi(gb.scores.accessibility, 'GB Accessibility', '#00E5FF')
  html += kpi(sorted.filter(function (c) { return !c.isSelf }).length, 'Competitors Tracked', '#7C4DFF')
  html += kpi('3', 'Active Alerts', '#FF3CAC')
  html += '</div>'

  // Leaderboard
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Competitive Leaderboard</div>'
  html += '<table class="mie-table"><thead><tr>'
  html += '<th>#</th><th>Lender</th><th>Composite</th>'
  for (var d = 0; d < SCORE_DIMENSIONS.length; d++) {
    html += '<th class="mie-hide-mobile">' + SCORE_DIMENSIONS[d].label + '</th>'
  }
  html += '<th class="mie-hide-mobile">Segment</th></tr></thead><tbody>'

  for (var i = 0; i < sorted.length; i++) {
    var c = sorted[i]
    html += '<tr data-id="' + c.id + '">'
    html += '<td class="mie-rank">' + (i + 1) + '</td>'
    html += '<td><div class="mie-comp-name"><span class="mie-comp-dot" style="background:' + c.color + '"></span>' + c.name + (c.isSelf ? ' <span style="font-size:10px;color:var(--mie-accent)">(You)</span>' : '') + '</div></td>'
    html += '<td>' + scoreBadge(c.scores.composite) + '</td>'
    for (var dd = 0; dd < SCORE_DIMENSIONS.length; dd++) {
      var key = SCORE_DIMENSIONS[dd].key
      html += '<td class="mie-hide-mobile">' + scoreBar(c.scores[key], { showValue: true, size: 'small', color: SCORE_DIMENSIONS[dd].color }) + '</td>'
    }
    html += '<td class="mie-hide-mobile"><span class="mie-segment-tag">' + c.segment + '</span></td>'
    html += '</tr>'
  }

  html += '</tbody></table></div>'

  // Alerts
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Competitive Alerts</div>'
  for (var a = 0; a < COMPETITIVE_ALERTS.length; a++) {
    var alert = COMPETITIVE_ALERTS[a]
    var icon = alert.type === 'sentiment' ? '&#x1F4C9;' : alert.type === 'rate_change' ? '&#x1F4B0;' : '&#x1F4E6;'
    var sevColor = alert.severity === 'high' ? '#FF5252' : alert.severity === 'medium' ? '#FFD600' : '#00E5FF'
    html += '<div class="mie-alert">'
    html += '<div class="mie-alert-icon">' + icon + '</div>'
    html += '<div class="mie-alert-body">'
    html += '<div class="mie-alert-title" style="color:' + sevColor + '">' + alert.title + '</div>'
    html += '<div class="mie-alert-desc">' + alert.description + '</div>'
    html += '<div class="mie-alert-action">' + alert.action + '</div>'
    html += '<div class="mie-alert-date">' + alert.date + '</div>'
    html += '</div></div>'
  }
  html += '</div>'

  container.innerHTML = html

  // Click to navigate to competitor detail
  var rows = container.querySelectorAll('.mie-table tbody tr')
  for (var r = 0; r < rows.length; r++) {
    rows[r].addEventListener('click', function () {
      var id = this.dataset.id
      var comp = COMPETITORS.find(function (c) { return c.id === id })
      if (comp) navigate('competitor-detail', { competitor: comp })
    }, { signal: signal })
  }
}

function kpi(value, label, color) {
  return '<div class="mie-kpi"><div class="mie-kpi-val" style="color:' + (color || '#fff') + '">' + value + '</div><div class="mie-kpi-label">' + label + '</div></div>'
}

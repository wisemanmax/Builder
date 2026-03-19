// Segment Gap Analysis Screen
import { getSegments } from '../lib/mie-data.js'
import { scoreBar } from '../components/score-bar.js'

export function renderGaps(container, signal) {
  var SEGMENTS = getSegments()
  var sorted = SEGMENTS.slice().sort(function (a, b) { return b.opportunityScore - a.opportunityScore })

  var html = ''
  html += '<div style="margin-bottom:18px">'
  html += '<p style="font-size:13px;color:var(--mie-text-secondary);line-height:1.6">Borrower segments underserved by competitors, ranked by opportunity score. Click to expand segment details and messaging recommendations.</p>'
  html += '</div>'

  for (var i = 0; i < sorted.length; i++) {
    var seg = sorted[i]
    var oppColor = seg.opportunityScore >= 75 ? '#00E676' : seg.opportunityScore >= 60 ? '#AAFF00' : '#FFD600'

    html += '<div class="mie-seg-card" data-idx="' + i + '">'
    html += '<div class="mie-seg-header">'
    html += '<div class="mie-seg-name">' + seg.name + '</div>'
    html += '<div style="display:flex;align-items:center;gap:8px">'
    html += '<span style="font-family:var(--fm);font-size:18px;font-weight:700;color:' + oppColor + '">' + seg.opportunityScore + '</span>'
    html += '<span style="font-size:10px;color:var(--mie-text-muted)">OPP</span>'
    html += '</div></div>'

    html += '<div class="mie-seg-body">' + seg.description + '</div>'

    html += '<div class="mie-seg-stats">'
    html += stat('Rejection Rate', seg.rejectionRate + '%', '#FF5252')
    html += stat('GB Approval', seg.gbApprovalProbability + '%', '#00E676')
    html += stat('Market Size', seg.marketSizeIndex, '#3D5AFE')
    html += stat('Revenue Index', seg.revenueIndex, '#FFD600')
    html += '</div>'

    html += scoreBar(seg.opportunityScore, { label: 'Opportunity', color: oppColor })

    // Expandable detail
    html += '<div class="mie-seg-detail">'
    html += '<div style="font-size:11px;font-weight:600;color:var(--mie-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Segment Profile</div>'
    var profile = seg.profile
    for (var key in profile) {
      html += '<div class="mie-seg-profile-row">'
      html += '<span class="mie-seg-profile-key">' + formatKey(key) + '</span>'
      html += '<span>' + profile[key] + '</span>'
      html += '</div>'
    }

    html += '<div style="margin-top:12px;font-size:11px;font-weight:600;color:var(--mie-text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Competitor Gap</div>'
    html += '<p style="font-size:12px;color:var(--mie-text-secondary);line-height:1.5">' + seg.competitorGap + '</p>'

    html += '<div class="mie-seg-headline">"' + seg.recommendedHeadline + '"</div>'
    html += '</div>' // end detail

    html += '</div>' // end card
  }

  container.innerHTML = html

  // Toggle expand
  var cards = container.querySelectorAll('.mie-seg-card')
  for (var c = 0; c < cards.length; c++) {
    cards[c].addEventListener('click', function () {
      this.classList.toggle('expanded')
    }, { signal: signal })
  }
}

function stat(label, value, color) {
  return '<div class="mie-seg-stat"><span class="mie-seg-stat-label">' + label + '</span><span class="mie-seg-stat-val" style="color:' + color + '">' + value + '</span></div>'
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, function (s) { return s.toUpperCase() })
}

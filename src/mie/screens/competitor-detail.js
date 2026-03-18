// Competitor Detail Page
import { SCORE_DIMENSIONS } from '../data/competitors.js'
import { SENTIMENT_SCORES, SENTIMENT_LABELS, SAMPLE_REVIEWS } from '../data/sentiment.js'
import { scoreBar, scoreBadge, tierBadge } from '../components/score-bar.js'

export function renderCompetitorDetail(container, competitor, navigate) {
  if (!competitor) {
    container.innerHTML = '<p>No competitor selected.</p>'
    return
  }

  var c = competitor
  var html = ''

  // Back button
  html += '<button class="mie-back-btn" id="mie-detail-back">&larr; Back to Overview</button>'

  // Header
  html += '<div class="mie-detail-header">'
  html += '<div class="mie-detail-logo" style="background:' + c.color + '">' + c.name.charAt(0) + '</div>'
  html += '<div class="mie-detail-info">'
  html += '<div class="mie-detail-name">' + c.name + (c.isSelf ? ' <span style="font-size:12px;color:var(--mie-accent)">(Your Company)</span>' : '') + '</div>'
  html += '<div class="mie-detail-meta">'
  html += '<span class="mie-segment-tag">' + c.segment + '</span>'
  html += scoreBadge(c.scores.composite)
  html += '</div></div></div>'

  // Score breakdown
  html += '<div class="mie-grid mie-grid-2">'
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Score Breakdown</div>'
  for (var d = 0; d < SCORE_DIMENSIONS.length; d++) {
    var dim = SCORE_DIMENSIONS[d]
    html += scoreBar(c.scores[dim.key], { label: dim.label, color: dim.color })
  }
  html += '</div>'

  // Experience Audit
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Experience Audit</div>'
  var expItems = [
    ['App Complexity', c.experience.applicationComplexity, 10],
    ['Mobile Quality', c.experience.mobileScore, 10],
    ['Rate Transparency', c.experience.rateTransparency, 10],
    ['Approval Speed', c.experience.approvalSpeed, 10],
    ['Support Quality', c.experience.supportQuality, 10],
    ['Digital Account', c.experience.digitalAccountScore, 10],
  ]
  for (var e = 0; e < expItems.length; e++) {
    html += scoreBar(expItems[e][1] * 10, { label: expItems[e][0], size: 'small' })
  }
  html += '<div style="margin-top:10px;font-size:11px;color:var(--mie-text-muted)">'
  html += 'Time to complete: ~' + c.experience.timeToComplete + ' min | '
  html += 'Pre-qualification: ' + (c.experience.prequalification ? 'Yes' : 'No') + ' | '
  html += 'Personalization: ' + c.experience.personalization
  html += '</div>'
  html += '</div></div>'

  // Products
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Loan Products</div>'
  html += '<table class="mie-table mie-product-table"><thead><tr>'
  html += '<th>Product</th><th>Fixed APR</th><th>Variable APR</th><th>Loan Range</th><th>Terms</th><th>Cosigner Release</th><th>Forbearance</th>'
  html += '</tr></thead><tbody>'
  for (var p = 0; p < c.products.length; p++) {
    var prod = c.products[p]
    html += '<tr>'
    html += '<td style="font-weight:600">' + prod.name + '</td>'
    html += '<td class="mie-product-val">' + prod.fixedAprMin.toFixed(2) + '% &ndash; ' + prod.fixedAprMax.toFixed(2) + '%</td>'
    html += '<td class="mie-product-val">' + prod.variableAprMin.toFixed(2) + '% &ndash; ' + prod.variableAprMax.toFixed(2) + '%</td>'
    html += '<td class="mie-product-val">$' + prod.loanMin.toLocaleString() + ' &ndash; ' + (prod.loanMax ? '$' + prod.loanMax.toLocaleString() : 'COA') + '</td>'
    html += '<td class="mie-product-val">' + prod.repaymentTermsMin + '&ndash;' + prod.repaymentTermsMax + ' yr</td>'
    html += '<td class="mie-product-val">' + prod.cosignerReleaseMonths + ' mo</td>'
    html += '<td class="mie-product-val">' + prod.hardshipForbearanceMonths + ' mo</td>'
    html += '</tr>'
  }
  html += '</tbody></table></div>'

  // Sentiment
  var sentScores = SENTIMENT_SCORES[c.id]
  var reviews = SAMPLE_REVIEWS[c.id] || []
  if (sentScores) {
    html += '<div class="mie-grid mie-grid-2">'
    html += '<div class="mie-card">'
    html += '<div class="mie-card-title">Sentiment Scores <span class="mie-trend-' + sentScores.trend + '" style="font-size:11px;font-weight:400">' + (sentScores.trend === 'up' ? '&#x2191; Improving' : sentScores.trend === 'down' ? '&#x2193; Declining' : '&#x2192; Stable') + '</span></div>'
    var cats = Object.keys(SENTIMENT_LABELS)
    for (var s = 0; s < cats.length; s++) {
      var cat = cats[s]
      var val = sentScores[cat] || 0
      var pct = (val / 5) * 100
      var barColor = val >= 3.5 ? '#00E676' : val >= 2.5 ? '#FFD600' : '#FF5252'
      html += '<div class="mie-sent-row">'
      html += '<span class="mie-sent-cat">' + SENTIMENT_LABELS[cat] + '</span>'
      html += '<div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">'
      html += '<div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:4px;transition:width 0.5s"></div>'
      html += '</div>'
      html += '<span class="mie-sent-val">' + val.toFixed(1) + '</span>'
      html += '</div>'
    }
    html += '</div>'

    html += '<div class="mie-card">'
    html += '<div class="mie-card-title">Recent Reviews (' + reviews.length + ')</div>'
    for (var rv = 0; rv < Math.min(reviews.length, 4); rv++) {
      var review = reviews[rv]
      html += '<div class="mie-review-card">'
      html += '<div class="mie-review-header">'
      html += '<span class="mie-review-source">' + review.source + '</span>'
      html += '<span class="mie-review-polarity ' + review.polarity + '">' + review.polarity + '</span>'
      if (review.rating) html += '<span style="font-size:11px;color:var(--mie-text-muted)">&#x2605; ' + review.rating + '/5</span>'
      html += '</div>'
      html += '<div class="mie-review-text">"' + review.text + '"</div>'
      html += '<div class="mie-review-date">' + review.date + ' &middot; ' + SENTIMENT_LABELS[review.category] + '</div>'
      html += '</div>'
    }
    html += '</div></div>'
  }

  container.innerHTML = html

  // Back button handler
  document.getElementById('mie-detail-back').addEventListener('click', function () {
    navigate('overview')
  })
}

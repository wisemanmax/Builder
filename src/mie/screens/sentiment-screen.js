// Sentiment Feed Screen
import { COMPETITORS } from '../data/competitors.js'
import { SENTIMENT_SCORES, SENTIMENT_LABELS, SENTIMENT_CATEGORIES, SAMPLE_REVIEWS } from '../data/sentiment.js'

export function renderSentiment(container) {
  var html = ''

  // Competitor tabs
  html += '<div class="mie-comp-tabs" id="mie-sent-tabs">'
  html += '<button class="mie-comp-tab active" data-comp="all">All Competitors</button>'
  for (var i = 0; i < COMPETITORS.length; i++) {
    html += '<button class="mie-comp-tab" data-comp="' + COMPETITORS[i].id + '">' + COMPETITORS[i].name + '</button>'
  }
  html += '</div>'

  // Overview: all competitors grouped by category
  html += '<div class="mie-card" id="mie-sent-overview">'
  html += '<div class="mie-card-title">Sentiment by Category</div>'

  for (var ci = 0; ci < SENTIMENT_CATEGORIES.length; ci++) {
    var cat = SENTIMENT_CATEGORIES[ci]
    html += '<div style="margin-bottom:14px">'
    html += '<div style="font-size:11px;font-weight:600;color:var(--mie-text-secondary);margin-bottom:6px">' + SENTIMENT_LABELS[cat] + '</div>'
    html += '<div class="mie-sent-bars">'
    for (var j = 0; j < COMPETITORS.length; j++) {
      var comp = COMPETITORS[j]
      var scores = SENTIMENT_SCORES[comp.id]
      var val = scores ? (scores[cat] || 0) : 0
      var pct = (val / 5) * 100
      var barColor = comp.color
      html += '<div class="mie-sent-bar" style="width:' + pct + '%;background:' + barColor + ';opacity:0.7" title="' + comp.name + ': ' + val.toFixed(1) + '"></div>'
    }
    html += '</div>'
    // Mini legend for this row
    html += '<div style="display:flex;gap:10px;margin-top:3px">'
    for (var k = 0; k < COMPETITORS.length; k++) {
      var c2 = COMPETITORS[k]
      var s2 = SENTIMENT_SCORES[c2.id]
      var v2 = s2 ? (s2[cat] || 0) : 0
      html += '<span style="font-size:9px;color:' + c2.color + '">' + c2.name.split(' ')[0] + ': ' + v2.toFixed(1) + '</span>'
    }
    html += '</div></div>'
  }
  html += '</div>'

  // Overall scores card
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Overall Sentiment Scores</div>'
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:12px">'
  var compSorted = COMPETITORS.slice().sort(function (a, b) {
    var sa = SENTIMENT_SCORES[a.id] ? SENTIMENT_SCORES[a.id].overall : 0
    var sb = SENTIMENT_SCORES[b.id] ? SENTIMENT_SCORES[b.id].overall : 0
    return sb - sa
  })
  for (var m = 0; m < compSorted.length; m++) {
    var cc = compSorted[m]
    var ss = SENTIMENT_SCORES[cc.id]
    var overall = ss ? ss.overall : 0
    var trend = ss ? ss.trend : 'stable'
    var trendIcon = trend === 'up' ? '&#x2191;' : trend === 'down' ? '&#x2193;' : '&#x2192;'
    var trendClass = 'mie-trend-' + trend
    html += '<div style="text-align:center;padding:14px;background:var(--mie-surface);border-radius:var(--mie-rs);border:1px solid var(--mie-border)">'
    html += '<div style="font-family:var(--fm);font-size:22px;font-weight:700;color:' + cc.color + '">' + overall.toFixed(1) + '</div>'
    html += '<div style="font-size:11px;font-weight:600;margin-top:2px">' + cc.name + '</div>'
    html += '<div class="' + trendClass + '" style="font-size:11px;margin-top:4px">' + trendIcon + ' ' + trend + '</div>'
    html += '</div>'
  }
  html += '</div></div>'

  // Notable reviews
  html += '<div class="mie-card">'
  html += '<div class="mie-card-title">Notable Reviews</div>'
  html += '<div id="mie-reviews-list">'
  html += renderReviews('all')
  html += '</div></div>'

  container.innerHTML = html

  // Tab switching
  var tabs = container.querySelectorAll('.mie-comp-tab')
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      for (var x = 0; x < tabs.length; x++) tabs[x].classList.remove('active')
      this.classList.add('active')
      var compId = this.dataset.comp
      document.getElementById('mie-reviews-list').innerHTML = renderReviews(compId)
    })
  }
}

function renderReviews(compFilter) {
  var html = ''
  var allReviews = []
  var compIds = compFilter === 'all' ? Object.keys(SAMPLE_REVIEWS) : [compFilter]

  for (var i = 0; i < compIds.length; i++) {
    var reviews = SAMPLE_REVIEWS[compIds[i]] || []
    var comp = COMPETITORS.find(function (c) { return c.id === compIds[i] })
    for (var j = 0; j < reviews.length; j++) {
      allReviews.push({ review: reviews[j], competitor: comp })
    }
  }

  // Sort by actionable first, then by strength
  allReviews.sort(function (a, b) {
    if (a.review.actionable !== b.review.actionable) return b.review.actionable ? 1 : -1
    return b.review.strength - a.review.strength
  })

  for (var k = 0; k < Math.min(allReviews.length, 8); k++) {
    var item = allReviews[k]
    var r = item.review
    html += '<div class="mie-review-card">'
    html += '<div class="mie-review-header">'
    html += '<span style="color:' + item.competitor.color + ';font-size:11px;font-weight:600">' + item.competitor.name + '</span>'
    html += '<span class="mie-review-source">' + r.source + '</span>'
    html += '<span class="mie-review-polarity ' + r.polarity + '">' + r.polarity + '</span>'
    if (r.actionable) html += '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(255,60,172,0.1);color:var(--mie-accent);font-weight:600">Actionable</span>'
    html += '</div>'
    html += '<div class="mie-review-text">"' + r.text + '"</div>'
    html += '<div class="mie-review-date">' + r.date + ' &middot; ' + (SENTIMENT_LABELS[r.category] || r.category) + '</div>'
    html += '</div>'
  }

  return html
}

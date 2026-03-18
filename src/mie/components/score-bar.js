// Reusable horizontal score bar (0-100)
import { scoreColor } from '../lib/scoring.js'

export function scoreBar(score, opts) {
  opts = opts || {}
  var label = opts.label || ''
  var color = opts.color || scoreColor(score)
  var showValue = opts.showValue !== false
  var size = opts.size || 'normal' // 'small' | 'normal'
  var barClass = size === 'small' ? 'mie-sbar mie-sbar-sm' : 'mie-sbar'

  return '<div class="' + barClass + '">'
    + (label ? '<span class="mie-sbar-label">' + label + '</span>' : '')
    + '<div class="mie-sbar-track">'
    + '<div class="mie-sbar-fill" style="width:' + Math.min(100, Math.max(0, score)) + '%;background:' + color + '"></div>'
    + '</div>'
    + (showValue ? '<span class="mie-sbar-val" style="color:' + color + '">' + score + '</span>' : '')
    + '</div>'
}

export function scoreBadge(score) {
  var color = scoreColor(score)
  return '<span class="mie-score-badge" style="border-color:' + color + ';color:' + color + '">' + score + '</span>'
}

export function tierBadge(tier, label) {
  var colors = { strong: '#00E676', likely: '#AAFF00', possible: '#FFD600', unlikely: '#FF9100', rejected: '#FF5252' }
  var c = colors[tier] || '#888'
  return '<span class="mie-tier-badge" style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44">' + label + '</span>'
}

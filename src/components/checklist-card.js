import { esc } from '../lib/utils.js'

/**
 * Render a checklist verification result as an HTML string for chat messages.
 * @param {object} summary - { total, verified, missing, items }
 * @returns {string} HTML string
 */
export function renderChecklistResults(summary) {
  if (!summary || !summary.items || !summary.items.length) return ''

  var allGood = summary.missing === 0
  var headerIcon = allGood ? '\u2705' : '\u26A0\uFE0F'
  var headerText = allGood
    ? 'All ' + summary.total + ' features verified'
    : summary.verified + '/' + summary.total + ' features verified'

  var html = '<div class="cl-card">' +
    '<div class="cl-header">' + headerIcon + ' ' + headerText + '</div>' +
    '<div class="cl-items">'

  for (var i = 0; i < summary.items.length; i++) {
    var item = summary.items[i]
    var icon = item.verified ? '\u2705' : (item.required ? '\u274C' : '\u26AA')
    var cls = item.verified ? 'cl-ok' : (item.required ? 'cl-miss' : 'cl-opt')
    html += '<div class="cl-item ' + cls + '">' +
      '<span class="cl-icon">' + icon + '</span>' +
      '<div class="cl-text">' +
      '<span class="cl-feat">' + esc(item.text) + '</span>'
    if (item.evidence) {
      html += '<span class="cl-evidence">' + esc(item.evidence) + '</span>'
    }
    html += '</div>'
    if (item.required) html += '<span class="cl-req">' + (item.verified ? 'required' : 'MISSING') + '</span>'
    html += '</div>'
  }

  html += '</div></div>'
  return html
}

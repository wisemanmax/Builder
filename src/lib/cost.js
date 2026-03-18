import { COST_RATES, COST_MARKUP } from '../config/constants.js'
import { getCostAccum } from './ai.js'
import { esc } from './utils.js'

export function calculateBuildCost() {
  var accum = getCostAccum()
  var totalCost = 0
  var totalInput = 0
  var totalOutput = 0
  var totalCacheRead = 0
  var totalCacheWrite = 0
  var breakdown = []

  for (var i = 0; i < accum.calls.length; i++) {
    var c = accum.calls[i]
    var rates = COST_RATES[c.model]
    if (!rates) continue

    var inputCost = (c.input / 1000000) * rates.input
    var outputCost = (c.output / 1000000) * rates.output
    var cacheReadCost = rates.cacheRead ? (c.cacheRead / 1000000) * rates.cacheRead : 0
    var cacheWriteCost = rates.cacheWrite ? (c.cacheWrite / 1000000) * rates.cacheWrite : 0
    var callCost = inputCost + outputCost + cacheReadCost + cacheWriteCost

    totalCost += callCost
    totalInput += c.input
    totalOutput += c.output
    totalCacheRead += c.cacheRead
    totalCacheWrite += c.cacheWrite

    breakdown.push({
      label: c.label,
      model: _shortModel(c.model),
      input: c.input,
      output: c.output,
      cacheRead: c.cacheRead,
      cacheWrite: c.cacheWrite,
      cost: callCost,
    })
  }

  return {
    breakdown: breakdown,
    rawCost: totalCost,
    userPrice: totalCost * COST_MARKUP,
    markup: COST_MARKUP,
    totalInput: totalInput,
    totalOutput: totalOutput,
    totalCacheRead: totalCacheRead,
    totalCacheWrite: totalCacheWrite,
    ts: new Date().toISOString(),
  }
}

function _shortModel(m) {
  if (m.indexOf('claude-sonnet') >= 0) return 'Claude Sonnet'
  if (m === 'gpt-4o-mini') return 'GPT-4o Mini'
  if (m === 'gpt-4o') return 'GPT-4o'
  return m
}

function _fmt(n) {
  if (n < 0.001) return '<$0.001'
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toFixed(3)
}

function _fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export function costCardHTML(cost) {
  var rows = ''
  for (var i = 0; i < cost.breakdown.length; i++) {
    var b = cost.breakdown[i]
    var cacheInfo = ''
    if (b.cacheRead > 0) cacheInfo = ' (' + _fmtTokens(b.cacheRead) + ' cached)'
    rows += '<div class="cost-row">'
      + '<div class="cost-label">' + esc(b.label) + '</div>'
      + '<div class="cost-model">' + esc(b.model) + '</div>'
      + '<div class="cost-tokens">' + _fmtTokens(b.input) + ' in' + cacheInfo + ' / ' + _fmtTokens(b.output) + ' out</div>'
      + '<div class="cost-amt">' + _fmt(b.cost) + '</div>'
      + '</div>'
  }

  var cacheSavings = ''
  if (cost.totalCacheRead > 0) {
    var savedTokens = cost.totalCacheRead
    var rates = COST_RATES['claude-sonnet-4-20250514']
    var saved = (savedTokens / 1000000) * (rates.input - rates.cacheRead)
    cacheSavings = '<div class="cost-cache-savings">Cache saved ' + _fmtTokens(savedTokens) + ' tokens (' + _fmt(saved) + ')</div>'
  }

  return '<div class="cost-card">'
    + '<div class="cost-hdr"><div class="cost-hdr-ico">\uD83D\uDCB0</div><div class="cost-hdr-title">Build Cost Analysis</div></div>'
    + '<div class="cost-body">' + rows + '</div>'
    + '<div class="cost-footer">'
    + '<div class="cost-total-row">'
    + '<div class="cost-total-label">Raw API Cost</div>'
    + '<div class="cost-total-amt">' + _fmt(cost.rawCost) + '</div>'
    + '</div>'
    + '<div class="cost-total-row cost-markup-row">'
    + '<div class="cost-total-label">User Price (' + cost.markup + 'x)</div>'
    + '<div class="cost-total-amt cost-user-price">' + _fmt(cost.userPrice) + '</div>'
    + '</div>'
    + '<div class="cost-total-row cost-margin-row">'
    + '<div class="cost-total-label">Margin</div>'
    + '<div class="cost-total-amt cost-margin">' + _fmt(cost.userPrice - cost.rawCost) + '</div>'
    + '</div>'
    + cacheSavings
    + '<div class="cost-meta">'
    + _fmtTokens(cost.totalInput) + ' input + ' + _fmtTokens(cost.totalOutput) + ' output = ' + _fmtTokens(cost.totalInput + cost.totalOutput) + ' total tokens'
    + '</div>'
    + '</div></div>'
}

export function costSummaryHTML(costs) {
  if (!costs || !costs.length) return ''
  var totalRaw = 0
  var totalUser = 0
  for (var i = 0; i < costs.length; i++) {
    totalRaw += costs[i].rawCost || 0
    totalUser += costs[i].userPrice || 0
  }
  var rows = ''
  for (var j = costs.length - 1; j >= 0; j--) {
    var c = costs[j]
    var dt = c.ts ? new Date(c.ts) : null
    var dateStr = dt ? (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + dt.getHours() + ':' + String(dt.getMinutes()).padStart(2, '0') : ''
    rows += '<div class="cost-hist-row">'
      + '<span class="cost-hist-date">' + dateStr + '</span>'
      + '<span class="cost-hist-raw">' + _fmt(c.rawCost) + '</span>'
      + '<span class="cost-hist-user">' + _fmt(c.userPrice) + '</span>'
      + '</div>'
  }
  return '<div class="cost-summary">'
    + '<div class="cost-summary-totals">'
    + '<div class="cost-summary-item"><span class="cost-summary-label">Total Raw Cost</span><span class="cost-summary-val">' + _fmt(totalRaw) + '</span></div>'
    + '<div class="cost-summary-item"><span class="cost-summary-label">Total User Price</span><span class="cost-summary-val">' + _fmt(totalUser) + '</span></div>'
    + '<div class="cost-summary-item"><span class="cost-summary-label">Total Margin</span><span class="cost-summary-val">' + _fmt(totalUser - totalRaw) + '</span></div>'
    + '<div class="cost-summary-item"><span class="cost-summary-label">Builds</span><span class="cost-summary-val">' + costs.length + '</span></div>'
    + '</div>'
    + '<div class="cost-hist-hdr"><span>Date</span><span>Raw</span><span>User</span></div>'
    + rows
    + '</div>'
}

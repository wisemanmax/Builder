import { ST } from '../lib/state.js'
import { $, esc, fmtDate } from '../lib/utils.js'
import { openThink } from './think.js'

var _currentSort = 'date-new'

export function initThoughtsFolder() {
  $('tf-close').addEventListener('click', closeThoughtsFolder)
  $('thoughts-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'thoughts-overlay') closeThoughtsFolder()
  })
  $('tf-sort-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tpl-cat')
    if (!tab || !tab.dataset.sort) return
    _currentSort = tab.dataset.sort
    var tabs = $('tf-sort-tabs').querySelectorAll('.tpl-cat')
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i] === tab)
    renderThoughtCards(_currentSort)
  })
}

export function openThoughtsFolder() {
  _currentSort = 'date-new'
  var tabsEl = $('tf-sort-tabs')
  tabsEl.innerHTML =
    '<div class="tpl-cat active" data-sort="date-new">Newest</div>' +
    '<div class="tpl-cat" data-sort="date-old">Oldest</div>' +
    '<div class="tpl-cat" data-sort="status">Status</div>' +
    '<div class="tpl-cat" data-sort="name">A\u2013Z</div>'
  renderThoughtCards(_currentSort)
  $('thoughts-overlay').classList.add('on')
}

export function closeThoughtsFolder() {
  $('thoughts-overlay').classList.remove('on')
}

function renderThoughtCards(sortBy) {
  var grid = $('tf-grid')
  var thoughts = ST.thoughts.slice()

  if (sortBy === 'date-new') {
    thoughts.sort(function (a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    })
  } else if (sortBy === 'date-old') {
    thoughts.sort(function (a, b) {
      return (a.updatedAt || a.createdAt || '').localeCompare(b.updatedAt || b.createdAt || '')
    })
  } else if (sortBy === 'status') {
    thoughts.sort(function (a, b) {
      if (a.status === b.status) return (b.updatedAt || '').localeCompare(a.updatedAt || '')
      return a.status === 'complete' ? -1 : 1
    })
  } else if (sortBy === 'name') {
    thoughts.sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '')
    })
  }

  if (!thoughts.length) {
    grid.innerHTML =
      '<div class="tf-empty">' +
      '<div style="font-size:32px;margin-bottom:8px">\uD83D\uDCAD</div>' +
      '<div>No thoughts yet</div>' +
      '<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,.2)">Use Think to plan your apps before building</div>' +
      '</div>'
    return
  }

  var html = ''
  for (var i = 0; i < thoughts.length; i++) {
    var t = thoughts[i]
    var msgCount = (t.conversation && t.conversation.length) || 0
    var prompt =
      (t.originalPrompt || '').length > 80 ? t.originalPrompt.slice(0, 80) + '\u2026' : t.originalPrompt || ''
    var date = t.updatedAt ? fmtDate(t.updatedAt) : t.createdAt ? fmtDate(t.createdAt) : ''
    html +=
      '<div class="tf-card" onclick="openThoughtDetail(\'' +
      esc(t.id) +
      '\')">' +
      '<div class="tf-card-top">' +
      '<div class="tf-card-icon">\uD83D\uDCAD</div>' +
      '<div class="tf-card-status ' +
      esc(t.status || 'draft') +
      '">' +
      esc(t.status || 'draft') +
      '</div>' +
      '</div>' +
      '<div class="tf-card-name">' +
      esc(t.name || 'Untitled') +
      '</div>' +
      '<div class="tf-card-prompt">' +
      esc(prompt) +
      '</div>' +
      '<div class="tf-card-meta">' +
      '<span>' +
      msgCount +
      ' message' +
      (msgCount !== 1 ? 's' : '') +
      '</span>' +
      '<span>\u00B7</span>' +
      '<span>Round ' +
      (t.rounds || 1) +
      '/5</span>' +
      '<span>\u00B7</span>' +
      '<span>' +
      esc(date) +
      '</span>' +
      '</div>' +
      '</div>'
  }
  grid.innerHTML = html
}

export function openThoughtDetail(id) {
  closeThoughtsFolder()
  openThink(id)
}

import { ST } from '../lib/state.js'
import { $, esc } from '../lib/utils.js'

// Selected thought IDs for current build (supports multiple)
var _selectedThoughtIds = []

export function getSelectedThoughtIds() {
  // Return active thought + any additional selections
  var ids = _selectedThoughtIds.slice()
  if (ST.activeThoughtId && ids.indexOf(ST.activeThoughtId) < 0) {
    ids.unshift(ST.activeThoughtId)
  }
  return ids
}

export function renderThoughtSelector() {
  var sel = $('thought-selector')
  if (!sel) return
  // Sync _selectedThoughtIds with activeThoughtId
  if (ST.activeThoughtId && _selectedThoughtIds.indexOf(ST.activeThoughtId) < 0) {
    _selectedThoughtIds.unshift(ST.activeThoughtId)
  }
  // Remove any IDs that no longer exist
  _selectedThoughtIds = _selectedThoughtIds.filter(function (id) {
    for (var i = 0; i < ST.thoughts.length; i++) {
      if (ST.thoughts[i].id === id) return true
    }
    return false
  })

  if (_selectedThoughtIds.length > 0) {
    var chipsHtml = ''
    for (var i = 0; i < _selectedThoughtIds.length; i++) {
      var t = null
      for (var j = 0; j < ST.thoughts.length; j++) {
        if (ST.thoughts[j].id === _selectedThoughtIds[i]) {
          t = ST.thoughts[j]
          break
        }
      }
      if (!t) continue
      var linkedRules = null
      if (t.linkedRulesId) {
        for (var k = 0; k < ST.rules.length; k++) {
          if (ST.rules[k].id === t.linkedRulesId) {
            linkedRules = ST.rules[k]
            break
          }
        }
      }
      var rulesCount = linkedRules
        ? (linkedRules.mustRules || []).length +
          (linkedRules.mustNotRules || []).length +
          (linkedRules.niceToHave || []).length
        : 0
      var isPrimary = i === 0
      chipsHtml +=
        '<div class="thought-chip' +
        (isPrimary ? '' : ' thought-chip-secondary') +
        '">' +
        (isPrimary ? '\uD83D\uDCDD ' : '\uD83D\uDD17 ') +
        esc(t.name) +
        (t.version > 1 ? '<span class="tc-ver">v' + t.version + '</span>' : '') +
        (rulesCount ? '<span class="tc-rules">\u00B7 ' + rulesCount + ' rules</span>' : '') +
        '<button class="tc-x" onclick="event.stopPropagation();B.detachThoughtById(\'' +
        esc(t.id) +
        '\')" title="Detach">\u2715</button></div>'
    }
    var hasMore = false
    for (var m = 0; m < ST.thoughts.length; m++) {
      if (ST.thoughts[m].status === 'complete' && _selectedThoughtIds.indexOf(ST.thoughts[m].id) < 0) {
        hasMore = true
        break
      }
    }
    if (hasMore) {
      chipsHtml += '<div class="tc-attach tc-attach-more" onclick="B.showThoughtPicker()">+ Add</div>'
    }
    sel.innerHTML = chipsHtml
    sel.style.display = 'flex'
  } else {
    var hasComplete = false
    for (var n = 0; n < ST.thoughts.length; n++) {
      if (ST.thoughts[n].status === 'complete') {
        hasComplete = true
        break
      }
    }
    if (hasComplete) {
      sel.innerHTML = '<div class="tc-attach" onclick="B.showThoughtPicker()">+ Attach Thought</div>'
      sel.style.display = 'flex'
    } else {
      sel.style.display = 'none'
    }
  }
}

export function detachThought() {
  ST.activeThoughtId = null
  _selectedThoughtIds = []
  renderThoughtSelector()
}

export function detachThoughtById(id) {
  _selectedThoughtIds = _selectedThoughtIds.filter(function (tid) {
    return tid !== id
  })
  if (ST.activeThoughtId === id) {
    ST.activeThoughtId = _selectedThoughtIds.length > 0 ? _selectedThoughtIds[0] : null
  }
  renderThoughtSelector()
}

export function showThoughtPicker() {
  var sel = $('thought-selector')
  var existing = sel.querySelector('.thought-picker')
  if (existing) {
    existing.remove()
    return
  }
  var picker = document.createElement('div')
  picker.className = 'thought-picker'
  var html = ''
  for (var i = 0; i < ST.thoughts.length; i++) {
    var t = ST.thoughts[i]
    if (t.status !== 'complete') continue
    var isSelected = _selectedThoughtIds.indexOf(t.id) >= 0
    html +=
      '<div class="thought-picker-item' +
      (isSelected ? ' tpi-selected' : '') +
      '" onclick="B.pickThought(\'' +
      esc(t.id) +
      '\')">' +
      '<div class="tpi-icon">' +
      (isSelected ? '\u2713' : '\uD83D\uDCDD') +
      '</div>' +
      '<div class="tpi-name">' +
      esc(t.name) +
      (t.version > 1 ? ' <span style="font-size:9px;color:rgba(255,255,255,.3)">v' + t.version + '</span>' : '') +
      '</div>' +
      '<div class="tpi-status">' +
      esc(t.status) +
      '</div>' +
      '</div>'
  }
  if (!html)
    html =
      '<div style="padding:12px;font-size:12px;color:rgba(255,255,255,.35);text-align:center">No completed thoughts yet</div>'
  picker.innerHTML = html
  sel.style.position = 'relative'
  sel.appendChild(picker)
  setTimeout(function () {
    document.addEventListener('click', function closePicker(e) {
      if (!sel.contains(e.target)) {
        picker.remove()
        document.removeEventListener('click', closePicker)
      }
    })
  }, 10)
}

export function pickThought(id) {
  var idx = _selectedThoughtIds.indexOf(id)
  if (idx >= 0) {
    // Toggle off
    _selectedThoughtIds.splice(idx, 1)
    if (ST.activeThoughtId === id) {
      ST.activeThoughtId = _selectedThoughtIds.length > 0 ? _selectedThoughtIds[0] : null
    }
  } else {
    // Toggle on
    _selectedThoughtIds.push(id)
    if (!ST.activeThoughtId) ST.activeThoughtId = id
  }
  renderThoughtSelector()
  // Re-render picker items to show updated selection state
  var picker = $('thought-selector').querySelector('.thought-picker')
  if (picker) {
    picker.remove()
    showThoughtPicker()
  }
}

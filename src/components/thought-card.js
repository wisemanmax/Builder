import { ST } from '../lib/state.js'
import { $, esc } from '../lib/utils.js'

export function renderThoughtSelector() {
  var sel = $('thought-selector')
  if (!sel) return
  var activeThought = null
  if (ST.activeThoughtId) {
    for (var i = 0; i < ST.thoughts.length; i++) {
      if (ST.thoughts[i].id === ST.activeThoughtId) {
        activeThought = ST.thoughts[i]
        break
      }
    }
  }
  if (activeThought) {
    var linkedRules = null
    if (activeThought.linkedRulesId) {
      for (var j = 0; j < ST.rules.length; j++) {
        if (ST.rules[j].id === activeThought.linkedRulesId) {
          linkedRules = ST.rules[j]
          break
        }
      }
    }
    var rulesCount = linkedRules
      ? (linkedRules.mustRules || []).length +
        (linkedRules.mustNotRules || []).length +
        (linkedRules.niceToHave || []).length
      : 0
    sel.innerHTML =
      '<div class="thought-chip">\uD83D\uDCDD ' +
      esc(activeThought.name) +
      (rulesCount ? '<span class="tc-rules">\u00B7 ' + rulesCount + ' rules</span>' : '') +
      '<button class="tc-x" onclick="B.detachThought()" title="Detach">\u2715</button></div>'
    sel.style.display = 'flex'
  } else {
    var hasComplete = false
    for (var k = 0; k < ST.thoughts.length; k++) {
      if (ST.thoughts[k].status === 'complete') {
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
    if (t.status === 'complete') {
      html +=
        '<div class="thought-picker-item" onclick="B.pickThought(\'' +
        esc(t.id) +
        '\')">' +
        '<div class="tpi-icon">\uD83D\uDCDD</div>' +
        '<div class="tpi-name">' +
        esc(t.name) +
        '</div>' +
        '<div class="tpi-status">' +
        esc(t.status) +
        '</div>' +
        '</div>'
    }
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
  ST.activeThoughtId = id
  renderThoughtSelector()
  var picker = $('thought-selector').querySelector('.thought-picker')
  if (picker) picker.remove()
}

import { $, esc, escAttr } from '../lib/utils.js'
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../config/templates.js'
import { openBuilder, templateSend } from './build.js'

export function initTemplateSheet() {
  $('tpl-sheet-close').addEventListener('click', closeTemplates)
  $('template-overlay').addEventListener('click', function (e) {
    if (e.target === $('template-overlay')) closeTemplates()
  })
}

export function openTemplates() {
  // Render category tabs
  var cats = '<div class="tpl-cat active" data-cat="all" onclick="_tplSheetFilter(\'all\')">All</div>'
  for (var c = 0; c < TEMPLATE_CATEGORIES.length; c++) {
    var cat = TEMPLATE_CATEGORIES[c]
    cats += '<div class="tpl-cat" data-cat="' + cat.id + '" onclick="_tplSheetFilter(\'' + cat.id + '\')">' + cat.icon + ' ' + esc(cat.name) + '</div>'
  }
  $('tpl-sheet-cats').innerHTML = cats

  // Render template cards
  var cards = ''
  for (var i = 0; i < TEMPLATES.length; i++) {
    var t = TEMPLATES[i]
    cards += '<div class="tpl-card" data-cat="' + t.category + '" onclick="selectTemplate(\'' + t.id + '\')">'
      + '<div class="tpl-card-top"><div class="tpl-card-icon">' + t.icon + '</div>'
      + '<button class="tpl-card-preview" onclick="event.stopPropagation();openTplSheetPreview(\'' + t.id + '\')" title="Preview">\uD83D\uDD0D</button></div>'
      + '<div class="tpl-card-name">' + esc(t.name) + '</div>'
      + '<div class="tpl-card-desc">' + esc(t.desc) + '</div>'
      + '</div>'
  }
  $('tpl-sheet-grid').innerHTML = cards

  $('template-overlay').classList.add('on')
}

export function closeTemplates() {
  $('template-overlay').classList.remove('on')
  closeTplSheetPreview()
}

function selectTemplate(templateId) {
  closeTemplates()
  openBuilder()
  templateSend(templateId)
}

function openTplSheetPreview(templateId) {
  var tpl = TEMPLATES.find(function (t) { return t.id === templateId })
  if (!tpl) return
  var overlay = $('tpl-sheet-preview')
  var nameEl = $('tpl-sheet-preview-name')
  var frame = $('tpl-sheet-preview-frame')
  var useBtn = $('tpl-sheet-preview-use')
  if (!overlay || !frame) return
  nameEl.textContent = tpl.icon + ' ' + tpl.name
  frame.innerHTML = '<iframe sandbox="allow-scripts" srcdoc="' + escAttr(tpl.skeleton) + '"></iframe>'
  useBtn.onclick = function () { selectTemplate(templateId) }
  overlay.classList.add('on')
}

function closeTplSheetPreview() {
  var overlay = $('tpl-sheet-preview')
  if (!overlay) return
  overlay.classList.remove('on')
  var frame = $('tpl-sheet-preview-frame')
  if (frame) frame.innerHTML = ''
}

function filterTemplates(cat) {
  var tabs = document.querySelectorAll('#tpl-sheet-cats .tpl-cat')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.cat === cat)
  }
  var cards = document.querySelectorAll('#tpl-sheet-grid .tpl-card')
  for (var j = 0; j < cards.length; j++) {
    cards[j].style.display = (cat === 'all' || cards[j].dataset.cat === cat) ? '' : 'none'
  }
}

// Expose to window for inline onclick handlers
window.selectTemplate = selectTemplate
window.openTplSheetPreview = openTplSheetPreview
window.closeTplSheetPreview = closeTplSheetPreview
window._tplSheetFilter = filterTemplates

import { $, esc, escAttr } from '../lib/utils.js'
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../config/templates.js'
import { getTemplateSkeleton } from '../lib/template-loader.js'
import { openBuilder, templateSend } from './build.js'
import { rankTemplates } from '../lib/similarity.js'

export function initTemplateSheet() {
  $('tpl-sheet-close').addEventListener('click', closeTemplates)
  $('template-overlay').addEventListener('click', function (e) {
    if (e.target === $('template-overlay')) closeTemplates()
  })
}

export function openTemplates() {
  // Render category tabs
  var cats = '<div class="tpl-cat active" data-cat="all" onclick="B._tplSheetFilter(\'all\')">All</div>'
  for (var c = 0; c < TEMPLATE_CATEGORIES.length; c++) {
    var cat = TEMPLATE_CATEGORIES[c]
    cats +=
      '<div class="tpl-cat" data-cat="' +
      cat.id +
      '" onclick="B._tplSheetFilter(\'' +
      cat.id +
      '\')">' +
      cat.icon +
      ' ' +
      esc(cat.name) +
      '</div>'
  }
  $('tpl-sheet-cats').innerHTML = cats

  // Phase 4: Rank templates by build history performance
  var ranked = rankTemplates()
  var cards = ''
  for (var i = 0; i < ranked.length; i++) {
    var t = ranked[i]
    var badge = t.reason ? '<span class="tpl-badge">' + esc(t.reason) + '</span>' : ''
    cards +=
      '<div class="tpl-card" data-cat="' +
      t.category +
      '" onclick="B.selectTemplate(\'' +
      t.id +
      '\')">' +
      '<div class="tpl-card-top"><div class="tpl-card-icon">' +
      t.icon +
      '</div>' +
      badge +
      '<button class="tpl-card-preview" onclick="event.stopPropagation();B.openTplSheetPreview(\'' +
      t.id +
      '\')" title="Preview">\uD83D\uDD0D</button></div>' +
      '<div class="tpl-card-name">' +
      esc(t.name) +
      '</div>' +
      '<div class="tpl-card-desc">' +
      esc(t.desc) +
      '</div>' +
      '</div>'
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
  var tpl = TEMPLATES.find(function (t) {
    return t.id === templateId
  })
  if (!tpl) return
  var overlay = $('tpl-sheet-preview')
  var nameEl = $('tpl-sheet-preview-name')
  var frame = $('tpl-sheet-preview-frame')
  var useBtn = $('tpl-sheet-preview-use')
  if (!overlay || !frame) return
  nameEl.textContent = tpl.icon + ' ' + tpl.name
  frame.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#888">Loading preview\u2026</div>'
  getTemplateSkeleton(templateId)
    .then(function (skeleton) {
      frame.innerHTML = '<iframe sandbox="allow-scripts" srcdoc="' + escAttr(skeleton) + '"></iframe>'
    })
    .catch(function () {
      frame.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#f66">Failed to load preview</div>'
    })
  useBtn.onclick = function () {
    selectTemplate(templateId)
  }
  overlay.classList.add('on')
  // Auto-fullscreen on mobile for better UX
  var modal = overlay.querySelector('.tpl-preview-modal')
  if (modal && window.innerWidth <= 480) {
    modal.classList.add('fullscreen')
  }
  // Prevent background scroll
  document.body.style.overflow = 'hidden'
}

function closeTplSheetPreview() {
  var overlay = $('tpl-sheet-preview')
  if (!overlay) return
  overlay.classList.remove('on')
  var modal = overlay.querySelector('.tpl-preview-modal')
  if (modal) modal.classList.remove('fullscreen')
  var frame = $('tpl-sheet-preview-frame')
  if (frame) frame.innerHTML = ''
  // Restore background scroll
  document.body.style.overflow = ''
}

function toggleTplSheetPreviewFullscreen() {
  var overlay = $('tpl-sheet-preview')
  if (!overlay) return
  var modal = overlay.querySelector('.tpl-preview-modal')
  if (!modal) return
  modal.classList.toggle('fullscreen')
  var btn = $('tpl-sheet-preview-fs')
  if (btn) {
    var isFs = modal.classList.contains('fullscreen')
    btn.innerHTML = isFs ? '&#x2716;' : '&#x26F6;'
    btn.title = isFs ? 'Exit fullscreen' : 'Toggle fullscreen'
  }
}

function filterTemplates(cat) {
  var tabs = document.querySelectorAll('#tpl-sheet-cats .tpl-cat')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.cat === cat)
  }
  var cards = document.querySelectorAll('#tpl-sheet-grid .tpl-card')
  for (var j = 0; j < cards.length; j++) {
    cards[j].style.display = cat === 'all' || cards[j].dataset.cat === cat ? '' : 'none'
  }
}

// Expose to B namespace for dynamic onclick handlers
export function initTemplateHandlers() {
  window.B.selectTemplate = selectTemplate
  window.B.openTplSheetPreview = openTplSheetPreview
  window.B.closeTplSheetPreview = closeTplSheetPreview
  window.B.toggleTplSheetPreviewFullscreen = toggleTplSheetPreviewFullscreen
  window.B._tplSheetFilter = filterTemplates
}

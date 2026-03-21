// Sidebar navigation for MIE dashboard
import { deleteCustomPage } from '../lib/mie-data.js'

var NAV_ITEMS = [
  { id: 'overview', icon: '&#x2726;', label: 'Overview', mode: 'internal' },
  { id: 'competitors', icon: '&#x1F3C6;', label: 'Competitors', mode: 'internal' },
  { id: 'market-map', icon: '&#x1F5FA;', label: 'Market Map', mode: 'internal' },
  { id: 'gaps', icon: '&#x1F3AF;', label: 'Segment Gaps', mode: 'internal' },
  { id: 'messaging', icon: '&#x1FA84;', label: 'Messaging', mode: 'internal' },
  { id: 'sentiment', icon: '&#x1F4AC;', label: 'Sentiment', mode: 'internal' },
  { id: 'match-tool', icon: '&#x1F50D;', label: 'Match Tool', mode: 'borrower' },
  { id: 'page-creator', icon: '&#x2795;', label: 'Page Creator', mode: 'internal' },
]

export function renderNav(container, activeId, mode, onNavigate, customPages, activePageId, signal) {
  var html = ''
  for (var i = 0; i < NAV_ITEMS.length; i++) {
    var item = NAV_ITEMS[i]
    // In borrower mode, only show match tool; in internal mode, show all internal + match tool
    if (mode === 'borrower' && item.mode !== 'borrower') continue
    var isActive = item.id === activeId ? ' mie-nav-active' : ''
    html +=
      '<button class="mie-nav-item' +
      isActive +
      '" data-screen="' +
      item.id +
      '">' +
      '<span class="mie-nav-icon">' +
      item.icon +
      '</span>' +
      '<span class="mie-nav-label">' +
      item.label +
      '</span>' +
      '</button>'
  }

  // Custom pages section
  if (mode !== 'borrower' && customPages && customPages.length > 0) {
    html += '<div class="mie-nav-divider"></div>'
    html += '<div class="mie-nav-section-label">Custom Pages</div>'
    for (var j = 0; j < customPages.length; j++) {
      var page = customPages[j]
      var isPageActive = activeId === 'custom-page' && activePageId === page.id ? ' mie-nav-active' : ''
      var shortTitle = page.prompt.length > 22 ? page.prompt.substring(0, 22) + '...' : page.prompt
      html +=
        '<div class="mie-nav-item mie-nav-custom-page' +
        isPageActive +
        '" data-screen="custom-page" data-page-id="' +
        page.id +
        '">'
      html += '<span class="mie-nav-icon">&#x1F4C4;</span>'
      html += '<span class="mie-nav-label">' + shortTitle + '</span>'
      html += '<button class="mie-nav-delete-btn" data-delete-page="' + page.id + '" title="Delete">&times;</button>'
      html += '</div>'
    }
  }

  container.innerHTML = html

  // Standard nav item clicks
  var opts = signal ? { signal: signal } : undefined
  var btns = container.querySelectorAll('.mie-nav-item')
  for (var k = 0; k < btns.length; k++) {
    btns[k].addEventListener(
      'click',
      function (e) {
        // Don't navigate if clicking the delete button
        if (e.target.closest('.mie-nav-delete-btn')) return
        var screen = this.dataset.screen
        var pageId = this.dataset.pageId
        onNavigate(screen, pageId ? { pageId: pageId } : undefined)
      },
      opts
    )
  }

  // Delete buttons for custom pages
  var delBtns = container.querySelectorAll('.mie-nav-delete-btn')
  for (var d = 0; d < delBtns.length; d++) {
    delBtns[d].addEventListener(
      'click',
      function (e) {
        e.stopPropagation()
        var pageId = this.dataset.deletePage
        deleteCustomPage(pageId)
        // Navigate back to page creator if we deleted the active page
        if (activeId === 'custom-page' && activePageId === pageId) {
          onNavigate('page-creator')
        } else {
          onNavigate(activeId) // Re-render to update nav
        }
      },
      opts
    )
  }
}

export function getNavItems() {
  return NAV_ITEMS
}

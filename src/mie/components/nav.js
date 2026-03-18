// Sidebar navigation for MIE dashboard
var NAV_ITEMS = [
  { id: 'overview', icon: '&#x2726;', label: 'Overview', mode: 'internal' },
  { id: 'competitors', icon: '&#x1F3C6;', label: 'Competitors', mode: 'internal' },
  { id: 'market-map', icon: '&#x1F5FA;', label: 'Market Map', mode: 'internal' },
  { id: 'gaps', icon: '&#x1F3AF;', label: 'Segment Gaps', mode: 'internal' },
  { id: 'messaging', icon: '&#x1FA84;', label: 'Messaging', mode: 'internal' },
  { id: 'sentiment', icon: '&#x1F4AC;', label: 'Sentiment', mode: 'internal' },
  { id: 'match-tool', icon: '&#x1F50D;', label: 'Match Tool', mode: 'borrower' },
]

export function renderNav(container, activeId, mode, onNavigate) {
  var html = ''
  for (var i = 0; i < NAV_ITEMS.length; i++) {
    var item = NAV_ITEMS[i]
    // In borrower mode, only show match tool; in internal mode, show all internal + match tool
    if (mode === 'borrower' && item.mode !== 'borrower') continue
    var isActive = item.id === activeId ? ' mie-nav-active' : ''
    html += '<button class="mie-nav-item' + isActive + '" data-screen="' + item.id + '">'
      + '<span class="mie-nav-icon">' + item.icon + '</span>'
      + '<span class="mie-nav-label">' + item.label + '</span>'
      + '</button>'
  }
  container.innerHTML = html

  var btns = container.querySelectorAll('.mie-nav-item')
  for (var j = 0; j < btns.length; j++) {
    btns[j].addEventListener('click', function () {
      onNavigate(this.dataset.screen)
    })
  }
}

export function getNavItems() { return NAV_ITEMS }

// GradBridge Market Intelligence Engine — Main App
import './styles/mie.css'
import { renderNav } from './components/nav.js'
import { renderRefreshBar } from './components/refresh-bar.js'
import { renderDashboard } from './screens/dashboard.js'
import { renderMarketMap } from './screens/market-map.js'
import { renderCompetitorDetail } from './screens/competitor-detail.js'
import { renderGaps } from './screens/gaps.js'
import { renderSentiment } from './screens/sentiment-screen.js'
import { renderMessaging } from './screens/messaging.js'
import { renderMatchTool } from './screens/match-tool.js'
import { renderPageCreator, renderCustomPage } from './screens/page-creator.js'
import { getCustomPages } from './lib/mie-data.js'

var state = {
  screen: 'overview',
  mode: 'internal', // 'internal' | 'borrower'
  selectedCompetitor: null,
  selectedPageId: null,
  sidebarOpen: false,
}

// AbortController for cleaning up event listeners between renders
var _screenController = null

function resetListeners() {
  if (_screenController) _screenController.abort()
  _screenController = new AbortController()
  return _screenController.signal
}

var SCREEN_TITLES = {
  overview: 'Overview',
  competitors: 'Competitors',
  'market-map': 'Market Map',
  gaps: 'Segment Gaps',
  messaging: 'Messaging Lab',
  sentiment: 'Sentiment Feed',
  'match-tool': 'Borrower Match Tool',
  'competitor-detail': 'Competitor Detail',
  'page-creator': 'Page Creator',
  'custom-page': 'Custom Page',
}

// Bottom tab bar config — primary tabs shown on mobile
var BOTTOM_TABS_INTERNAL = [
  { id: 'overview', icon: '&#x2726;', label: 'Overview' },
  { id: 'market-map', icon: '&#x1F5FA;', label: 'Map' },
  { id: 'gaps', icon: '&#x1F3AF;', label: 'Gaps' },
  { id: 'sentiment', icon: '&#x1F4AC;', label: 'Sentiment' },
  { id: 'more', icon: '&#x2630;', label: 'More' },
]

var BOTTOM_TABS_BORROWER = [{ id: 'match-tool', icon: '&#x1F50D;', label: 'Match Tool' }]

function navigate(screen, data) {
  state.screen = screen
  if (data) {
    if (data.competitor) state.selectedCompetitor = data.competitor
    if (data.pageId) state.selectedPageId = data.pageId
  }
  render()
}

function setMode(mode) {
  state.mode = mode
  if (mode === 'borrower') {
    state.screen = 'match-tool'
  } else {
    state.screen = 'overview'
  }
  render()
}

function renderShell() {
  var nav = document.getElementById('mie-nav')
  var title = document.getElementById('mie-header-title')
  var alertBadge = document.getElementById('mie-alert-badge')
  var refreshBarEl = document.getElementById('mie-refresh-bar')

  // Update nav
  var customPages = getCustomPages()
  var signal = _screenController ? _screenController.signal : null
  renderNav(
    nav,
    state.screen,
    state.mode,
    function (screenId, data) {
      navigate(screenId, data)
      closeSidebar()
    },
    customPages,
    state.selectedPageId,
    signal
  )

  // Update title
  if (state.screen === 'custom-page' && state.selectedPageId) {
    var page = customPages.find(function (p) {
      return p.id === state.selectedPageId
    })
    title.textContent = page ? page.prompt.substring(0, 40) + (page.prompt.length > 40 ? '...' : '') : 'Custom Page'
  } else {
    title.textContent = SCREEN_TITLES[state.screen] || 'Overview'
  }

  // Show/hide alert badge
  alertBadge.style.display = state.mode === 'borrower' ? 'none' : ''

  // Update mode toggle
  var modeButtons = document.querySelectorAll('.mie-mode-btn')
  for (var i = 0; i < modeButtons.length; i++) {
    modeButtons[i].classList.toggle('active', modeButtons[i].dataset.mode === state.mode)
  }

  // Render refresh bar
  renderRefreshBar(
    refreshBarEl,
    function () {
      render()
    },
    signal
  )

  // Render bottom tab bar
  renderBottomBar()
}

function renderScreen() {
  var signal = resetListeners()
  var content = document.getElementById('mie-content')

  switch (state.screen) {
    case 'overview':
      renderDashboard(content, navigate, signal)
      break
    case 'competitors':
      renderDashboard(content, navigate, signal)
      break
    case 'market-map':
      renderMarketMap(content, signal)
      break
    case 'competitor-detail':
      renderCompetitorDetail(content, state.selectedCompetitor, navigate, signal)
      break
    case 'gaps':
      renderGaps(content, signal)
      break
    case 'sentiment':
      renderSentiment(content, signal)
      break
    case 'messaging':
      renderMessaging(content, signal)
      break
    case 'match-tool':
      renderMatchTool(content, signal)
      break
    case 'page-creator':
      renderPageCreator(content, navigate, signal)
      break
    case 'custom-page':
      renderCustomPage(content, state.selectedPageId, navigate, signal)
      break
    default:
      renderDashboard(content, navigate, signal)
  }

  // Scroll to top on navigation
  if (content) content.scrollTop = 0
}

function render() {
  renderShell()
  renderScreen()
}

function renderBottomBar() {
  var barInner = document.getElementById('mie-bottom-bar-inner')
  if (!barInner) return
  var tabs = state.mode === 'borrower' ? BOTTOM_TABS_BORROWER : BOTTOM_TABS_INTERNAL
  var html = ''
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i]
    // "More" tab is active when current screen isn't in the tab list
    var isActive = false
    if (tab.id === 'more') {
      var tabIds = tabs.map(function (t) {
        return t.id
      })
      isActive = tabIds.indexOf(state.screen) === -1
    } else {
      isActive = state.screen === tab.id
    }
    html += '<button class="mie-tab-btn' + (isActive ? ' active' : '') + '" data-tab="' + tab.id + '">'
    html += '<span class="mie-tab-icon">' + tab.icon + '</span>'
    html += '<span>' + tab.label + '</span>'
    html += '</button>'
  }
  barInner.innerHTML = html
}

function closeSidebar() {
  state.sidebarOpen = false
  document.getElementById('mie-sidebar').classList.remove('open')
  document.getElementById('mie-sidebar-overlay').classList.remove('visible')
  document.body.classList.remove('mie-sidebar-open')
}

function openSidebar() {
  state.sidebarOpen = true
  document.getElementById('mie-sidebar').classList.add('open')
  document.getElementById('mie-sidebar-overlay').classList.add('visible')
  document.body.classList.add('mie-sidebar-open')
}

function init() {
  // Mode toggle
  var modeToggle = document.getElementById('mie-mode-toggle')
  modeToggle.addEventListener('click', function (e) {
    var btn = e.target.closest('.mie-mode-btn')
    if (btn && btn.dataset.mode) setMode(btn.dataset.mode)
  })

  // Mobile menu button (desktop fallback)
  document.getElementById('mie-menu-btn').addEventListener('click', function () {
    if (state.sidebarOpen) {
      closeSidebar()
    } else {
      openSidebar()
    }
  })

  // Close sidebar on overlay click
  document.getElementById('mie-sidebar-overlay').addEventListener('click', function () {
    closeSidebar()
  })

  // Close sidebar on main content click (mobile)
  document.getElementById('mie-main').addEventListener('click', function () {
    if (state.sidebarOpen) closeSidebar()
  })

  // Bottom tab bar
  document.getElementById('mie-bottom-bar-inner').addEventListener('click', function (e) {
    var btn = e.target.closest('.mie-tab-btn')
    if (!btn) return
    var tabId = btn.dataset.tab
    if (tabId === 'more') {
      if (state.sidebarOpen) {
        closeSidebar()
      } else {
        openSidebar()
      }
    } else {
      closeSidebar()
      navigate(tabId)
    }
  })

  render()
}

document.addEventListener('DOMContentLoaded', init)

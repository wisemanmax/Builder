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

var SCREEN_TITLES = {
  'overview': 'Overview',
  'competitors': 'Competitors',
  'market-map': 'Market Map',
  'gaps': 'Segment Gaps',
  'messaging': 'Messaging Lab',
  'sentiment': 'Sentiment Feed',
  'match-tool': 'Borrower Match Tool',
  'competitor-detail': 'Competitor Detail',
  'page-creator': 'Page Creator',
  'custom-page': 'Custom Page',
}

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

function render() {
  var nav = document.getElementById('mie-nav')
  var content = document.getElementById('mie-content')
  var title = document.getElementById('mie-header-title')
  var alertBadge = document.getElementById('mie-alert-badge')
  var refreshBarEl = document.getElementById('mie-refresh-bar')

  // Update nav
  var customPages = getCustomPages()
  renderNav(nav, state.screen, state.mode, function (screenId, data) {
    navigate(screenId, data)
    closeSidebar()
  }, customPages, state.selectedPageId)

  // Update title
  if (state.screen === 'custom-page' && state.selectedPageId) {
    var page = customPages.find(function (p) { return p.id === state.selectedPageId })
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
  renderRefreshBar(refreshBarEl, function () { render() })

  // Render screen
  switch (state.screen) {
    case 'overview':
      renderDashboard(content, navigate)
      break
    case 'competitors':
      renderDashboard(content, navigate) // leaderboard is part of overview
      break
    case 'market-map':
      renderMarketMap(content)
      break
    case 'competitor-detail':
      renderCompetitorDetail(content, state.selectedCompetitor, navigate)
      break
    case 'gaps':
      renderGaps(content)
      break
    case 'sentiment':
      renderSentiment(content)
      break
    case 'messaging':
      renderMessaging(content)
      break
    case 'match-tool':
      renderMatchTool(content)
      break
    case 'page-creator':
      renderPageCreator(content, navigate)
      break
    case 'custom-page':
      renderCustomPage(content, state.selectedPageId, navigate)
      break
    default:
      renderDashboard(content, navigate)
  }
}

function closeSidebar() {
  state.sidebarOpen = false
  document.getElementById('mie-sidebar').classList.remove('open')
}

function init() {
  // Mode toggle
  var modeToggle = document.getElementById('mie-mode-toggle')
  modeToggle.addEventListener('click', function (e) {
    var btn = e.target.closest('.mie-mode-btn')
    if (btn && btn.dataset.mode) setMode(btn.dataset.mode)
  })

  // Mobile menu
  document.getElementById('mie-menu-btn').addEventListener('click', function () {
    state.sidebarOpen = !state.sidebarOpen
    document.getElementById('mie-sidebar').classList.toggle('open', state.sidebarOpen)
  })

  // Close sidebar on click outside on mobile
  document.getElementById('mie-main').addEventListener('click', function () {
    if (state.sidebarOpen) closeSidebar()
  })

  render()
}

document.addEventListener('DOMContentLoaded', init)

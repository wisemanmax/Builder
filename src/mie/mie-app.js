// GradBridge Market Intelligence Engine — Main App
import './styles/mie.css'
import { renderNav } from './components/nav.js'
import { renderDashboard } from './screens/dashboard.js'
import { renderMarketMap } from './screens/market-map.js'
import { renderCompetitorDetail } from './screens/competitor-detail.js'
import { renderGaps } from './screens/gaps.js'
import { renderSentiment } from './screens/sentiment-screen.js'
import { renderMessaging } from './screens/messaging.js'
import { renderMatchTool } from './screens/match-tool.js'

var state = {
  screen: 'overview',
  mode: 'internal', // 'internal' | 'borrower'
  selectedCompetitor: null,
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
}

function navigate(screen, data) {
  state.screen = screen
  if (data) {
    if (data.competitor) state.selectedCompetitor = data.competitor
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

  // Update nav
  renderNav(nav, state.screen, state.mode, function (screenId) {
    navigate(screenId)
    closeSidebar()
  })

  // Update title
  title.textContent = SCREEN_TITLES[state.screen] || 'Overview'

  // Show/hide alert badge
  alertBadge.style.display = state.mode === 'borrower' ? 'none' : ''

  // Update mode toggle
  var modeButtons = document.querySelectorAll('.mie-mode-btn')
  for (var i = 0; i < modeButtons.length; i++) {
    modeButtons[i].classList.toggle('active', modeButtons[i].dataset.mode === state.mode)
  }

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

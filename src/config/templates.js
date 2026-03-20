// Template categories for the gallery filter
export const TEMPLATE_CATEGORIES = [
  { id: 'productivity', name: 'Productivity', icon: '\u26A1' },
  { id: 'games', name: 'Games', icon: '\uD83C\uDFAE' },
  { id: 'dashboards', name: 'Dashboards', icon: '\uD83D\uDCCA' },
  { id: 'landing', name: 'Landing Pages', icon: '\uD83C\uDF10' },
  { id: 'portfolios', name: 'Portfolios', icon: '\uD83C\uDFA8' },
  { id: 'tools', name: 'Tools', icon: '\uD83D\uDD27' },
]

// Each template references an external HTML skeleton in public/templates/{id}.html
// Skeletons are loaded on demand via getTemplateSkeleton() from lib/template-loader.js
export const TEMPLATES = [
  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    icon: '\uD83D\uDD25',
    category: 'productivity',
    desc: 'Daily habits with streaks and calendar heatmap',
  },
  {
    id: 'pomodoro',
    name: 'Pomodoro Timer',
    icon: '\u23F1\uFE0F',
    category: 'productivity',
    desc: 'Focus timer with intervals and session history',
  },
  {
    id: 'kanban',
    name: 'Kanban Board',
    icon: '\uD83D\uDCCB',
    category: 'productivity',
    desc: 'Drag-and-drop task board with columns',
  },
  {
    id: 'quiz-game',
    name: 'Quiz Game',
    icon: '\uD83E\uDDE0',
    category: 'games',
    desc: 'Interactive quiz with scoring and categories',
  },
  {
    id: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    icon: '\uD83D\uDCCA',
    category: 'dashboards',
    desc: 'Data dashboard with charts and KPI cards',
  },
  {
    id: 'weather-app',
    name: 'Weather App',
    icon: '\u26C5',
    category: 'dashboards',
    desc: 'Weather dashboard with forecasts and conditions',
  },
  {
    id: 'portfolio',
    name: 'Portfolio Site',
    icon: '\uD83C\uDFA8',
    category: 'portfolios',
    desc: 'Personal portfolio with projects and contact',
  },
  {
    id: 'landing-page',
    name: 'SaaS Landing Page',
    icon: '\uD83D\uDE80',
    category: 'landing',
    desc: 'Product landing page with features and pricing',
  },
  {
    id: 'calculator',
    name: 'Calculator',
    icon: '\uD83E\uDDEE',
    category: 'tools',
    desc: 'Scientific calculator with history',
  },
  {
    id: 'budget-tracker',
    name: 'Budget Tracker',
    icon: '\uD83D\uDCB0',
    category: 'productivity',
    desc: 'Expense tracking with categories and charts',
  },
  {
    id: 'recipe-book',
    name: 'Recipe Book',
    icon: '\uD83C\uDF73',
    category: 'tools',
    desc: 'Recipe collection with search and meal planning',
  },
  {
    id: 'mood-journal',
    name: 'Mood Journal',
    icon: '\uD83C\uDF19',
    category: 'productivity',
    desc: 'Daily mood tracking with emoji ratings and insights',
  },
]

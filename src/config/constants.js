export const GRADS = [
  'linear-gradient(135deg,#3D5AFE,#00E5FF)',
  'linear-gradient(135deg,#FF3CAC,#784BA0)',
  'linear-gradient(135deg,#FF5252,#FFD600)',
  'linear-gradient(135deg,#AAFF00,#00C2FF)',
  'linear-gradient(135deg,#FF9F43,#FF3CAC)',
  'linear-gradient(135deg,#B44FFF,#3D5AFE)',
]

export const EMOJIS = [
  '🎯','📊','💰','🏋️','📝','⏰','🎵','🎨','📚','🌱',
  '🚀','💡','🔥','⭐','🎮','🍎','🧠','💪','🌙','🌞',
  '📅','🎭','🧪','🔑','💎','🏆','🎲','🌍','🎤','🎸',
  '🐉','🦋','🌺','🍕','☕','🎪','🔮','🧩','🪄','💻',
  '📱','🔧','🏠','🚗','✈️','🛸','🌈','🦁','🐋','🎃',
  '👑','🍭','🌊','⚡','🎁','🧲','🪐','🎬','🖌️','🧬',
]

export const PIPE_NAMES = [
  'Create Branch',
  'Claude \u00B7 Plan',
  'Claude \u00B7 Build',
  'Automated Checks',
  'GPT-4o \u00B7 Audit',
  'Claude \u00B7 Fix',
  'GPT-4o \u00B7 Enhancement Review',
  'Claude \u00B7 Enhance',
  'GPT-4o \u00B7 Final Review',
  '\uD83D\uDDC4 Backend Setup',
  'Push to Branch',
  'Preview',
  'Final Validation',
  'Merge to Main',
]

export const PIPE_ICONS = [
  '\uD83C\uDF3F', '\uD83D\uDCDD', '\uD83D\uDD28', '\uD83D\uDCCB', '\uD83D\uDD0D',
  '\uD83D\uDEE0', '\uD83D\uDCA1', '\u2728', '\uD83D\uDD0E',
  '\uD83D\uDDC4\uFE0F', '\u2B06\uFE0F', '\uD83D\uDC41',
  '\u2705', '\uD83D\uDD00',
]

export const THINK_ROUND_LABELS = [
  'What to Build', 'Who & How', 'Differentiators', 'Boundaries', 'Confirm & Lock',
]

export const MAX_FIX_PASSES = 2

export const KEY_STORE = {
  ANTH: 'bldr_key',
  GPT: 'bldr_gptKey',
  GH_TOKEN: 'bldr_ghToken',
  GH_USER: 'bldr_ghUser',
  GH_REPO: 'bldr_ghRepo',
  GH_DOMAIN: 'bldr_ghDomain',
  SB_URL: 'bldr_sbUrl',
  SB_ANON: 'bldr_sbAnon',
  SB_ON: 'bldr_sbOn',
  AUDIT: 'bldr_audit',
  BACKEND: 'bldr_backend',
  PIPELINE: 'bldr_pipeline',
  W2_PROVIDER: 'bldr_w2provider',
}

export const PIPE2_NAMES = [
  'Claude \u00B7 Plan',
  'Claude \u00B7 Build',
  'Automated Checks',
  'Claude \u00B7 Audit',
  'Claude \u00B7 Fix',
  'Push to Branch',
  'Preview',
  'Final Validation',
  'Merge to Main',
]

export const PIPE2_ICONS = [
  '\uD83D\uDCDD', '\uD83D\uDD28', '\uD83D\uDCCB', '\uD83D\uDD0D',
  '\uD83D\uDEE0', '\u2B06\uFE0F', '\uD83D\uDC41',
  '\u2705', '\uD83D\uDD00',
]

export const PIPE3_NAMES = [
  'Claude \u00B7 Decompose',
  'Claude \u00B7 Scaffold',
  'Claude \u00B7 Design Tokens',
  'Claude \u00B7 Data Layer',
  'Claude \u00B7 Shared Components',
  'Claude \u00B7 Feature Components',
  'Claude \u00B7 Layout Components',
  'Claude \u00B7 Pages',
  'Claude \u00B7 Routing',
  'Claude \u00B7 Documentation',
  'Push to Branch',
  'Preview',
  'Final Validation',
  'Merge to Main',
]

export const PIPE3_ICONS = [
  '\uD83E\uDDE9', '\uD83C\uDFD7', '\uD83C\uDFA8', '\uD83D\uDDC3',
  '\uD83E\uDDF1', '\u2699\uFE0F', '\uD83D\uDDBC', '\uD83D\uDCC4',
  '\uD83D\uDEA6', '\uD83D\uDCDD',
  '\u2B06\uFE0F', '\uD83D\uDC41',
  '\u2705', '\uD83D\uDD00',
]

export const PIPE4_NAMES = [
  'AI \u00B7 Recon',
  'AI \u00B7 Brand Extraction',
  'AI \u00B7 Structure Map',
  'AI \u00B7 Design Decisions',
  'AI \u00B7 Build',
  'Automated Checks',
  'AI \u00B7 Audit',
  'AI \u00B7 Fix',
  'Push to Branch',
  'Preview',
  'Final Validation',
  'Merge to Main',
]

export const PIPE4_ICONS = [
  '\uD83D\uDD0D', '\uD83C\uDFA8', '\uD83D\uDDFA', '\uD83C\uDFA8', '\uD83D\uDD28', '\uD83D\uDCCB',
  '\uD83D\uDD0E', '\uD83D\uDEE0', '\u2B06\uFE0F', '\uD83D\uDC41',
  '\u2705', '\uD83D\uDD00',
]

export const SELFUPDATE_STEPS = ['Fetch Source', 'Claude \u00B7 Improve', 'Push to GitHub', 'Reload']
export const SELFUPDATE_ICONS = ['\uD83D\uDCE5', '\uD83D\uDD28', '\u2B06\uFE0F', '\uD83D\uDD04']

// Cost analyzer pricing — per 1M tokens (USD)
export var COST_RATES = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
}
export var COST_MARKUP = 7

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
  'Claude \u00B7 Build',
  'Automated Checks',
  'GPT-4o \u00B7 Audit',
  'Claude \u00B7 Fix',
  '\uD83D\uDDC4 Backend Setup',
  'Push to Branch',
  'Preview',
  'Final Validation',
  'Merge to Main',
]

export const PIPE_ICONS = [
  '\uD83C\uDF3F', '\uD83D\uDD28', '\uD83D\uDCCB', '\uD83D\uDD0D',
  '\uD83D\uDEE0', '\uD83D\uDDC4\uFE0F', '\u2B06\uFE0F', '\uD83D\uDC41',
  '\u2705', '\uD83D\uDD00',
]

export const THINK_ROUND_LABELS = [
  'What to Build', 'Who & How', 'Differentiators', 'Boundaries', 'Confirm & Lock',
]

export const PIPE_ESTIMATES = [
  '~2s',   // 0: Create Branch
  '~20s',  // 1: Claude Build
  '~1s',   // 2: Checks
  '~8s',   // 3: GPT Audit
  '~15s',  // 4: Claude Fix
  '~10s',  // 5: Backend
  '~3s',   // 6: Push
  '~1s',   // 7: Preview
  '',       // 8: Approval (user-dependent)
  '~3s',   // 9: Merge
]

export const MAX_FIX_PASSES = 3

export const KEY_STORE = {
  ANTH: 'bldr_key',
  GPT: 'bldr_gptKey',
  GH_TOKEN: 'bldr_ghToken',
  GH_USER: 'bldr_ghUser',
  GH_REPO: 'bldr_ghRepo',
  SB_URL: 'bldr_sbUrl',
  SB_ANON: 'bldr_sbAnon',
  SB_ON: 'bldr_sbOn',
  AUDIT: 'bldr_audit',
  BACKEND: 'bldr_backend',
}

export const SELFUPDATE_STEPS = ['Fetch Source', 'Claude \u00B7 Improve', 'Push to GitHub', 'Reload']
export const SELFUPDATE_ICONS = ['\uD83D\uDCE5', '\uD83D\uDD28', '\u2B06\uFE0F', '\uD83D\uDD04']

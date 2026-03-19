import { KEY_STORE } from '../config/constants.js'

export const ST = {
  apps: [],
  key: '', gptKey: '', stitchKey: '',
  ghToken: '', ghUser: '', ghRepo: '', ghCustomDomain: '',
  sbUrl: '', sbAnon: '', sbEnabled: false, auditEnabled: true,
  backendEnabled: false,
  website2Provider: 'claude',
  activeAppId: null, pendingIcon: '🎯', pendingColor: 0,
  viewingApp: null, projectAppId: null, _building: false,
  _studioFullscreen: false,
  thoughts: [], rules: [], activeThoughtId: null, _thinking: false,
  profiles: [], activeProfileId: null,
  _selfUpdateMode: false,
  _pendingTemplate: null,
  pipelineMode: 'builder1',
  _pipelineCancelRequested: false,
}

export function persist() {
  try {
    localStorage.setItem('bldr_apps', JSON.stringify(ST.apps))
    localStorage.setItem('bldr_thoughts', JSON.stringify(ST.thoughts))
    localStorage.setItem('bldr_rules', JSON.stringify(ST.rules))
    localStorage.setItem('bldr_profiles', JSON.stringify(ST.profiles))
  } catch (e) {
    if (e.name === 'QuotaExceededError' || String(e.name).indexOf('QuotaExceeded') >= 0 || e.code === 22) {
      try {
        var slim = ST.apps.map(function (a) { return Object.assign({}, a, { versions: [] }) })
        localStorage.setItem('bldr_apps', JSON.stringify(slim))
        // toast imported where needed, not here to avoid circular deps
        console.warn('Storage nearly full — version history cleared')
      } catch (e2) {
        console.warn('Storage full — delete old apps to free space.')
      }
    }
  }
}

// Detect mojibake icons (corrupted UTF-8 emoji decoded as Latin-1)
function isBadIcon(icon) {
  if (!icon || typeof icon !== 'string') return true
  // Mojibake from UTF-8 → Latin-1 misinterpretation produces Â, Ã, etc.
  if (/[\u00C0-\u00FF]{2,}/.test(icon)) return true
  // Valid emoji icons should be short (≤ 8 chars covers ZWJ sequences)
  if (icon.length > 8) return true
  return false
}

export function hydrate() {
  try { ST.apps = JSON.parse(localStorage.getItem('bldr_apps') || '[]') } catch (e) { ST.apps = [] }
  var iconFixed = false
  for (var i = 0; i < ST.apps.length; i++) {
    if (isBadIcon(ST.apps[i].icon)) {
      ST.apps[i].icon = '\uD83D\uDCE6'
      iconFixed = true
    }
  }
  if (iconFixed) {
    try { localStorage.setItem('bldr_apps', JSON.stringify(ST.apps)) } catch (e) {}
  }
  try { ST.thoughts = JSON.parse(localStorage.getItem('bldr_thoughts') || '[]') } catch (e) { ST.thoughts = [] }
  try { ST.rules = JSON.parse(localStorage.getItem('bldr_rules') || '[]') } catch (e) { ST.rules = [] }
  try { ST.profiles = JSON.parse(localStorage.getItem('bldr_profiles') || '[]') } catch (e) { ST.profiles = [] }
  ST.activeProfileId = localStorage.getItem('bldr_activeProfile') || null
  ST.key = localStorage.getItem(KEY_STORE.ANTH) || ''
  ST.gptKey = localStorage.getItem(KEY_STORE.GPT) || ''
  ST.stitchKey = localStorage.getItem(KEY_STORE.STITCH) || ''
  ST.ghToken = localStorage.getItem(KEY_STORE.GH_TOKEN) || ''
  ST.ghUser = localStorage.getItem(KEY_STORE.GH_USER) || ''
  ST.ghRepo = localStorage.getItem(KEY_STORE.GH_REPO) || ''
  ST.ghCustomDomain = localStorage.getItem(KEY_STORE.GH_DOMAIN) || ''
  ST.sbUrl = localStorage.getItem(KEY_STORE.SB_URL) || ''
  ST.sbAnon = localStorage.getItem(KEY_STORE.SB_ANON) || ''
  ST.sbEnabled = localStorage.getItem(KEY_STORE.SB_ON) === 'true'
  ST.auditEnabled = localStorage.getItem(KEY_STORE.AUDIT) !== 'false'
  ST.backendEnabled = localStorage.getItem(KEY_STORE.BACKEND) === 'true'
  ST.pipelineMode = localStorage.getItem(KEY_STORE.PIPELINE) || 'builder1'
  ST.website2Provider = localStorage.getItem(KEY_STORE.W2_PROVIDER) || 'claude'
}

export function saveKeys() {
  localStorage.setItem(KEY_STORE.ANTH, ST.key)
  localStorage.setItem(KEY_STORE.GPT, ST.gptKey)
  localStorage.setItem(KEY_STORE.STITCH, ST.stitchKey)
  localStorage.setItem(KEY_STORE.GH_TOKEN, ST.ghToken)
  localStorage.setItem(KEY_STORE.GH_USER, ST.ghUser)
  localStorage.setItem(KEY_STORE.GH_REPO, ST.ghRepo)
  localStorage.setItem(KEY_STORE.GH_DOMAIN, ST.ghCustomDomain)
  localStorage.setItem(KEY_STORE.SB_URL, ST.sbUrl)
  localStorage.setItem(KEY_STORE.SB_ANON, ST.sbAnon)
  localStorage.setItem(KEY_STORE.SB_ON, String(ST.sbEnabled))
  localStorage.setItem(KEY_STORE.AUDIT, String(ST.auditEnabled))
  localStorage.setItem(KEY_STORE.BACKEND, String(ST.backendEnabled))
  localStorage.setItem(KEY_STORE.PIPELINE, ST.pipelineMode)
  localStorage.setItem(KEY_STORE.W2_PROVIDER, ST.website2Provider)
}

export function setActiveProfile(id) {
  ST.activeProfileId = id
  if (id) localStorage.setItem('bldr_activeProfile', id)
  else localStorage.removeItem('bldr_activeProfile')
}

export function getActiveProfile() {
  if (!ST.activeProfileId) return null
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === ST.activeProfileId) return ST.profiles[i]
  }
  return null
}

// --- Pipeline cancellation ---
export function requestPipelineCancel() {
  ST._pipelineCancelRequested = true
}
export function clearPipelineCancel() {
  ST._pipelineCancelRequested = false
}
export function checkPipelineCancel() {
  if (ST._pipelineCancelRequested) {
    throw new Error('PIPELINE_CANCELLED')
  }
}

// --- Active build session persistence ---
// Saves in-progress build state so it survives crashes/closes
export function persistBuildSession(data) {
  try {
    localStorage.setItem('bldr_active_build', JSON.stringify(data))
  } catch (e) { /* quota exceeded — non-critical */ }
}

export function hydrateBuildSession() {
  try {
    var raw = localStorage.getItem('bldr_active_build')
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}

export function clearBuildSession() {
  try { localStorage.removeItem('bldr_active_build') } catch (e) {}
}

export function keyStatusHTML() {
  var items = [
    ['Anthropic', ST.key], ['OpenAI', ST.gptKey], ['Stitch', ST.stitchKey],
    ['GitHub Token', ST.ghToken], ['Supabase Anon', ST.sbAnon],
  ]
  var rows = ''
  for (var i = 0; i < items.length; i++) {
    var label = items[i][0], val = items[i][1]
    var redacted = !val || val.length < 8 ? (val ? '••••••••' : '(not set)') : val.slice(0, 6) + '••••••••' + val.slice(-4)
    rows += '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px">'
      + '<span style="font-size:11px;color:rgba(255,255,255,.5)">' + label + '</span>'
      + '<span style="font-family:var(--fm);font-size:10px;color:' + (val ? 'var(--mn)' : 'rgba(255,255,255,.25)') + '">' + redacted + '</span>'
      + '</div>'
  }
  return '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:2px">Where keys are stored</div>'
    + '<div style="background:rgba(0,230,118,.08);border:1.5px solid rgba(0,230,118,.2);border-radius:10px;padding:11px 13px;font-size:11px;color:rgba(255,255,255,.7);line-height:1.7">'
    + '\uD83D\uDD12 <strong style="color:#fff">Device only \u2014 localStorage</strong><br>'
    + 'Keys are never uploaded, synced, logged, or included in any file pushed to GitHub.</div>'
    + '<div style="display:flex;flex-direction:column;gap:6px">' + rows + '</div></div>'
}

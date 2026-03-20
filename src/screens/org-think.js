import { ST, persist } from '../lib/state.js'
import { $, esc, uid, toast, scrubKeys } from '../lib/utils.js'
import { SYS_ORG_THINK } from '../config/prompts.js'
import { callGPTThink, callClaudeRaw } from '../lib/ai.js'
import { injectProfileContext } from '../lib/profile-context.js'
import { renderProfileChip } from '../components/profile-switcher.js'

var ORG_ROUND_LABELS = ['Vision & Mission', 'Principles & Standards', 'Brand Identity', 'Roadmap & Future']
var _orgState = { round: 1, maxRounds: 4, profileId: null, conversation: [], originalPrompt: '', done: false }

export function openOrgThink(profileId) {
  if (!profileId) { toast('Create a profile first'); return }
  var profile = null
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === profileId) { profile = ST.profiles[i]; break }
  }
  if (!profile) { toast('Profile not found'); return }

  _orgState = { round: 1, maxRounds: 4, profileId: profileId, conversation: [], originalPrompt: profile.name, done: false }
  renderOrgProgress(1)
  var scroll = $('org-think-scroll')
  scroll.innerHTML = '<div class="think-welcome">'
    + '<div class="tw-icon">\uD83C\uDFE2</div>'
    + '<div class="tw-title">Set Up ' + esc(profile.name) + '</div>'
    + '<div class="tw-sub">I\'ll help you define your org identity in 4 quick rounds. This context will guide every future build.</div>'
    + '</div>'
  $('org-think-sheet').classList.add('open')
  setTimeout(function () { $('org-think-input').focus() }, 420)
}

export function closeOrgThink() {
  $('org-think-sheet').classList.remove('open')
}

export function renderOrgProgress(round) {
  var el = $('org-ts-progress')
  var html = ''
  for (var i = 1; i <= _orgState.maxRounds; i++) {
    var cls = 'ts-dot'
    if (i < round) cls += ' done'
    else if (i === round) cls += ' active'
    html += '<div class="' + cls + '"></div>'
  }
  el.innerHTML = html
  var label = ORG_ROUND_LABELS[Math.min(round, _orgState.maxRounds) - 1] || ''
  $('org-ts-sub').textContent = 'Round ' + Math.min(round, _orgState.maxRounds) + ' of ' + _orgState.maxRounds + ' \u00B7 ' + label
}

function scrollOrgBot() { var el = $('org-think-scroll'); setTimeout(function () { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, 60) }

function addOrgMsg(cfg) {
  var s = $('org-think-scroll')
  var w = s.querySelector('.think-welcome'); if (w) w.style.display = 'none'
  var row = document.createElement('div')
  if (cfg.type === 'user') {
    row.className = 'mrow user'
    row.innerHTML = '<div class="ubub" style="background:var(--g2);color:#fff">' + esc(cfg.text) + '</div>'
  } else if (cfg.type === 'typing') {
    row.className = 'mrow asst'
    row.id = 'org-think-typing'
    row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--g2)">\uD83C\uDFE2</div><div class="tbub"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>'
  } else if (cfg.type === 'ai') {
    row.className = 'mrow asst'
    row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--g2)">\uD83C\uDFE2</div><div class="abub">' + esc(cfg.text) + '</div></div>'
  } else if (cfg.type === 'options') {
    row.className = 'think-options'
    var ohtml = ''
    for (var i = 0; i < cfg.options.length; i++) {
      ohtml += '<div class="think-opt" style="border-color:rgba(61,90,254,.3);background:rgba(61,90,254,.08)" onclick="orgOptionSelect(this)">' + esc(cfg.options[i]) + '</div>'
    }
    row.innerHTML = ohtml
  } else if (cfg.type === 'summary') {
    row.className = ''
    row.innerHTML = cfg.html
  }
  s.appendChild(row)
  scrollOrgBot()
  return row
}

export function orgOptionSelect(el) {
  var text = el.textContent
  el.classList.add('selected')
  var siblings = el.parentElement.querySelectorAll('.think-opt')
  for (var i = 0; i < siblings.length; i++) { if (siblings[i] !== el) siblings[i].classList.add('disabled') }
  $('org-think-input').value = text
  sendOrgMsg()
}

export function sendOrgMsg() {
  var inp = $('org-think-input')
  var text = inp.value.trim()
  if (!text || _orgState.done) return

  if (!ST.gptKey) { toast('Add an OpenAI API key in Settings first'); return }

  var sb = $('org-think-send-btn'); if (sb) sb.disabled = true
  inp.value = ''; inp.style.height = ''

  if (!_orgState.originalPrompt) _orgState.originalPrompt = text
  addOrgMsg({ type: 'user', text: text })
  _orgState.conversation.push({ role: 'user', text: text, round: _orgState.round })
  addOrgMsg({ type: 'typing' })

  // Build multi-turn messages from history (exclude last entry — it's the current message)
  var apiMessages = []
  for (var i = 0; i < _orgState.conversation.length - 1; i++) {
    var c = _orgState.conversation[i]
    apiMessages.push({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text })
  }
  // Add current message with round metadata (single source — no duplication)
  apiMessages.push({
    role: 'user',
    content: 'Round: ' + _orgState.round + '/' + _orgState.maxRounds
      + '\nPhase: ' + ORG_ROUND_LABELS[Math.min(_orgState.round, _orgState.maxRounds) - 1]
      + '\nOrganization name: ' + _orgState.originalPrompt
      + '\n\n' + text
  })

  var effectiveSys = injectProfileContext(SYS_ORG_THINK)
  var aiCall = callGPTThink(effectiveSys, apiMessages, 2000)

  aiCall.then(function (raw) {
    var ti = $('org-think-typing'); if (ti) ti.remove()
    var parsed
    try { parsed = JSON.parse(raw) } catch (e) {
      parsed = { message: raw, options: [], advance: false }
    }

    if (parsed.message) {
      addOrgMsg({ type: 'ai', text: parsed.message })
      _orgState.conversation.push({ role: 'ai', text: parsed.message, round: _orgState.round })
    }

    if (parsed.advance) {
      _orgState.round++
      renderOrgProgress(_orgState.round)
    }

    if (parsed.profile && parsed.globalRules) {
      _orgState.done = true
      _saveOrgProfile(parsed.profile, parsed.globalRules)
      renderOrgSummary(parsed.profile, parsed.globalRules)
    } else if (parsed.options && parsed.options.length > 0) {
      addOrgMsg({ type: 'options', options: parsed.options })
    }

    if (sb) sb.disabled = false
    scrollOrgBot()
  }).catch(function (e) {
    var ti = $('org-think-typing'); if (ti) ti.remove()
    addOrgMsg({ type: 'ai', text: 'Something went wrong: ' + scrubKeys(e.message || String(e)) + '. Try again.' })
    if (sb) sb.disabled = false
  })
}

function _saveOrgProfile(profileData, rulesData) {
  var profile = null
  for (var i = 0; i < ST.profiles.length; i++) {
    if (ST.profiles[i].id === _orgState.profileId) { profile = ST.profiles[i]; break }
  }
  if (!profile) return

  profile.orgProfile = {
    vision: profileData.vision || '',
    principles: Array.isArray(profileData.principles) ? profileData.principles : [],
    brandIdentity: {
      theme: (profileData.brandIdentity && profileData.brandIdentity.theme) || 'dark',
      accentColor: (profileData.brandIdentity && profileData.brandIdentity.accentColor) || '',
      fonts: (profileData.brandIdentity && profileData.brandIdentity.fonts) || '',
      tone: (profileData.brandIdentity && profileData.brandIdentity.tone) || ''
    },
    roadmap: Array.isArray(profileData.roadmap) ? profileData.roadmap : []
  }

  profile.globalRules = {
    mustRules: Array.isArray(rulesData.mustRules) ? rulesData.mustRules : [],
    mustNotRules: Array.isArray(rulesData.mustNotRules) ? rulesData.mustNotRules : [],
    niceToHave: Array.isArray(rulesData.niceToHave) ? rulesData.niceToHave : []
  }

  profile.updatedAt = new Date().toISOString()
  persist()
}

function renderOrgSummary(profileData, rulesData) {
  var html = '<div class="think-summary">'
  html += '<h3>\uD83C\uDFE2 Organization Profile</h3>'

  if (profileData.vision) html += '<h4>Vision</h4><p style="font-size:12px;color:rgba(255,255,255,.7);line-height:1.6;padding:0 16px">' + esc(profileData.vision) + '</p>'
  if (profileData.principles && profileData.principles.length) {
    html += '<h4>Principles</h4><ul>'
    for (var i = 0; i < profileData.principles.length; i++) html += '<li>' + esc(profileData.principles[i]) + '</li>'
    html += '</ul>'
  }
  if (profileData.brandIdentity) {
    html += '<h4>Brand</h4><div class="ts-design">'
    if (profileData.brandIdentity.theme) html += '<span class="ts-tag">' + esc(profileData.brandIdentity.theme) + ' theme</span>'
    if (profileData.brandIdentity.accentColor) html += '<span class="ts-tag">' + esc(profileData.brandIdentity.accentColor) + '</span>'
    if (profileData.brandIdentity.tone) html += '<span class="ts-tag">' + esc(profileData.brandIdentity.tone) + '</span>'
    html += '</div>'
  }
  if (rulesData.mustRules && rulesData.mustRules.length) {
    html += '<h4>Must Do</h4><ul>'
    for (var m = 0; m < rulesData.mustRules.length; m++) html += '<li>' + esc(rulesData.mustRules[m]) + '</li>'
    html += '</ul>'
  }
  if (rulesData.mustNotRules && rulesData.mustNotRules.length) {
    html += '<h4>Must Not</h4><ul>'
    for (var n = 0; n < rulesData.mustNotRules.length; n++) html += '<li>' + esc(rulesData.mustNotRules[n]) + '</li>'
    html += '</ul>'
  }
  html += '</div>'
  addOrgMsg({ type: 'summary', html: html })

  var actRow = document.createElement('div')
  actRow.className = 'think-actions'
  actRow.innerHTML = '<button class="ta-save" style="background:var(--g2)" onclick="finishOrgThink()">\uD83C\uDFE2 Save Profile</button>'
    + '<button class="ta-refine" onclick="refineOrgThink()">\u270F\uFE0F Keep Refining</button>'
  $('org-think-scroll').appendChild(actRow)
  scrollOrgBot()
}

export function finishOrgThink() {
  closeOrgThink()
  renderProfileChip()
  toast('Organization profile saved \u2713', 3000)
}

export function refineOrgThink() {
  _orgState.round = Math.max(1, _orgState.round - 1)
  _orgState.done = false
  renderOrgProgress(_orgState.round)
  // Inject context marker so AI understands the round reset
  _orgState.conversation.push({ role: 'user', text: '[Round reset to ' + _orgState.round + '. Previous profile was rejected. Continue refining from this round.]', round: _orgState.round })
  addOrgMsg({ type: 'ai', text: 'No problem! Let\'s refine. What would you like to change?' })
  _orgState.conversation.push({ role: 'ai', text: 'Let\'s refine. What would you like to change?', round: _orgState.round })
  scrollOrgBot()
}

export function initOrgThinkSheet() {
  var closeBtn = $('org-ts-close')
  if (closeBtn) closeBtn.addEventListener('click', closeOrgThink)
  var sheet = $('org-think-sheet')
  if (sheet) sheet.addEventListener('click', function (e) { if (e.target.id === 'org-think-sheet') closeOrgThink() })
  var inp = $('org-think-input')
  if (inp) {
    inp.addEventListener('input', function () { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 160) + 'px' })
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrgMsg() } })
  }
  var sendBtn = $('org-think-send-btn')
  if (sendBtn) sendBtn.addEventListener('click', sendOrgMsg)
}

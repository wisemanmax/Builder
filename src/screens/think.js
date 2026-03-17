import { ST, persist } from '../lib/state.js'
import { $, esc, uid, toast, scrubKeys } from '../lib/utils.js'
import { THINK_ROUND_LABELS } from '../config/constants.js'
import { SYS_THINK } from '../config/prompts.js'
import { callClaudeRawMultiTurn } from '../lib/ai.js'
import { ghSyncThoughtAndRules } from '../lib/github.js'
import { openBuilder } from './build.js'

var _thinkState = { round: 1, maxRounds: 5, thoughtId: null, conversation: [], originalPrompt: '', brief: null, rules: null }

export function openThink(resumeId) {
  $('builder-sheet').classList.remove('open')
  if (resumeId) {
    var t = null; for (var i = 0; i < ST.thoughts.length; i++) { if (ST.thoughts[i].id === resumeId) { t = ST.thoughts[i]; break } }
    if (t) {
      _thinkState = { round: t.rounds || 1, maxRounds: 5, thoughtId: t.id, conversation: t.conversation || [], originalPrompt: t.originalPrompt || '', brief: t.brief || null, rules: null }
      renderThinkProgress(_thinkState.round)
      var ts = $('think-scroll'); ts.innerHTML = ''
      for (var j = 0; j < _thinkState.conversation.length; j++) {
        var c = _thinkState.conversation[j]
        addThinkMsg(c.role === 'user' ? { type: 'user', text: c.text } : { type: 'ai', text: c.text })
      }
      $('think-sheet').classList.add('open')
      setTimeout(function () { $('think-input').focus() }, 420)
      return
    }
  }
  _thinkState = { round: 1, maxRounds: 5, thoughtId: uid(), conversation: [], originalPrompt: '', brief: null, rules: null }
  renderThinkProgress(1)
  var ts2 = $('think-scroll')
  ts2.innerHTML = '<div class="think-welcome">'
    + '<div class="tw-icon">\uD83D\uDCAD</div>'
    + '<div class="tw-title">Think It Through</div>'
    + '<div class="tw-sub">Describe your app idea and I\'ll help you flesh it out in a few quick rounds before building.</div>'
    + '</div>'
  $('think-sheet').classList.add('open')
  setTimeout(function () { $('think-input').focus() }, 420)
}

export function closeThink() {
  if (_thinkState.conversation.length > 0) saveThought('draft')
  $('think-sheet').classList.remove('open')
  ST._thinking = false
}

export function renderThinkProgress(round) {
  var el = $('ts-progress')
  var html = ''
  for (var i = 1; i <= _thinkState.maxRounds; i++) {
    var cls = 'ts-dot'
    if (i < round) cls += ' done'
    else if (i === round) cls += ' active'
    html += '<div class="' + cls + '"></div>'
  }
  el.innerHTML = html
  var label = THINK_ROUND_LABELS[Math.min(round, _thinkState.maxRounds) - 1] || ''
  $('ts-sub').textContent = 'Round ' + Math.min(round, _thinkState.maxRounds) + ' of ' + _thinkState.maxRounds + ' \u00B7 ' + label
}

function scrollThinkBot() { var el = $('think-scroll'); setTimeout(function () { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, 60) }

export function addThinkMsg(cfg) {
  var s = $('think-scroll')
  var w = s.querySelector('.think-welcome'); if (w) w.style.display = 'none'
  var row = document.createElement('div')
  if (cfg.type === 'user') {
    row.className = 'mrow user'
    row.innerHTML = '<div class="ubub" style="background:var(--g4);color:#000">' + esc(cfg.text) + '</div>'
  } else if (cfg.type === 'typing') {
    row.className = 'mrow asst'
    row.id = 'think-typing'
    row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--g4)">\uD83D\uDCAD</div><div class="tbub"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>'
  } else if (cfg.type === 'ai') {
    row.className = 'mrow asst'
    row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--g4)">\uD83D\uDCAD</div><div class="abub">' + esc(cfg.text) + '</div></div>'
  } else if (cfg.type === 'options') {
    row.className = 'think-options'
    var ohtml = ''
    for (var i = 0; i < cfg.options.length; i++) {
      ohtml += '<div class="think-opt" onclick="thinkOptionSelect(this)">' + esc(cfg.options[i]) + '</div>'
    }
    row.innerHTML = ohtml
  } else if (cfg.type === 'summary') {
    row.className = ''
    row.innerHTML = cfg.html
  }
  s.appendChild(row)
  scrollThinkBot()
  return row
}

export function thinkOptionSelect(el) {
  var text = el.textContent
  el.classList.add('selected')
  var siblings = el.parentElement.querySelectorAll('.think-opt')
  for (var i = 0; i < siblings.length; i++) { if (siblings[i] !== el) siblings[i].classList.add('disabled') }
  $('think-input').value = text
  sendThinkMsg()
}

export function sendThinkMsg() {
  var inp = $('think-input')
  var text = inp.value.trim()
  if (!text || ST._thinking) return
  if (!ST.key) { toast('Add your Anthropic API key in Settings first'); return }

  ST._thinking = true
  var sb = $('think-send-btn'); if (sb) sb.disabled = true
  inp.value = ''; inp.style.height = ''

  if (!_thinkState.originalPrompt) _thinkState.originalPrompt = text

  addThinkMsg({ type: 'user', text: text })
  _thinkState.conversation.push({ role: 'user', text: text, round: _thinkState.round })

  addThinkMsg({ type: 'typing' })

  // Build proper multi-turn messages from conversation history
  var apiMessages = []
  for (var i = 0; i < _thinkState.conversation.length; i++) {
    var c = _thinkState.conversation[i]
    apiMessages.push({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text })
  }
  // Add current user message with round metadata
  apiMessages.push({
    role: 'user',
    content: 'Round: ' + _thinkState.round + '/' + _thinkState.maxRounds
      + '\nPhase: ' + THINK_ROUND_LABELS[Math.min(_thinkState.round, _thinkState.maxRounds) - 1]
      + '\nOriginal idea: ' + _thinkState.originalPrompt
      + '\n\n' + text
  })

  callClaudeRawMultiTurn(SYS_THINK, apiMessages, 2000).then(function (raw) {
    var ti = $('think-typing'); if (ti) ti.remove()
    var parsed
    try { parsed = JSON.parse(raw) } catch (e) {
      parsed = { message: raw, options: [], advance: false }
    }

    if (parsed.message) {
      addThinkMsg({ type: 'ai', text: parsed.message })
      _thinkState.conversation.push({ role: 'ai', text: parsed.message, round: _thinkState.round })
    }

    if (parsed.advance) {
      _thinkState.round++
      renderThinkProgress(_thinkState.round)
    }

    if (parsed.brief && parsed.rules) {
      _thinkState.brief = parsed.brief
      _thinkState.rules = parsed.rules
      renderThinkSummary(parsed.brief, parsed.rules)
    } else if (parsed.options && parsed.options.length > 0) {
      addThinkMsg({ type: 'options', options: parsed.options })
    }

    saveThought(_thinkState.brief ? 'complete' : 'draft')
    ST._thinking = false
    if (sb) sb.disabled = false
    scrollThinkBot()
  }).catch(function (e) {
    var ti = $('think-typing'); if (ti) ti.remove()
    addThinkMsg({ type: 'ai', text: 'Something went wrong: ' + scrubKeys(e.message || String(e)) + '. Try again.' })
    ST._thinking = false
    if (sb) sb.disabled = false
  })
}

export function renderThinkSummary(brief, rules) {
  var html = '<div class="think-summary">'
  html += '<h3>\uD83D\uDCDD ' + (brief.name || 'Your App') + '</h3>'

  if (brief.whatItDoes && brief.whatItDoes.length) {
    html += '<h4>What It Does</h4><ul>'
    for (var i = 0; i < brief.whatItDoes.length; i++) html += '<li>' + esc(brief.whatItDoes[i]) + '</li>'
    html += '</ul>'
  }
  if (brief.whatItWontDo && brief.whatItWontDo.length) {
    html += '<h4>What It Won\'t Do</h4><ul>'
    for (var j = 0; j < brief.whatItWontDo.length; j++) html += '<li>' + esc(brief.whatItWontDo[j]) + '</li>'
    html += '</ul>'
  }
  if (brief.features && brief.features.length) {
    html += '<h4>Key Features</h4><ul>'
    for (var k = 0; k < brief.features.length; k++) html += '<li>' + esc(brief.features[k]) + '</li>'
    html += '</ul>'
  }
  if (brief.audience) html += '<h4>Audience</h4><ul><li>' + esc(brief.audience) + '</li></ul>'
  if (brief.design) {
    html += '<h4>Design</h4><div class="ts-design">'
    if (brief.design.theme) html += '<span class="ts-tag">' + esc(brief.design.theme) + ' theme</span>'
    if (brief.design.accent) html += '<span class="ts-tag">' + esc(brief.design.accent) + ' accent</span>'
    if (brief.design.layout) html += '<span class="ts-tag">' + esc(brief.design.layout) + '</span>'
    html += '</div>'
  }

  if (rules) {
    if (rules.must && rules.must.length) {
      html += '<h4>Must Do</h4><ul>'
      for (var m = 0; m < rules.must.length; m++) html += '<li>' + esc(rules.must[m]) + '</li>'
      html += '</ul>'
    }
    if (rules.must_not && rules.must_not.length) {
      html += '<h4>Must Not</h4><ul>'
      for (var n = 0; n < rules.must_not.length; n++) html += '<li>' + esc(rules.must_not[n]) + '</li>'
      html += '</ul>'
    }
    if (rules.nice_to_have && rules.nice_to_have.length) {
      html += '<h4>Nice to Have</h4><ul>'
      for (var p = 0; p < rules.nice_to_have.length; p++) html += '<li>' + esc(rules.nice_to_have[p]) + '</li>'
      html += '</ul>'
    }
  }
  html += '</div>'
  addThinkMsg({ type: 'summary', html: html })

  var actRow = document.createElement('div')
  actRow.className = 'think-actions'
  actRow.innerHTML = '<button class="ta-save" onclick="finishThink()">\uD83D\uDCBE Save & Go to Build</button>'
    + '<button class="ta-refine" onclick="refineThink()">\u270F\uFE0F Keep Refining</button>'
  $('think-scroll').appendChild(actRow)
  scrollThinkBot()
}

export function saveThought(status) {
  var thought = {
    id: _thinkState.thoughtId,
    name: _thinkState.brief ? _thinkState.brief.name : (_thinkState.originalPrompt || 'Untitled').slice(0, 40),
    status: status || 'draft',
    originalPrompt: _thinkState.originalPrompt,
    rounds: _thinkState.round,
    conversation: _thinkState.conversation,
    brief: _thinkState.brief || null,
    linkedRulesId: null,
    linkedAppId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  var idx = -1
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === _thinkState.thoughtId) { idx = i; break }
  }
  if (idx >= 0) {
    thought.createdAt = ST.thoughts[idx].createdAt
    thought.linkedRulesId = ST.thoughts[idx].linkedRulesId
    thought.linkedAppId = ST.thoughts[idx].linkedAppId
    ST.thoughts[idx] = thought
  } else {
    ST.thoughts.unshift(thought)
  }
  persist()
  return thought
}

export function saveRulesFromThought(thought, rulesData) {
  var rules = {
    id: uid(),
    name: (thought.name || 'App') + ' Rules',
    linkedThoughtId: thought.id,
    mustRules: rulesData.must || [],
    mustNotRules: rulesData.must_not || [],
    niceToHave: rulesData.nice_to_have || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  ST.rules.push(rules)
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === thought.id) { ST.thoughts[i].linkedRulesId = rules.id; break }
  }
  persist()
  return rules
}

export function finishThink() {
  var thought = saveThought('complete')
  var rules = null
  if (_thinkState.rules) {
    rules = saveRulesFromThought(thought, _thinkState.rules)
  }
  ST.activeThoughtId = thought.id
  $('think-sheet').classList.remove('open')
  ST._thinking = false
  openBuilder()
  toast('Thought saved \u2014 rules attached to build', 3000)
  ghSyncThoughtAndRules(thought, rules).then(function () {
    if (ST.ghToken) toast('\u2601\uFE0F Thought & rules synced to GitHub', 2500)
  })
}

export function refineThink() {
  _thinkState.round = Math.max(1, _thinkState.round - 1)
  renderThinkProgress(_thinkState.round)
  _thinkState.brief = null
  _thinkState.rules = null
  addThinkMsg({ type: 'ai', text: 'No problem! Let\'s keep refining. What would you like to change or add?' })
  _thinkState.conversation.push({ role: 'ai', text: 'Let\'s keep refining. What would you like to change or add?', round: _thinkState.round })
  scrollThinkBot()
}

export function initThinkSheet() {
  $('ts-close').addEventListener('click', closeThink)
  $('think-sheet').addEventListener('click', function (e) { if (e.target.id === 'think-sheet') closeThink() })
  var tsY = 0
  $('ts-handle').addEventListener('touchstart', function (e) { if (e.touches[0]) tsY = e.touches[0].clientY }, { passive: true })
  $('ts-handle').addEventListener('touchend', function (e) { if (e.changedTouches[0] && e.changedTouches[0].clientY - tsY > 55) closeThink() }, { passive: true })
  var tInp = $('think-input')
  tInp.addEventListener('input', function () { tInp.style.height = 'auto'; tInp.style.height = Math.min(tInp.scrollHeight, 160) + 'px' })
  tInp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendThinkMsg() } })
  $('think-send-btn').addEventListener('click', sendThinkMsg)
}

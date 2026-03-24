import { ST, persist } from '../lib/state.js'
import { $, esc, uid, toast, scrubKeys, fmtDate } from '../lib/utils.js'
import { THINK_ROUND_LABELS } from '../config/constants.js'
import { SYS_THINK, SYS_THINK_EDIT } from '../config/prompts.js'
import { callGPTThink, resetCostAccum } from '../lib/ai.js'
import { injectProfileContext } from '../lib/profile-context.js'
import { calculateBuildCost } from '../lib/cost.js'
import { ghSyncThoughtAndRules } from '../lib/github.js'
import { openBuilder } from './build.js'

var _thinkState = {
  round: 1,
  maxRounds: 5,
  thoughtId: null,
  conversation: [],
  originalPrompt: '',
  brief: null,
  rules: null,
  editMode: false,
  editBrief: null,
  editRules: null,
}

export function openThink(resumeId) {
  $('builder-sheet').classList.remove('open')
  if (resumeId) {
    var t = null
    for (var i = 0; i < ST.thoughts.length; i++) {
      if (ST.thoughts[i].id === resumeId) {
        t = ST.thoughts[i]
        break
      }
    }
    if (t) {
      _thinkState = {
        round: t.rounds || 1,
        maxRounds: 5,
        thoughtId: t.id,
        conversation: t.conversation || [],
        originalPrompt: t.originalPrompt || '',
        brief: t.brief || null,
        rules: null,
      }
      renderThinkProgress(_thinkState.round)
      var ts = $('think-scroll')
      ts.innerHTML = ''
      for (var j = 0; j < _thinkState.conversation.length; j++) {
        var c = _thinkState.conversation[j]
        addThinkMsg(c.role === 'user' ? { type: 'user', text: c.text } : { type: 'ai', text: c.text })
      }
      $('think-sheet').classList.add('open')
      setTimeout(function () {
        $('think-input').focus()
      }, 420)
      return
    }
  }
  _thinkState = {
    round: 1,
    maxRounds: 5,
    thoughtId: uid(),
    conversation: [],
    originalPrompt: '',
    brief: null,
    rules: null,
  }
  resetCostAccum()
  renderThinkProgress(1)
  var ts2 = $('think-scroll')
  ts2.innerHTML =
    '<div class="think-welcome">' +
    '<div class="tw-icon">\uD83D\uDCAD</div>' +
    '<div class="tw-title">Think It Through</div>' +
    '<div class="tw-sub">Describe your app idea and I\'ll help you flesh it out in a few quick rounds before building.</div>' +
    '</div>'
  $('think-sheet').classList.add('open')
  setTimeout(function () {
    $('think-input').focus()
  }, 420)
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
  $('ts-sub').textContent =
    'Round ' + Math.min(round, _thinkState.maxRounds) + ' of ' + _thinkState.maxRounds + ' \u00B7 ' + label
}

function scrollThinkBot() {
  var el = $('think-scroll')
  setTimeout(function () {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, 60)
}

export function addThinkMsg(cfg) {
  var s = $('think-scroll')
  var w = s.querySelector('.think-welcome')
  if (w) w.style.display = 'none'
  var row = document.createElement('div')
  if (cfg.type === 'user') {
    row.className = 'mrow user'
    row.innerHTML = '<div class="ubub" style="background:var(--g4);color:#000">' + esc(cfg.text) + '</div>'
  } else if (cfg.type === 'typing') {
    row.className = 'mrow asst'
    row.id = 'think-typing'
    row.innerHTML =
      '<div class="awrap"><div class="aav" style="background:var(--g4)">\uD83D\uDCAD</div><div class="tbub"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>'
  } else if (cfg.type === 'ai') {
    row.className = 'mrow asst'
    row.innerHTML =
      '<div class="awrap"><div class="aav" style="background:var(--g4)">\uD83D\uDCAD</div><div class="abub">' +
      esc(cfg.text) +
      '</div></div>'
  } else if (cfg.type === 'options') {
    row.className = 'think-options'
    var ohtml = ''
    for (var i = 0; i < cfg.options.length; i++) {
      ohtml += '<div class="think-opt" onclick="B.thinkOptionSelect(this)">' + esc(cfg.options[i]) + '</div>'
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
  for (var i = 0; i < siblings.length; i++) {
    if (siblings[i] !== el) siblings[i].classList.add('disabled')
  }
  $('think-input').value = text
  sendThinkMsg()
}

export function sendThinkMsg() {
  var inp = $('think-input')
  var text = inp.value.trim()
  if (!text || ST._thinking) return
  if (!ST.gptKey) {
    toast('Add an OpenAI API key in Settings first')
    return
  }

  ST._thinking = true
  var sb = $('think-send-btn')
  if (sb) sb.disabled = true
  inp.value = ''
  inp.style.height = ''

  if (!_thinkState.originalPrompt) _thinkState.originalPrompt = text

  addThinkMsg({ type: 'user', text: text })
  _thinkState.conversation.push({ role: 'user', text: text, round: _thinkState.round })

  addThinkMsg({ type: 'typing' })

  // Build proper multi-turn messages from conversation history (exclude last entry — it's the current message)
  var apiMessages = []
  for (var i = 0; i < _thinkState.conversation.length - 1; i++) {
    var c = _thinkState.conversation[i]
    apiMessages.push({ role: c.role === 'user' ? 'user' : 'assistant', content: c.text })
  }
  // Add current user message with round metadata (single source — no duplication)
  apiMessages.push({
    role: 'user',
    content:
      'Round: ' +
      _thinkState.round +
      '/' +
      _thinkState.maxRounds +
      '\nPhase: ' +
      THINK_ROUND_LABELS[Math.min(_thinkState.round, _thinkState.maxRounds) - 1] +
      '\nOriginal idea: ' +
      _thinkState.originalPrompt +
      '\n\n' +
      text,
  })

  var baseSys = _thinkState.editMode ? SYS_THINK_EDIT : SYS_THINK
  if (_thinkState.editMode && _thinkState.editBrief) {
    baseSys += '\n\nCURRENT BRIEF:\n' + JSON.stringify(_thinkState.editBrief)
    if (_thinkState.editRules) baseSys += '\n\nCURRENT RULES:\n' + JSON.stringify(_thinkState.editRules)
  }
  var effectiveSys = injectProfileContext(baseSys)
  var aiCall = callGPTThink(effectiveSys, apiMessages, 2000)

  aiCall
    .then(function (raw) {
      var ti = $('think-typing')
      if (ti) ti.remove()
      var parsed
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
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
        if (parsed.draft) {
          // Draft mode — show summary with confirm/edit buttons
          renderThinkSummary(parsed.brief, parsed.rules)
          // Replace default actions with draft-specific actions
          var existingActions = $('think-scroll').querySelector('.think-actions')
          if (existingActions) existingActions.remove()
          var actRow = document.createElement('div')
          actRow.className = 'think-actions'
          actRow.innerHTML =
            '<button class="ta-save" onclick="B.confirmThinkBrief()">\u2705 Looks good, lock it in</button>' +
            '<button class="ta-refine" onclick="B.editThinkBrief()">\u270F\uFE0F I want to change something</button>'
          $('think-scroll').appendChild(actRow)
        } else {
          renderThinkSummary(parsed.brief, parsed.rules)
        }
      } else if (parsed.options && parsed.options.length > 0) {
        addThinkMsg({ type: 'options', options: parsed.options })
      }

      saveThought(parsed.brief && !parsed.draft ? 'complete' : 'draft')
      ST._thinking = false
      if (sb) sb.disabled = false
      scrollThinkBot()
    })
    .catch(function (e) {
      var ti = $('think-typing')
      if (ti) ti.remove()
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
    html += "<h4>What It Won't Do</h4><ul>"
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

  // Feature checklist
  var checklist = extractFeatureChecklist(brief)
  if (checklist.length) {
    html += '<h4>Feature Checklist</h4><div class="ts-checklist">'
    for (var ci = 0; ci < checklist.length; ci++) {
      var item = checklist[ci]
      html += '<div class="ts-check-item">'
      html += '<span class="ts-check-box">' + (item.required ? '\u2610' : '\u25CB') + '</span>'
      html += '<span class="ts-check-text">' + esc(item.text) + '</span>'
      if (item.required) html += '<span class="ts-check-req">required</span>'
      html += '</div>'
    }
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
  actRow.innerHTML =
    '<button class="ta-save" onclick="B.finishThink()">\uD83D\uDCBE Save & Go to Build</button>' +
    '<button class="ta-refine" onclick="B.refineThink()">\u270F\uFE0F Keep Refining</button>'
  $('think-scroll').appendChild(actRow)
  scrollThinkBot()
}

export function extractFeatureChecklist(brief) {
  if (!brief) return []
  var checklist = []
  if (brief.features && brief.features.length) {
    for (var i = 0; i < brief.features.length; i++) {
      checklist.push({ id: 'feat-' + i, text: brief.features[i], required: true, verified: false })
    }
  }
  if (brief.whatItDoes && brief.whatItDoes.length) {
    for (var j = 0; j < brief.whatItDoes.length; j++) {
      var isDuplicate = false
      for (var k = 0; k < checklist.length; k++) {
        if (checklist[k].text.toLowerCase() === brief.whatItDoes[j].toLowerCase()) {
          isDuplicate = true
          break
        }
      }
      if (!isDuplicate) {
        checklist.push({ id: 'core-' + j, text: brief.whatItDoes[j], required: true, verified: false })
      }
    }
  }
  if (brief.design) {
    if (brief.design.theme) {
      checklist.push({ id: 'design-theme', text: brief.design.theme + ' theme', required: false, verified: false })
    }
    if (brief.design.layout) {
      checklist.push({ id: 'design-layout', text: brief.design.layout, required: false, verified: false })
    }
  }
  return checklist
}

export function saveThought(status) {
  var featureChecklist = extractFeatureChecklist(_thinkState.brief)
  var thought = {
    id: _thinkState.thoughtId,
    name: _thinkState.brief ? _thinkState.brief.name : (_thinkState.originalPrompt || 'Untitled').slice(0, 40),
    status: status || 'draft',
    originalPrompt: _thinkState.originalPrompt,
    rounds: _thinkState.round,
    conversation: _thinkState.conversation,
    brief: _thinkState.brief || null,
    featureChecklist: featureChecklist,
    linkedRulesId: null,
    linkedAppId: null,
    version: 1,
    versions: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  var idx = -1
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === _thinkState.thoughtId) {
      idx = i
      break
    }
  }
  if (idx >= 0) {
    var existing = ST.thoughts[idx]
    thought.createdAt = existing.createdAt
    thought.linkedRulesId = existing.linkedRulesId
    thought.linkedAppId = existing.linkedAppId
    thought.version = existing.version || 1
    thought.versions = existing.versions || []
    ST.thoughts[idx] = thought
  } else {
    ST.thoughts.unshift(thought)
  }
  persist()
  return thought
}

function snapshotVersion(thought, editNote) {
  if (!thought.versions) thought.versions = []
  thought.versions.push({
    version: thought.version || 1,
    brief: thought.brief ? JSON.parse(JSON.stringify(thought.brief)) : null,
    conversation: thought.conversation ? thought.conversation.slice() : [],
    editedAt: new Date().toISOString(),
    editNote: editNote || 'Version ' + (thought.version || 1),
  })
  thought.version = (thought.version || 1) + 1
  return thought
}

export function editThought(thoughtId) {
  var t = null
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === thoughtId) {
      t = ST.thoughts[i]
      break
    }
  }
  if (!t || !t.brief) {
    toast('This thought has no brief to edit yet')
    return
  }
  $('builder-sheet').classList.remove('open')
  resetCostAccum()
  _thinkState = {
    round: 1,
    maxRounds: 1,
    thoughtId: t.id,
    conversation: t.conversation ? t.conversation.slice() : [],
    originalPrompt: t.originalPrompt || '',
    brief: t.brief ? JSON.parse(JSON.stringify(t.brief)) : null,
    rules: null,
    editMode: true,
    editBrief: JSON.parse(JSON.stringify(t.brief)),
    editRules: null,
  }
  // Find linked rules
  if (t.linkedRulesId) {
    for (var j = 0; j < ST.rules.length; j++) {
      if (ST.rules[j].id === t.linkedRulesId) {
        _thinkState.editRules = {
          must: ST.rules[j].mustRules || [],
          must_not: ST.rules[j].mustNotRules || [],
          nice_to_have: ST.rules[j].niceToHave || [],
        }
        break
      }
    }
  }
  var ts = $('think-scroll')
  ts.innerHTML = ''
  renderThinkProgress(1)
  $('ts-sub').textContent = 'Edit Mode \u00B7 v' + (t.version || 1) + ' \u2192 v' + ((t.version || 1) + 1)
  addThinkMsg({
    type: 'ai',
    text:
      'You\'re editing "' +
      esc(t.brief.name || 'your app') +
      '" (v' +
      (t.version || 1) +
      '). What would you like to change?',
  })
  _thinkState.conversation.push({
    role: 'ai',
    text: 'Editing "' + (t.brief.name || 'your app') + '" (v' + (t.version || 1) + '). What would you like to change?',
    round: 0,
  })
  $('think-sheet').classList.add('open')
  setTimeout(function () {
    $('think-input').focus()
  }, 420)
}

export function viewThoughtVersions(thoughtId) {
  var t = null
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === thoughtId) {
      t = ST.thoughts[i]
      break
    }
  }
  if (!t) return
  var versions = t.versions || []
  var html = '<div class="think-summary" style="max-height:70vh;overflow-y:auto">'
  html += '<h3>Version History \u00B7 ' + esc(t.name || 'Untitled') + '</h3>'
  if (!versions.length) {
    html += '<p style="color:rgba(255,255,255,.4)">No previous versions yet (currently v' + (t.version || 1) + ')</p>'
  } else {
    for (var j = versions.length - 1; j >= 0; j--) {
      var v = versions[j]
      html += '<div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,.04)">'
      html += '<div style="display:flex;justify-content:space-between;align-items:center">'
      html += '<strong style="color:rgba(255,255,255,.7)">v' + v.version + '</strong>'
      html +=
        '<span style="font-size:10px;color:rgba(255,255,255,.3)">' +
        esc(v.editedAt ? fmtDate(v.editedAt) : '') +
        '</span>'
      html += '</div>'
      if (v.editNote)
        html += '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:4px">' + esc(v.editNote) + '</div>'
      if (v.brief) {
        html += '<div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:6px">'
        if (v.brief.name) html += '<strong>' + esc(v.brief.name) + '</strong><br>'
        if (v.brief.features && v.brief.features.length) {
          html +=
            'Features: ' +
            v.brief.features
              .map(function (f) {
                return esc(f)
              })
              .join(', ')
        }
        html += '</div>'
      }
      html += '</div>'
    }
  }
  html += '<div style="margin-top:12px;padding:10px;border-radius:10px;background:rgba(255,255,255,.06)">'
  html += '<div style="display:flex;justify-content:space-between;align-items:center">'
  html += '<strong style="color:var(--g1)">v' + (t.version || 1) + ' (current)</strong>'
  html +=
    '<span style="font-size:10px;color:rgba(255,255,255,.3)">' +
    esc(t.updatedAt ? fmtDate(t.updatedAt) : '') +
    '</span>'
  html += '</div>'
  if (t.brief) {
    html += '<div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:6px">'
    if (t.brief.name) html += '<strong>' + esc(t.brief.name) + '</strong><br>'
    if (t.brief.features && t.brief.features.length) {
      html +=
        'Features: ' +
        t.brief.features
          .map(function (f) {
            return esc(f)
          })
          .join(', ')
    }
    html += '</div>'
  }
  html += '</div>'
  html += '</div>'
  var ts = $('think-scroll')
  ts.innerHTML = ''
  addThinkMsg({ type: 'summary', html: html })
  var actRow = document.createElement('div')
  actRow.className = 'think-actions'
  actRow.innerHTML = '<button class="ta-save" onclick="B.closeThink()">Close</button>'
  ts.appendChild(actRow)
  $('think-sheet').classList.add('open')
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
    updatedAt: new Date().toISOString(),
  }
  ST.rules.push(rules)
  for (var i = 0; i < ST.thoughts.length; i++) {
    if (ST.thoughts[i].id === thought.id) {
      ST.thoughts[i].linkedRulesId = rules.id
      break
    }
  }
  persist()
  return rules
}

export function finishThink() {
  // Snapshot version before saving if this is an edit or if thought already had a brief
  var existingIdx = -1
  for (var ei = 0; ei < ST.thoughts.length; ei++) {
    if (ST.thoughts[ei].id === _thinkState.thoughtId) {
      existingIdx = ei
      break
    }
  }
  if (existingIdx >= 0 && ST.thoughts[existingIdx].brief && _thinkState.editMode) {
    snapshotVersion(ST.thoughts[existingIdx], _thinkState.editMode ? 'Edited' : 'Refined')
  }
  var thought = saveThought('complete')
  var rules = null
  if (_thinkState.rules) {
    rules = saveRulesFromThought(thought, _thinkState.rules)
  }
  // Persist Think session cost on thought object
  var costData = calculateBuildCost()
  if (costData.breakdown.length > 0) {
    thought.cost = {
      rawCost: costData.rawCost,
      userPrice: costData.userPrice,
      markup: costData.markup,
      totalInput: costData.totalInput,
      totalOutput: costData.totalOutput,
      ts: costData.ts,
    }
    persist()
  }
  ST.activeThoughtId = thought.id
  $('think-sheet').classList.remove('open')
  ST._thinking = false
  openBuilder()
  var costMsg = costData.rawCost > 0 ? ' (cost: $' + costData.rawCost.toFixed(4) + ')' : ''
  toast('Thought saved \u2014 rules attached to build' + costMsg, 3000)
  ghSyncThoughtAndRules(thought, rules).then(function () {
    if (ST.ghToken) toast('\u2601\uFE0F Thought & rules synced to GitHub', 2500)
  })
}

export function confirmThinkBrief() {
  $('think-input').value = 'Confirmed. Lock in this specification.'
  sendThinkMsg()
}

export function editThinkBrief() {
  $('think-input').focus()
  $('think-input').placeholder = 'What would you like to change?'
  addThinkMsg({ type: 'ai', text: 'What would you like to change? You can mention specific sections.' })
  _thinkState.conversation.push({
    role: 'ai',
    text: 'What would you like to change? You can mention specific sections.',
    round: _thinkState.round,
  })
  scrollThinkBot()
}

export function refineThink() {
  // Snapshot current version before refining
  var refIdx = -1
  for (var ri = 0; ri < ST.thoughts.length; ri++) {
    if (ST.thoughts[ri].id === _thinkState.thoughtId) {
      refIdx = ri
      break
    }
  }
  if (refIdx >= 0 && ST.thoughts[refIdx].brief) {
    snapshotVersion(ST.thoughts[refIdx], 'Before refinement')
    persist()
  }
  _thinkState.round = Math.max(1, _thinkState.round - 1)
  renderThinkProgress(_thinkState.round)
  _thinkState.brief = null
  _thinkState.rules = null
  // Inject context marker so AI understands the round reset
  _thinkState.conversation.push({
    role: 'user',
    text:
      '[Round reset to ' +
      _thinkState.round +
      '. The previous summary was rejected. Continue refining from this round.]',
    round: _thinkState.round,
  })
  addThinkMsg({ type: 'ai', text: "No problem! Let's keep refining. What would you like to change or add?" })
  _thinkState.conversation.push({
    role: 'ai',
    text: "Let's keep refining. What would you like to change or add?",
    round: _thinkState.round,
  })
  scrollThinkBot()
}

export function initThinkSheet() {
  $('ts-close').addEventListener('click', closeThink)
  $('think-sheet').addEventListener('click', function (e) {
    if (e.target.id === 'think-sheet') closeThink()
  })
  var tsY = 0
  $('ts-handle').addEventListener(
    'touchstart',
    function (e) {
      if (e.touches[0]) tsY = e.touches[0].clientY
    },
    { passive: true }
  )
  $('ts-handle').addEventListener(
    'touchend',
    function (e) {
      if (e.changedTouches[0] && e.changedTouches[0].clientY - tsY > 55) closeThink()
    },
    { passive: true }
  )
  var tInp = $('think-input')
  tInp.addEventListener('input', function () {
    tInp.style.height = 'auto'
    tInp.style.height = Math.min(tInp.scrollHeight, 160) + 'px'
  })
  tInp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendThinkMsg()
    }
  })
  $('think-send-btn').addEventListener('click', sendThinkMsg)
}

import { $, esc, escAttr } from '../lib/utils.js'
import { PIPE_NAMES, PIPE_ICONS, PIPE2_NAMES, PIPE2_ICONS, PIPE3_NAMES, PIPE3_ICONS, PIPE4_NAMES, PIPE4_ICONS, PIPE5_NAMES, PIPE5_ICONS } from '../config/constants.js'
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../config/templates.js'
import { approveAndMerge, requestChanges, resolveRetry, approveBlueprintContinue, rejectBlueprint } from './approval-card.js'
import { costCardHTML } from '../lib/cost.js'

// Pipeline type registry — maps pid to 'builder1' | 'builder2'
var _pipeTypes = {}
export function registerPipeType(pid, type) { _pipeTypes[pid] = type }

// Session tracking for conversation history
var _currentSession = []

export function getCurrentSession() { return _currentSession.slice() }
export function clearCurrentSession() {
  _currentSession = []
  try { localStorage.removeItem('bldr_live_chat') } catch (e) {}
}

// Persist live chat session to localStorage so it survives crashes
function _persistLiveChat() {
  try {
    localStorage.setItem('bldr_live_chat', JSON.stringify(_currentSession))
  } catch (e) { /* quota exceeded — non-critical */ }
}

// Hydrate live chat from localStorage (for crash recovery)
export function hydrateLiveChat() {
  try {
    var raw = localStorage.getItem('bldr_live_chat')
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}

function _trackMessage(cfg) {
  // Skip heavy/transient message types
  if (cfg.type === 'typing' || cfg.type === 'typing-pipeline') return
  var entry = { role: cfg.role, type: cfg.type || 'text', ts: new Date().toISOString() }
  if (cfg.role === 'user') { entry.text = cfg.text || '' }
  else if (cfg.role === 'system') { entry.text = cfg.text || '' }
  else if (cfg.type === 'text') { entry.text = cfg.text || ''; if (cfg.html) entry.html = cfg.html }
  else if (cfg.type === 'thinking') { entry.text = (cfg.text || '').slice(0, 2000) }
  else if (cfg.type === 'checks') { var f = (cfg.checks || []).filter(function (c) { return !c.passed }).length; entry.text = f ? f + ' issue(s) found' : 'All checks passed' }
  else if (cfg.type === 'audit') { var b = (cfg.bugs || []).length; entry.text = b ? b + ' bug(s) found' : 'No bugs found' }
  else if (cfg.type === 'pipeline') { entry.text = (cfg.pipelineType === 'stitch' ? 'Flawless Pipeline' : 'Pipeline') + ' started' }
  else if (cfg.type === 'approval') { entry.text = 'Awaiting approval' }
  else if (cfg.type === 'merge-status') { entry.text = cfg.status === 'done' ? 'Merged' : 'Merging' }
  else if (cfg.type === 'preview-card') { entry.text = 'Preview: ' + (cfg.appName || 'App') }
  else if (cfg.type === 'blueprint-preview') { entry.text = 'Blueprint preview: ' + (cfg.appName || 'App') }
  else if (cfg.type === 'retry-prompt') { entry.text = (cfg.bugCount || 0) + ' issues remain — retry?' }
  else if (cfg.type === 'schema') { entry.text = 'Supabase schema generated' }
  else { entry.text = cfg.text || '' }
  _currentSession.push(entry)
  _persistLiveChat()
}

export function scrollBot() {
  var el = $('chat-scroll')
  setTimeout(function () { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, 60)
}

export function resetChat() {
  var s = $('chat-scroll')
  s.innerHTML = '<div class="chat-welcome" id="chat-welcome">'
    + '<div class="cw-icon">\u26A1</div>'
    + '<div class="cw-title">What should we build?</div>'
    + '<div class="cw-sub">Describe any app \u2014 it will be built, audited, fixed, pushed to GitHub, and dropped on your home screen.</div>'
    + '<div class="chips">'
    + '<div class="chip" onclick="chipSend(\'A habit tracker with daily streaks and a monthly calendar heatmap\')">\uD83D\uDD25 Habit tracker</div>'
    + '<div class="chip" onclick="chipSend(\'A pomodoro timer with customizable intervals and session history\')">\u23F1 Pomodoro</div>'
    + '<div class="chip" onclick="chipSend(\'A personal budget tracker with expense categories and charts\')">\uD83D\uDCB0 Budget tracker</div>'
    + '<div class="chip" onclick="chipSend(\'A daily mood journal with emoji ratings and a calendar view\')">\uD83C\uDF19 Mood journal</div>'
    + '</div>'
    + _renderTemplateGallery()
    + '</div>'
}

function _renderTemplateGallery() {
  var cats = '<div class="tpl-cat active" data-cat="all" onclick="_tplFilter(\'all\')">All</div>'
  for (var c = 0; c < TEMPLATE_CATEGORIES.length; c++) {
    var cat = TEMPLATE_CATEGORIES[c]
    cats += '<div class="tpl-cat" data-cat="' + cat.id + '" onclick="_tplFilter(\'' + cat.id + '\')">' + cat.icon + ' ' + esc(cat.name) + '</div>'
  }
  var cards = ''
  for (var i = 0; i < TEMPLATES.length; i++) {
    var t = TEMPLATES[i]
    cards += '<div class="tpl-card" data-cat="' + t.category + '" onclick="templateSend(\'' + t.id + '\')">'
      + '<div class="tpl-card-icon">' + t.icon + '</div>'
      + '<div class="tpl-card-name">' + esc(t.name) + '</div>'
      + '<div class="tpl-card-desc">' + esc(t.desc) + '</div>'
      + '</div>'
  }
  return '<div class="tpl-section">'
    + '<div class="tpl-hdr" onclick="_tplToggle()"><span>\uD83D\uDCC2 Start from a template</span><span class="tpl-arrow" id="tpl-arrow">\u25B6</span></div>'
    + '<div class="tpl-gallery" id="tpl-gallery" style="display:none">'
    + '<div class="tpl-cats" id="tpl-cats">' + cats + '</div>'
    + '<div class="tpl-grid" id="tpl-grid">' + cards + '</div>'
    + '</div></div>'
}

// Toggle gallery open/closed
window._tplToggle = function () {
  var g = $('tpl-gallery'), a = $('tpl-arrow')
  if (!g) return
  var open = g.style.display === 'none'
  g.style.display = open ? '' : 'none'
  if (a) a.textContent = open ? '\u25BC' : '\u25B6'
}

// Filter templates by category
window._tplFilter = function (cat) {
  var tabs = document.querySelectorAll('#tpl-cats .tpl-cat')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.cat === cat)
  }
  var cards = document.querySelectorAll('#tpl-grid .tpl-card')
  for (var j = 0; j < cards.length; j++) {
    cards[j].style.display = (cat === 'all' || cards[j].dataset.cat === cat) ? '' : 'none'
  }
}

export function addMsg(cfg) {
  _trackMessage(cfg)
  var s = $('chat-scroll')
  var w = $('chat-welcome'); if (w) w.style.display = 'none'
  var row = document.createElement('div')
  if (cfg.role === 'user') {
    row.className = 'mrow user'
    var imgHtml = ''
    if (cfg.images && cfg.images.length) {
      imgHtml = '<div class="user-imgs">'
      for (var ii = 0; ii < cfg.images.length; ii++) {
        imgHtml += '<img src="data:' + cfg.images[ii].mediaType + ';base64,' + cfg.images[ii].base64 + '" alt="' + escAttr(cfg.images[ii].name || 'image') + '">'
      }
      imgHtml += '</div>'
    }
    row.innerHTML = '<div class="ubub">' + imgHtml + esc(cfg.text) + '</div>'
  } else if (cfg.role === 'system') {
    row.className = 'mrow sys'
    row.innerHTML = '<div class="sysbub">' + esc(cfg.text) + '</div>'
  } else {
    row.className = 'mrow asst'
    if (cfg.type === 'typing') {
      row.id = 'typing-ind'
      row.innerHTML = '<div class="awrap"><div class="skel skel-circle" style="width:28px;height:28px;flex-shrink:0;margin-top:2px"></div><div style="flex:1;display:flex;flex-direction:column;gap:7px;padding:9px 13px;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.1);border-radius:4px 18px 18px 18px"><div class="skel skel-line" style="width:82%"></div><div class="skel skel-line" style="width:55%"></div><div class="skel skel-line" style="width:38%"></div></div></div>'
    } else if (cfg.type === 'typing-pipeline') {
      row.id = 'typing-pipe-skel'
      var skelRows = ''
      for (var si = 0; si < 4; si++) {
        skelRows += '<div class="ps" style="padding:8px 12px;display:flex;align-items:center;gap:8px' + (si < 3 ? ';border-bottom:1px solid rgba(255,255,255,.05)' : '') + '"><div class="skel skel-circle" style="width:26px;height:26px;border-radius:8px;flex-shrink:0"></div><div style="flex:1;display:flex;flex-direction:column;gap:4px"><div class="skel skel-line" style="width:' + [50, 65, 40, 55][si] + '%;height:10px"></div><div class="skel skel-line" style="width:' + [30, 35, 25, 40][si] + '%;height:8px"></div></div></div>'
      }
      row.innerHTML = '<div class="awrap"><div class="skel skel-circle" style="width:28px;height:28px;flex-shrink:0;margin-top:2px"></div><div style="flex:1;min-width:0"><div class="pipe-card">' + skelRows + '</div></div></div>'
    } else if (cfg.type === 'text') {
      row.innerHTML = '<div class="awrap"><div class="aav">\u26A1</div><div class="abub">' + (cfg.html || esc(cfg.text || '')) + '</div></div>'
    } else if (cfg.type === 'pipeline') {
      row.id = cfg.id
      var pNames = cfg.names || (cfg.pipelineType === 'stitch' ? PIPE5_NAMES : cfg.pipelineType === 'website2' ? PIPE4_NAMES : cfg.pipelineType === 'website' ? PIPE3_NAMES : cfg.pipelineType === 'builder2' ? PIPE2_NAMES : PIPE_NAMES)
      var pIcons = cfg.icons || (cfg.pipelineType === 'stitch' ? PIPE5_ICONS : cfg.pipelineType === 'website2' ? PIPE4_ICONS : cfg.pipelineType === 'website' ? PIPE3_ICONS : cfg.pipelineType === 'builder2' ? PIPE2_ICONS : PIPE_ICONS)
      if (cfg.pipelineType) _pipeTypes[cfg.id] = cfg.pipelineType
      var phtml = '<div class="awrap"><div class="aav">\u26A1</div><div style="flex:1;min-width:0"><div class="pipe-card" id="' + cfg.id + '-inner">'
      for (var i = 0; i < pNames.length; i++) {
        phtml += '<div class="ps s-idle" id="' + cfg.id + '-s' + i + '"><div class="psico">' + pIcons[i] + '</div><div class="pstxt"><div class="psname">' + pNames[i] + '</div><div class="psdet">Waiting</div></div></div>'
      }
      phtml += '</div></div></div>'
      row.innerHTML = phtml
    } else if (cfg.type === 'checks') {
      var checks = cfg.checks || []
      var fails = checks.filter(function (c) { return !c.passed && c.id !== 'no-innerhtml-risk' && c.id !== 'fetch-calls' }).length
      var badgeClass = fails ? 'fail' : 'pass'
      var badgeText = fails ? (fails + ' Issue' + (fails !== 1 ? 's' : '')) : 'All Clear'
      var groups = {}
      checks.forEach(function (c) { if (!groups[c.cat]) groups[c.cat] = []; groups[c.cat].push(c) })
      var ghtml = ''
      for (var cat in groups) {
        ghtml += '<div class="chk-group"><div class="chk-group-title">' + esc(cat) + '</div>'
        for (var ci2 = 0; ci2 < groups[cat].length; ci2++) {
          var c = groups[cat][ci2]
          ghtml += '<div class="chk-row"><div class="chk-dot ' + (c.passed ? 'ok' : 'fail') + '"></div><div class="chk-label">' + esc(c.label) + '</div>' + (c.detail ? '<div class="chk-detail">' + esc(c.detail) + '</div>' : '') + '</div>'
        }
        ghtml += '</div>'
      }
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--g2)">\uD83D\uDCCB</div><div style="flex:1;min-width:0"><div class="checks-card"><div class="chk-hdr"><div class="chk-hdr-ico">\uD83D\uDCCB</div><div class="chk-hdr-title">Automated Checks</div><span class="chk-badge ' + badgeClass + '">' + badgeText + '</span></div>' + ghtml + '</div></div></div>'
    } else if (cfg.type === 'audit') {
      var bugs = cfg.bugs || []
      var bhtml = ''
      if (bugs.length) {
        for (var bi = 0; bi < bugs.length; bi++) {
          var b = bugs[bi]
          bhtml += '<div class="ai"><span class="sev ' + (b.severity || 'low') + '">' + esc(b.severity || 'low') + '</span><div class="aitxt"><strong>' + esc(b.issue || '') + '</strong></div></div>'
        }
      } else {
        bhtml = '<div class="audit-clean">\u2705 No bugs found \u2014 code looks clean!</div>'
      }
      var isClaudeAudit = cfg.source === 'claude'
      var auditBadge = isClaudeAudit ? '\u26A1' : 'G'
      var auditTitle = isClaudeAudit ? 'Claude Audit Report' : 'GPT-4o Audit Report'
      var auditAvStyle = isClaudeAudit ? 'background:var(--g1)' : 'background:var(--gg);font-family:var(--fh);font-size:10px;font-weight:800'
      row.innerHTML = '<div class="awrap"><div class="aav" style="' + auditAvStyle + '">' + auditBadge + '</div><div style="flex:1;min-width:0"><div class="audit-card"><div class="audit-hdr"><div class="gbadge" style="' + (isClaudeAudit ? 'background:var(--g1)' : '') + '">' + auditBadge + '</div><div class="audit-title">' + auditTitle + '</div><span class="ab ' + (bugs.length ? 'bugs' : 'clean') + '">' + (bugs.length ? bugs.length + ' Bug' + (bugs.length !== 1 ? 's' : '') : '\u2713 Clean') + '</span></div>' + bhtml + '</div></div></div>'
    } else if (cfg.type === 'preview-card') {
      row.innerHTML = '<div class="awrap"><div class="aav">\uD83D\uDC41</div><div style="flex:1;min-width:0"><div class="preview-chat-card"><div class="pcc-top"><div class="pcc-label">Preview \u2014 ' + esc(cfg.appName || 'App') + '</div><span class="pcc-branch">' + esc(cfg.branch || 'local') + '</span></div><div class="pcc-frame"><iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="' + escAttr(cfg.code || '') + '"></iframe><div class="pcc-frame-overlay"><button class="pcc-expand-btn" onclick="openPreview(\'' + escAttr(cfg.appId || '') + '\',\'' + escAttr(cfg.pid || '') + '\');">\uD83D\uDD0D Full Screen</button></div></div></div></div></div>'
    } else if (cfg.type === 'blueprint-preview') {
      var bpId = 'bp-' + Date.now()
      var bpPid = esc(cfg.pid || '')
      row.id = bpId
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#7C4DFF,#B44FFF)">\uD83D\uDCDD</div>'
        + '<div style="flex:1;min-width:0"><div class="bp-preview-card">'
        + '<div class="bp-preview-hdr"><div class="bp-preview-title">\uD83D\uDCDD Blueprint Preview \u2014 ' + esc(cfg.appName || 'App') + '</div>'
        + '<div class="bp-preview-meta">' + esc(cfg.meta || 'Stitch scaffold \u2014 review before Claude adds logic') + '</div></div>'
        + '<div class="bp-preview-frame"><iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="' + escAttr(cfg.code || '') + '"></iframe></div>'
        + '<div class="bp-preview-actions">'
        + '<button class="bp-btn approve" data-pid="' + bpPid + '" data-action="approve">\u2705 Approve &amp; Continue</button>'
        + '<button class="bp-btn reject" data-pid="' + bpPid + '" data-action="reject">\u274C Reject Blueprint</button>'
        + '</div></div></div></div>'
      setTimeout(function () {
        var btns = row.querySelectorAll('.bp-btn[data-pid]')
        for (var bpi = 0; bpi < btns.length; bpi++) {
          btns[bpi].addEventListener('click', function () {
            var pid2 = this.dataset.pid
            var action = this.dataset.action
            var allBtns = row.querySelectorAll('.bp-btn')
            for (var k = 0; k < allBtns.length; k++) allBtns[k].disabled = true
            if (action === 'approve') { this.textContent = 'Continuing\u2026'; approveBlueprintContinue(pid2) }
            else { this.textContent = 'Rejected'; rejectBlueprint(pid2) }
          })
        }
      }, 0)
    } else if (cfg.type === 'approval') {
      row.id = cfg.id
      var apid = esc(cfg.pid || '')
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#3D5AFE,#00E5FF)">\u2705</div>'
        + '<div style="flex:1;min-width:0"><div class="approval-card">'
        + '<div class="appr-title">Ready to Merge</div>'
        + '<div class="appr-sub">All checks passed. Approve to merge into <strong>main</strong>.</div>'
        + '<div class="appr-branch">' + esc(cfg.branch || '') + '</div>'
        + '<div class="appr-btns">'
        + '<button class="appr-btn approve" data-pid="' + apid + '" data-action="approve">\uD83D\uDD00 Approve &amp; Merge</button>'
        + '<button class="appr-btn changes" data-pid="' + apid + '" data-action="changes">\u270F\uFE0F Request Changes</button>'
        + '</div></div></div></div>'
      setTimeout(function () {
        var btns = row.querySelectorAll('.appr-btn[data-pid]')
        for (var bi2 = 0; bi2 < btns.length; bi2++) {
          btns[bi2].addEventListener('click', function () {
            var pid2 = this.dataset.pid
            var action = this.dataset.action
            var allBtns = row.querySelectorAll('.appr-btn')
            for (var k = 0; k < allBtns.length; k++) allBtns[k].disabled = true
            if (action === 'approve') { this.textContent = 'Merging\u2026'; approveAndMerge(pid2) }
            else { requestChanges(pid2) }
          })
        }
      }, 0)
    } else if (cfg.type === 'schema') {
      var sqlText = cfg.sql || ''
      var tables = cfg.tables || []
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#10A37F,#00C48C);font-size:13px">\uD83D\uDDC4\uFE0F</div>'
        + '<div style="flex:1;min-width:0"><div class="schema-card">'
        + '<div class="schema-hdr"><div class="schema-title">Supabase Backend \u2014 ' + tables.length + ' Table' + (tables.length !== 1 ? 's' : '') + ' Generated</div>'
        + '<button class="schema-copy" onclick="copyToClipboard(this.dataset.sql,\'SQL\');" data-sql="' + escAttr(sqlText) + '">Copy SQL</button></div>'
        + '<div class="schema-sql">' + esc(sqlText) + '</div></div></div></div>'
    } else if (cfg.type === 'merge-status') {
      row.id = cfg.mergeId
      var spinning = cfg.status === 'merging'
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--gh);font-size:14px">\uD83D\uDD00</div><div style="flex:1;min-width:0"><div class="merge-card"><div class="merge-ico">\uD83D\uDC19</div><div class="merge-info"><span class="merge-title">' + (spinning ? 'Merging to main\u2026' : cfg.status === 'done' ? 'Merged &amp; Deploying \u2713' : 'Merge failed') + '</span>' + (cfg.url ? '<a class="merge-url" href="' + cfg.url + '" target="_blank">' + cfg.url + '</a>' : '') + '<span class="merge-meta" id="' + cfg.mergeId + '-meta">' + esc(cfg.meta || '') + '</span></div>' + (spinning ? '<div class="merge-spin"></div>' : '') + '</div></div></div>'
    } else if (cfg.type === 'retry-prompt') {
      var rpid = esc(cfg.pid || '')
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#FF6D00,#FFD600)">\u26A0\uFE0F</div>'
        + '<div style="flex:1;min-width:0"><div class="retry-card">'
        + '<div class="retry-title">' + esc(String(cfg.bugCount || 0)) + ' issue' + ((cfg.bugCount || 0) !== 1 ? 's' : '') + ' remain after final review</div>'
        + '<div class="retry-sub">Would you like Claude to take another pass at fixing these bugs?</div>'
        + '<div class="retry-btns">'
        + '<button class="retry-btn yes" data-pid="' + rpid + '" data-choice="yes">Yes, fix again</button>'
        + '<button class="retry-btn no" data-pid="' + rpid + '" data-choice="no">No, proceed as-is</button>'
        + '</div></div></div></div>'
      setTimeout(function () {
        var btns = row.querySelectorAll('.retry-btn[data-pid]')
        for (var ri = 0; ri < btns.length; ri++) {
          btns[ri].addEventListener('click', function () {
            var pid2 = this.dataset.pid
            var choice = this.dataset.choice === 'yes'
            var allBtns = row.querySelectorAll('.retry-btn')
            for (var k = 0; k < allBtns.length; k++) allBtns[k].disabled = true
            this.textContent = choice ? 'Retrying\u2026' : 'Proceeding\u2026'
            resolveRetry(pid2, choice)
          })
        }
      }, 0)
    } else if (cfg.type === 'file-tree') {
      var ftFiles = cfg.files || []
      var ftHtml = '<div class="file-tree-card"><div class="ft-hdr"><span class="ft-ico">\uD83D\uDCC2</span><span class="ft-title">' + ftFiles.length + ' file' + (ftFiles.length !== 1 ? 's' : '') + ' generated</span></div><div class="ft-list">'
      for (var fi = 0; fi < ftFiles.length; fi++) {
        var fp = ftFiles[fi]
        var isDir = fp.endsWith('/')
        ftHtml += '<div class="ft-row"><span class="ft-icon">' + (isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4') + '</span><span class="ft-path">' + esc(fp) + '</span></div>'
      }
      ftHtml += '</div></div>'
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#10A37F,#00C48C)">\uD83D\uDCC2</div><div style="flex:1;min-width:0">' + ftHtml + '</div></div>'
    } else if (cfg.type === 'thinking') {
      var thinkId = 'think-' + Date.now()
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#B44FFF,#7C4DFF)">&#x1F9E0;</div>'
        + '<div style="flex:1;min-width:0"><div class="thinking-card" id="' + thinkId + '">'
        + '<div class="thinking-hdr" data-target="' + thinkId + '-body"><div class="thinking-title">&#x1F9E0; Thought Process</div><div class="thinking-toggle">&#x25B6;</div></div>'
        + '<div class="thinking-body" id="' + thinkId + '-body" style="display:none"><pre class="thinking-pre">' + esc(cfg.text || '') + '</pre></div>'
        + '</div></div></div>'
      setTimeout(function () {
        var hdr = row.querySelector('.thinking-hdr')
        if (hdr) hdr.addEventListener('click', function () {
          var body = document.getElementById(this.dataset.target)
          var tog = this.querySelector('.thinking-toggle')
          if (body.style.display === 'none') { body.style.display = 'block'; tog.textContent = '\u25BC' }
          else { body.style.display = 'none'; tog.textContent = '\u25B6' }
        })
      }, 0)
    } else if (cfg.type === 'cost') {
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:linear-gradient(135deg,#00E5FF,#00C853)">\uD83D\uDCB0</div><div style="flex:1;min-width:0">' + costCardHTML(cfg.cost) + '</div></div>'
    }
  }
  if (cfg.id) row.id = cfg.id
  s.appendChild(row); scrollBot()
  return row
}

// Pipeline step state tracking for crash recovery
var _pipelineSteps = {}
export function getPipelineSteps() { return JSON.parse(JSON.stringify(_pipelineSteps)) }
export function clearPipelineSteps() { _pipelineSteps = {} }

export function updatePS(pid, step, state, det) {
  var el = $(pid + '-s' + step); if (!el) return
  var isStitch = _pipeTypes[pid] === 'stitch'
  var isWeb2 = _pipeTypes[pid] === 'website2'
  var isWeb = _pipeTypes[pid] === 'website'
  var isB2 = _pipeTypes[pid] === 'builder2'
  var names = isStitch ? PIPE5_NAMES : isWeb2 ? PIPE4_NAMES : isWeb ? PIPE3_NAMES : isB2 ? PIPE2_NAMES : PIPE_NAMES
  var icons = isStitch ? PIPE5_ICONS : isWeb2 ? PIPE4_ICONS : isWeb ? PIPE3_ICONS : isB2 ? PIPE2_ICONS : PIPE_ICONS
  var ico = state === 'done' ? '\u2713' : state === 'error' ? '\u2717' : state === 'wait' ? '\u23F8' : icons[step] || '\u00B7'
  el.className = 'ps s-' + state
  el.innerHTML = '<div class="psico">' + ico + '</div><div class="pstxt"><div class="psname">' + esc(names[step] || 'Step ' + step) + '</div><div class="psdet">' + esc(det) + '</div></div>' + (state === 'active' ? '<div class="spin"></div>' : '')
  // Track step state for persistence
  if (!_pipelineSteps[pid]) _pipelineSteps[pid] = {}
  _pipelineSteps[pid][step] = { state: state, detail: det }
  scrollBot()
}

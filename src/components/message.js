import { $, esc, escAttr } from '../lib/utils.js'
import { PIPE_NAMES, PIPE_ICONS } from '../config/constants.js'
import { approveAndMerge, requestChanges, resolveRetry } from './approval-card.js'

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
    + '</div></div>'
}

export function addMsg(cfg) {
  var s = $('chat-scroll')
  var w = $('chat-welcome'); if (w) w.style.display = 'none'
  var row = document.createElement('div')
  if (cfg.role === 'user') {
    row.className = 'mrow user'
    var imgHtml = ''
    if (cfg.images && cfg.images.length) {
      imgHtml = '<div class="user-imgs">'
      for (var ii = 0; ii < cfg.images.length; ii++) {
        imgHtml += '<img src="data:' + cfg.images[ii].mediaType + ';base64,' + cfg.images[ii].base64 + '" alt="' + esc(cfg.images[ii].name || 'image') + '">'
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
      var phtml = '<div class="awrap"><div class="aav">\u26A1</div><div style="flex:1;min-width:0"><div class="pipe-card" id="' + cfg.id + '-inner">'
      for (var i = 0; i < PIPE_NAMES.length; i++) {
        phtml += '<div class="ps s-idle" id="' + cfg.id + '-s' + i + '"><div class="psico">' + PIPE_ICONS[i] + '</div><div class="pstxt"><div class="psname">' + PIPE_NAMES[i] + '</div><div class="psdet">Waiting</div></div></div>'
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
      row.innerHTML = '<div class="awrap"><div class="aav" style="background:var(--gg);font-family:var(--fh);font-size:10px;font-weight:800">G</div><div style="flex:1;min-width:0"><div class="audit-card"><div class="audit-hdr"><div class="gbadge">G</div><div class="audit-title">GPT-4o Audit Report</div><span class="ab ' + (bugs.length ? 'bugs' : 'clean') + '">' + (bugs.length ? bugs.length + ' Bug' + (bugs.length !== 1 ? 's' : '') : '\u2713 Clean') + '</span></div>' + bhtml + '</div></div></div>'
    } else if (cfg.type === 'preview-card') {
      row.innerHTML = '<div class="awrap"><div class="aav">\uD83D\uDC41</div><div style="flex:1;min-width:0"><div class="preview-chat-card"><div class="pcc-top"><div class="pcc-label">Preview \u2014 ' + esc(cfg.appName || 'App') + '</div><span class="pcc-branch">' + esc(cfg.branch || 'local') + '</span></div><div class="pcc-frame"><iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="' + escAttr(cfg.code || '') + '"></iframe><div class="pcc-frame-overlay"><button class="pcc-expand-btn" onclick="openPreview(\'' + esc(cfg.appId || '') + '\',\'' + esc(cfg.pid || '') + '\');">\uD83D\uDD0D Full Screen</button></div></div></div></div></div>'
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
    }
  }
  if (cfg.id) row.id = cfg.id
  s.appendChild(row); scrollBot()
  return row
}

export function updatePS(pid, step, state, det) {
  var el = $(pid + '-s' + step); if (!el) return
  var ico = state === 'done' ? '\u2713' : state === 'error' ? '\u2717' : state === 'wait' ? '\u23F8' : PIPE_ICONS[step] || '\u00B7'
  el.className = 'ps s-' + state
  el.innerHTML = '<div class="psico">' + ico + '</div><div class="pstxt"><div class="psname">' + esc(PIPE_NAMES[step] || 'Step ' + step) + '</div><div class="psdet">' + esc(det) + '</div></div>' + (state === 'active' ? '<div class="spin"></div>' : '')
  scrollBot()
}

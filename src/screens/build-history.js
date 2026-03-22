import { ST } from '../lib/state.js'
import { $, esc, grad, fmtDate } from '../lib/utils.js'
import { costSummaryHTML } from '../lib/cost.js'

export function openBuildHistory(id) {
  var app = null
  for (var i = 0; i < ST.apps.length; i++) {
    if (ST.apps[i].id === id) {
      app = ST.apps[i]
      break
    }
  }
  if (!app) return

  var g = grad(app.ci)
  $('bh-icon').textContent = app.icon
  $('bh-icon').style.background = g
  $('bh-name').textContent = app.name

  var buildCount = (app.prompts && app.prompts.length) || 1
  $('bh-sub').textContent = buildCount + ' build' + (buildCount !== 1 ? 's' : '') + ' \u00B7 Build History'

  var body = $('bh-body')
  var html = ''

  // Build prompts section
  var prompts = app.prompts || [{ text: app.desc || 'Initial build', ts: app.createdAt, type: 'initial' }]
  if (prompts.length) {
    html += '<div class="bh-section"><div class="bh-sec-title">Builds</div>'
    for (var j = prompts.length - 1; j >= 0; j--) {
      var p = prompts[j]
      var costStr = ''
      // Match cost to this build by timestamp proximity
      if (app.costs && app.costs.length) {
        for (var ci = 0; ci < app.costs.length; ci++) {
          var c = app.costs[ci]
          if (c.ts && p.ts) {
            var diff = Math.abs(new Date(c.ts).getTime() - new Date(p.ts).getTime())
            if (diff < 300000) {
              // within 5 min
              costStr = '$' + (c.userPrice || c.rawCost || 0).toFixed(4)
              break
            }
          }
        }
      }
      html +=
        '<div class="bh-build-item">' +
        '<div class="bh-build-hdr">' +
        '<span class="bh-build-tag ' +
        (p.type === 'initial' ? 'initial' : 'update') +
        '">' +
        (p.type === 'initial' ? '\uD83D\uDD28 Initial Build' : '\u270F\uFE0F Update') +
        '</span>' +
        '<span class="bh-build-date">' +
        fmtDate(p.ts) +
        '</span>' +
        '</div>' +
        '<div class="bh-build-prompt">' +
        esc(p.text || '') +
        '</div>' +
        (costStr ? '<div class="bh-build-cost">' + costStr + '</div>' : '') +
        '</div>'
    }
    html += '</div>'
  }

  // Cost summary section
  if (app.costs && app.costs.length) {
    html += '<div class="bh-section"><div class="bh-sec-title">Build Costs</div>'
    html += costSummaryHTML(app.costs)
    html += '</div>'
  }

  // Conversation history section
  var sessions = app.chatHistory || []
  if (sessions.length) {
    html += '<div class="bh-section"><div class="bh-sec-title">Conversation History</div>'
    for (var si = 0; si < sessions.length; si++) {
      var sess = sessions[si]
      var sessId = 'bh-sess-' + si
      html +=
        '<div class="bh-chat-item">' +
        '<div class="bh-chat-hdr" data-target="' +
        sessId +
        '">' +
        '<span class="bh-chat-prompt">' +
        esc((sess.prompt || 'Build session').slice(0, 80)) +
        '</span>' +
        '<span class="bh-chat-date">' +
        fmtDate(sess.ts) +
        '</span>' +
        '<span class="bh-chat-toggle">&#x25B6;</span>' +
        '</div>' +
        '<div class="bh-chat-body" id="' +
        sessId +
        '" style="display:none">'
      var msgs = sess.messages || []
      for (var mi = 0; mi < msgs.length; mi++) {
        var m = msgs[mi]
        var roleClass = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'asst'
        var icon = m.role === 'user' ? '&#x1F464;' : m.role === 'system' ? '&#x2699;&#xFE0F;' : '&#x26A1;'
        var content = m.html ? m.html : esc(m.text || '')
        if (m.type === 'thinking') {
          content =
            '<span style="font-size:10px;font-weight:700;color:rgba(180,79,255,.7)">&#x1F9E0; Thought</span><br>' +
            esc((m.text || '').slice(0, 500))
        }
        html +=
          '<div class="bh-chat-msg ' +
          roleClass +
          '">' +
          '<span class="bh-chat-msg-icon">' +
          icon +
          '</span>' +
          '<div class="bh-chat-msg-content">' +
          content +
          '</div>' +
          '</div>'
      }
      html += '</div></div>'
    }
    html += '</div>'
  }

  if (!html) {
    html = '<div class="bh-empty">\uD83D\uDCED No build history yet</div>'
  }

  body.innerHTML = html

  // Attach toggle listeners for conversation sessions
  var hdrs = body.querySelectorAll('.bh-chat-hdr')
  for (var hi = 0; hi < hdrs.length; hi++) {
    hdrs[hi].addEventListener('click', function () {
      var b = document.getElementById(this.dataset.target)
      var tog = this.querySelector('.bh-chat-toggle')
      if (b.style.display === 'none') {
        b.style.display = 'flex'
        tog.innerHTML = '&#x25BC;'
      } else {
        b.style.display = 'none'
        tog.innerHTML = '&#x25B6;'
      }
    })
  }

  $('build-history-overlay').classList.add('on')
}

export function closeBuildHistory() {
  $('build-history-overlay').classList.remove('on')
}

export function initBuildHistory() {
  $('bh-close').addEventListener('click', closeBuildHistory)
  $('build-history-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'build-history-overlay') closeBuildHistory()
  })
}

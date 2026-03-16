import { ST } from '../lib/state.js'
import { $, esc, toast, scrubKeys } from '../lib/utils.js'
import { SELFUPDATE_STEPS, SELFUPDATE_ICONS } from '../config/constants.js'
import { SYS_SELFUPDATE } from '../config/prompts.js'
import { callClaude } from '../lib/ai.js'
import { ghGetFileSha, ghPushFile } from '../lib/github.js'
import { _nativeFetch } from '../lib/key-guard.js'
import { scrollBot } from '../components/message.js'

export function runSelfUpdatePipeline(improvement) {
  if (!ST.key) { toast('Anthropic API key required', 3000); return }
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) { toast('GitHub credentials required', 3500); return }
  ST._building = true; $('send-btn').disabled = true
  var pid = 'su' + Date.now()
  var html = '<div class="pipe" id="' + pid + '">'
  for (var i = 0; i < SELFUPDATE_STEPS.length; i++) {
    html += '<div class="ps s-wait" id="' + pid + '-s' + i + '"><div class="psico">' + SELFUPDATE_ICONS[i] + '</div><div class="pstxt"><div class="psname">' + SELFUPDATE_STEPS[i] + '</div><div class="psdet">Waiting\u2026</div></div></div>'
  }
  html += '</div>'
  var s = $('chat-scroll'); var row = document.createElement('div'); row.className = 'mrow asst'; row.innerHTML = '<div class="abub">' + html + '</div>'; s.appendChild(row); scrollBot()

  function ups(step, state, det) {
    var el = $(pid + '-s' + step); if (!el) return
    var ico = state === 'done' ? '\u2713' : state === 'error' ? '\u2717' : SELFUPDATE_ICONS[step] || '\u00B7'
    el.className = 'ps s-' + state
    el.innerHTML = '<div class="psico">' + ico + '</div><div class="pstxt"><div class="psname">' + SELFUPDATE_STEPS[step] + '</div><div class="psdet">' + esc(det) + '</div></div>' + (state === 'active' ? '<div class="spin"></div>' : '')
    scrollBot()
  }

  var rawUrl = 'https://raw.githubusercontent.com/' + ST.ghUser + '/' + ST.ghRepo + '/main/index.html'
  ups(0, 'active', 'Fetching current Builder source\u2026')
  _nativeFetch(rawUrl).then(function (res) {
    if (!res.ok) throw new Error('Could not fetch source (HTTP ' + res.status + ')')
    return res.text()
  }).then(function (currentSrc) {
    if (currentSrc.indexOf('<!DOCTYPE') < 0) throw new Error('Fetched file is not The Builder')
    ups(0, 'done', 'Source fetched (' + Math.round(currentSrc.length / 1024) + 'KB)')
    ups(1, 'active', 'Claude is writing the improvement\u2026')
    return callClaude(SYS_SELFUPDATE, 'CURRENT BUILDER SOURCE:\n\n' + currentSrc.slice(0, 80000) + '\n\nIMPROVEMENT REQUESTED:\n' + improvement)
  }).then(function (improved) {
    ups(1, 'done', 'Improvement generated')
    ups(2, 'active', 'Pushing to GitHub\u2026')
    return ghGetFileSha('index.html', 'main').then(function (sha) {
      return ghPushFile('index.html', improved, '\uD83D\uDD27 Self-update: ' + improvement.slice(0, 80), 'main', sha)
    })
  }).then(function () {
    ups(2, 'done', 'Pushed to main')
    ups(3, 'active', 'Reloading in 5s\u2026')
    var s2 = $('chat-scroll'); var row2 = document.createElement('div'); row2.className = 'mrow asst'
    row2.innerHTML = '<div class="awrap"><div class="aav">\u26A1</div><div class="abub">\u2705 <strong>Builder updated!</strong> Reloading in 5 seconds\u2026</div></div>'
    s2.appendChild(row2); scrollBot()
    setTimeout(function () { location.reload() }, 5000)
  }).catch(function (e) {
    var step = 0
    for (var i = 0; i < 4; i++) { var el = $(pid + '-s' + i); if (el && el.className.indexOf('s-active') >= 0) { step = i; break } }
    ups(step, 'error', scrubKeys(String(e.message || e)))
    var s3 = $('chat-scroll'); var row3 = document.createElement('div'); row3.className = 'mrow asst'
    row3.innerHTML = '<div class="awrap"><div class="aav">\u26A1</div><div class="abub">\u274C Self-update failed: ' + esc(scrubKeys(String(e.message || e))) + '</div></div>'
    s3.appendChild(row3); scrollBot()
  }).finally(function () {
    ST._building = false
    var sb = $('send-btn'); if (sb) sb.disabled = false
  })
}

export function selfUpdateBuilder(improvement) {
  if (!ST.key) { toast('Anthropic API key required', 3000); return }
  if (!ST.ghToken || !ST.ghUser || !ST.ghRepo) { toast('GitHub credentials required', 3500); return }
  var btn = $('s-self-update-btn')
  if (btn) { btn.disabled = true; btn.textContent = '\uD83D\uDD04 Updating\u2026' }
  toast('Fetching current Builder source\u2026', 2000)
  var rawUrl = 'https://raw.githubusercontent.com/' + ST.ghUser + '/' + ST.ghRepo + '/main/index.html'
  _nativeFetch(rawUrl).then(function (res) {
    if (!res.ok) throw new Error('Could not fetch current source (HTTP ' + res.status + ')')
    return res.text()
  }).then(function (currentSrc) {
    if (currentSrc.indexOf('<!DOCTYPE') < 0) throw new Error('Fetched file is not The Builder')
    toast('Claude is writing the improvement\u2026', 3000)
    return callClaude(SYS_SELFUPDATE, 'CURRENT BUILDER SOURCE:\n\n' + currentSrc.slice(0, 80000) + '\n\nIMPROVEMENT REQUESTED:\n' + improvement)
  }).then(function (improved) {
    toast('Pushing updated Builder to GitHub\u2026', 2500)
    return ghGetFileSha('index.html', 'main').then(function (sha) {
      return ghPushFile('index.html', improved, '\uD83D\uDD27 Self-update: ' + improvement.slice(0, 80), 'main', sha)
    })
  }).then(function () {
    toast('\u2705 Builder updated! Reloading in 5s\u2026', 5000)
    setTimeout(function () { location.reload() }, 5000)
  }).catch(function (e) {
    toast('Self-update failed: ' + scrubKeys(e.message || String(e)), 6000)
  }).finally(function () {
    if (btn) { btn.disabled = false; btn.textContent = '\uD83D\uDD27 Update The Builder' }
  })
}

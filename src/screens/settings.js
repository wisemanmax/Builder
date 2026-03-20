import { ST, saveKeys, keyStatusHTML } from '../lib/state.js'
import { $, toast } from '../lib/utils.js'
import { persist } from '../lib/state.js'
import { testGitHub, pullFromGitHub } from '../lib/github.js'
import { pullFromSupabase } from '../lib/storage.js'
import { renderGrid } from '../components/app-icon.js'
import { renderProfilesSettings } from './profiles.js'

export function openSettings() {
  $('s-anth').value = ST.key; $('s-gpt').value = ST.gptKey; $('s-stitch').value = ST.stitchKey; $('s-gemini').value = ST.geminiKey
  $('s-gh-token').value = ST.ghToken; $('s-gh-user').value = ST.ghUser; $('s-gh-repo').value = ST.ghRepo; $('s-gh-domain').value = ST.ghCustomDomain
  $('s-sb-url').value = ST.sbUrl; $('s-sb-anon').value = ST.sbAnon
  $('s-audit-pill').classList.toggle('on', ST.auditEnabled)
  $('s-sync-pill').classList.toggle('on', ST.sbEnabled)
  var bp = $('s-backend-pill'); if (bp) bp.classList.toggle('on', ST.backendEnabled)
  $('s-sb-exp').style.display = ST.sbEnabled ? 'flex' : 'none'
  var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
  renderProfilesSettings()
  $('settings-overlay').classList.add('on')
}

export function initSettings() {
  $('ssclose').addEventListener('click', function () { $('settings-overlay').classList.remove('on') })
  $('settings-overlay').addEventListener('click', function (e) { if (e.target.id === 'settings-overlay') $('settings-overlay').classList.remove('on') })
  // Stitch key show/hide toggle
  var stitchToggle = $('s-stitch-toggle')
  if (stitchToggle) {
    stitchToggle.addEventListener('click', function () {
      var inp = $('s-stitch')
      if (inp.type === 'password') { inp.type = 'text'; stitchToggle.textContent = '\uD83D\uDE48' }
      else { inp.type = 'password'; stitchToggle.textContent = '\uD83D\uDC41' }
    })
  }
  $('s-save-ai').addEventListener('click', function () {
    ST.key = $('s-anth').value.trim(); ST.gptKey = $('s-gpt').value.trim(); ST.stitchKey = $('s-stitch').value.trim(); ST.geminiKey = $('s-gemini').value.trim(); saveKeys()
    var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
    // Test Stitch key if provided
    if (ST.stitchKey) {
      _testStitchKey(ST.stitchKey)
    }
    toast(ST.gptKey ? 'AI keys saved \u2014 GPT audit active \u2713' : 'AI keys saved \u2713')
    // Update Flawless Pipeline button gate
    _syncStitchGate()
  })
  $('s-save-gh').addEventListener('click', function () {
    var ghT = $('s-gh-token').value.trim(), ghU = $('s-gh-user').value.trim(), ghR = $('s-gh-repo').value.trim(), ghD = $('s-gh-domain').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (!ghT || !ghU || !ghR) { toast('Fill in all three GitHub fields'); return }
    ST.ghToken = ghT; ST.ghUser = ghU; ST.ghRepo = ghR; ST.ghCustomDomain = ghD; saveKeys()
    var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
    toast('Testing GitHub connection\u2026')
    testGitHub().then(function (ok) { toast(ok ? '\u2713 GitHub connected: ' + ST.ghUser + '/' + ST.ghRepo : '\u2717 GitHub test failed', 4000) })
  })
  $('s-gh-sync').addEventListener('click', function () {
    var p = pullFromGitHub()
    if (p && p.then) p.then(function () { renderGrid() })
  })
  $('s-audit-pill').addEventListener('click', function () { ST.auditEnabled = !ST.auditEnabled; saveKeys(); $('s-audit-pill').classList.toggle('on', ST.auditEnabled); toast(ST.auditEnabled ? 'GPT audit enabled' : 'GPT audit disabled') })
  $('s-sync-pill').addEventListener('click', function () { ST.sbEnabled = !ST.sbEnabled; saveKeys(); $('s-sync-pill').classList.toggle('on', ST.sbEnabled); $('s-sb-exp').style.display = ST.sbEnabled ? 'flex' : 'none'; toast(ST.sbEnabled ? 'Supabase sync enabled' : 'Sync disabled') })
  $('s-save-sb').addEventListener('click', function () {
    var url = $('s-sb-url').value.trim(), anon = $('s-sb-anon').value.trim()
    if (!url || !anon) { toast('Enter both Supabase fields'); return }
    ST.sbUrl = url; ST.sbAnon = anon; saveKeys()
    var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
    toast('Supabase credentials saved \u2713')
  })
  $('s-pull').addEventListener('click', pullFromSupabase)
  var backendPill = $('s-backend-pill')
  if (backendPill) {
    backendPill.classList.toggle('on', ST.backendEnabled)
    backendPill.addEventListener('click', function () {
      ST.backendEnabled = !ST.backendEnabled; saveKeys()
      backendPill.classList.toggle('on', ST.backendEnabled)
      toast(ST.backendEnabled ? 'Backend step enabled' : 'Backend step disabled')
    })
  }
  $('s-clear').addEventListener('click', function () { if (!confirm('Delete all apps locally?')) return; ST.apps = []; persist(); renderGrid(); toast('All apps cleared locally') })
  $('s-signout').addEventListener('click', function () { if (!confirm('Sign out and clear all keys?')) return; localStorage.clear(); location.reload() })
}

function _testStitchKey(key) {
  fetch('https://stitch.googleapis.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
  }).then(function (res) {
    if (res.ok) toast('\u2713 Stitch API key verified', 3000)
    else if (res.status === 401 || res.status === 403) toast('\u2717 Stitch API key invalid (HTTP ' + res.status + ')', 4000)
    else toast('\u2717 Stitch API error (HTTP ' + res.status + ')', 4000)
  }).catch(function () {
    toast('\u2717 Could not reach Stitch API', 4000)
  })
}

export function _syncStitchGate() {
  var btn = $('pt-stitch-btn')
  if (!btn) return
  var hasKey = !!ST.stitchKey
  btn.classList.toggle('pt-locked', !hasKey)
  btn.title = hasKey ? 'Stitch-Claude Chat Builder \u00B7 Flawless Pipeline' : 'Requires Stitch API key'
}

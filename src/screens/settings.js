import { ST, saveKeys, keyStatusHTML } from '../lib/state.js'
import { $, toast } from '../lib/utils.js'
import { persist } from '../lib/state.js'
import { testGitHub } from '../lib/github.js'
import { pullFromSupabase } from '../lib/storage.js'
import { renderGrid } from '../components/app-icon.js'

export function openSettings() {
  $('s-anth').value = ST.key; $('s-gpt').value = ST.gptKey
  $('s-gh-token').value = ST.ghToken; $('s-gh-user').value = ST.ghUser; $('s-gh-repo').value = ST.ghRepo
  $('s-sb-url').value = ST.sbUrl; $('s-sb-anon').value = ST.sbAnon
  $('s-audit-pill').classList.toggle('on', ST.auditEnabled)
  $('s-sync-pill').classList.toggle('on', ST.sbEnabled)
  var bp = $('s-backend-pill'); if (bp) bp.classList.toggle('on', ST.backendEnabled)
  $('s-sb-exp').style.display = ST.sbEnabled ? 'flex' : 'none'
  var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
  $('settings-overlay').classList.add('on')
}

export function initSettings() {
  $('ssclose').addEventListener('click', function () { $('settings-overlay').classList.remove('on') })
  $('settings-overlay').addEventListener('click', function (e) { if (e.target.id === 'settings-overlay') $('settings-overlay').classList.remove('on') })
  $('s-save-ai').addEventListener('click', function () {
    ST.key = $('s-anth').value.trim(); ST.gptKey = $('s-gpt').value.trim(); saveKeys()
    var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
    toast(ST.gptKey ? 'AI keys saved \u2014 GPT audit active \u2713' : 'AI keys saved \u2713')
  })
  $('s-save-gh').addEventListener('click', function () {
    var ghT = $('s-gh-token').value.trim(), ghU = $('s-gh-user').value.trim(), ghR = $('s-gh-repo').value.trim()
    if (!ghT || !ghU || !ghR) { toast('Fill in all three GitHub fields'); return }
    ST.ghToken = ghT; ST.ghUser = ghU; ST.ghRepo = ghR; saveKeys()
    var ksc = $('key-safety-card'); if (ksc) ksc.innerHTML = keyStatusHTML()
    toast('Testing GitHub connection\u2026')
    testGitHub().then(function (ok) { toast(ok ? '\u2713 GitHub connected: ' + ST.ghUser + '/' + ST.ghRepo : '\u2717 GitHub test failed', 4000) })
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

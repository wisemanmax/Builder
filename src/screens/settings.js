import { ST, saveKeys, keyStatusHTML } from '../lib/state.js'
import { $, toast, validateKey } from '../lib/utils.js'
import { persist } from '../lib/state.js'
import { testGitHub, pullFromGitHub } from '../lib/github.js'
import { pullFromSupabase } from '../lib/storage.js'
import { renderGrid } from '../components/app-icon.js'
import { renderProfilesSettings } from './profiles.js'
import { testSupabaseConnection } from '../lib/supabase-setup.js'
import { getSupabase } from '../lib/supabase.js'

export function openSettings() {
  $('s-anth').value = ST.key
  $('s-gpt').value = ST.gptKey
  $('s-stitch').value = ST.stitchKey
  $('s-groq').value = ST.groqKey
  $('s-gemini').value = ST.geminiKey
  $('s-gh-token').value = ST.ghToken
  $('s-gh-user').value = ST.ghUser
  $('s-gh-repo').value = ST.ghRepo
  $('s-gh-domain').value = ST.ghCustomDomain
  $('s-sb-url').value = ST.sbUrl
  $('s-sb-anon').value = ST.sbAnon
  $('s-sb-apikey').value = ST.sbApiKey
  $('s-audit-pill').classList.toggle('on', ST.auditEnabled)
  $('s-sync-pill').classList.toggle('on', ST.sbEnabled)
  var bp = $('s-backend-pill')
  if (bp) bp.classList.toggle('on', ST.backendEnabled)
  $('s-sb-exp').style.display = ST.sbEnabled ? 'flex' : 'none'
  var ksc = $('key-safety-card')
  if (ksc) ksc.innerHTML = keyStatusHTML()
  // Show session info if authenticated
  var sessionCard = $('s-session-card')
  if (sessionCard) {
    if (ST.userId && ST.userEmail) {
      sessionCard.style.display = 'block'
      var emailEl = $('s-session-email')
      if (emailEl) emailEl.textContent = ST.userEmail
      var providerEl = $('s-session-provider')
      if (providerEl) {
        var provider =
          ST._session && ST._session.user && ST._session.user.app_metadata
            ? ST._session.user.app_metadata.provider || 'email'
            : 'email'
        providerEl.textContent = 'Signed in via ' + provider
      }
    } else {
      sessionCard.style.display = 'none'
    }
  }
  renderProfilesSettings()
  $('settings-overlay').classList.add('on')
}

export function initSettings() {
  $('ssclose').addEventListener('click', function () {
    $('settings-overlay').classList.remove('on')
  })
  $('settings-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'settings-overlay') $('settings-overlay').classList.remove('on')
  })
  // Stitch key show/hide toggle
  var stitchToggle = $('s-stitch-toggle')
  if (stitchToggle) {
    stitchToggle.addEventListener('click', function () {
      var inp = $('s-stitch')
      if (inp.type === 'password') {
        inp.type = 'text'
        stitchToggle.textContent = '\uD83D\uDE48'
      } else {
        inp.type = 'password'
        stitchToggle.textContent = '\uD83D\uDC41'
      }
    })
  }
  $('s-save-ai').addEventListener('click', function () {
    var anthVal = $('s-anth').value.trim()
    if (anthVal) {
      var ac = validateKey('anthropic', anthVal)
      if (!ac.valid) {
        toast('Anthropic key: ' + ac.msg)
        return
      }
    }
    var gptVal = $('s-gpt').value.trim()
    if (gptVal) {
      var gc = validateKey('openai', gptVal)
      if (!gc.valid) {
        toast('OpenAI key: ' + gc.msg)
        return
      }
    }
    var groqVal = $('s-groq').value.trim()
    if (groqVal) {
      var grc = validateKey('groq', groqVal)
      if (!grc.valid) {
        toast('Groq key: ' + grc.msg)
        return
      }
    }
    var geminiVal = $('s-gemini').value.trim()
    if (geminiVal) {
      var gmc = validateKey('gemini', geminiVal)
      if (!gmc.valid) {
        toast('Gemini key: ' + gmc.msg)
        return
      }
    }
    ST.key = anthVal
    ST.gptKey = gptVal
    ST.stitchKey = $('s-stitch').value.trim()
    ST.groqKey = groqVal
    ST.geminiKey = geminiVal
    saveKeys()
    var ksc = $('key-safety-card')
    if (ksc) ksc.innerHTML = keyStatusHTML()
    // Test Stitch key if provided
    if (ST.stitchKey) {
      _testStitchKey(ST.stitchKey)
    }
    // Test Groq key if provided
    if (ST.groqKey) {
      _testGroqKey(ST.groqKey)
    }
    // Test Gemini key if provided
    if (ST.geminiKey) {
      _testGeminiKey(ST.geminiKey)
    }
    var extras = []
    if (ST.gptKey) extras.push('GPT audit')
    if (ST.groqKey) extras.push('Groq')
    if (ST.geminiKey) extras.push('Gemini')
    toast(extras.length ? 'AI keys saved \u2014 ' + extras.join(' + ') + ' active \u2713' : 'AI keys saved \u2713')
    // Update Flawless Pipeline button gate
    _syncStitchGate()
  })
  $('s-save-gh').addEventListener('click', function () {
    var ghT = $('s-gh-token').value.trim(),
      ghU = $('s-gh-user').value.trim(),
      ghR = $('s-gh-repo').value.trim(),
      ghD = $('s-gh-domain')
        .value.trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
    if (!ghT || !ghU || !ghR) {
      toast('Fill in all three GitHub fields')
      return
    }
    var ghc = validateKey('github', ghT)
    if (!ghc.valid) {
      toast('GitHub token: ' + ghc.msg)
      return
    }
    ST.ghToken = ghT
    ST.ghUser = ghU
    ST.ghRepo = ghR
    ST.ghCustomDomain = ghD
    saveKeys()
    var ksc = $('key-safety-card')
    if (ksc) ksc.innerHTML = keyStatusHTML()
    toast('Testing GitHub connection\u2026')
    testGitHub().then(function (ok) {
      toast(ok ? '\u2713 GitHub connected: ' + ST.ghUser + '/' + ST.ghRepo : '\u2717 GitHub test failed', 4000)
    })
  })
  $('s-gh-sync').addEventListener('click', function () {
    var p = pullFromGitHub()
    if (p && p.then)
      p.then(function () {
        renderGrid()
      })
  })
  $('s-audit-pill').addEventListener('click', function () {
    ST.auditEnabled = !ST.auditEnabled
    saveKeys()
    $('s-audit-pill').classList.toggle('on', ST.auditEnabled)
    toast(ST.auditEnabled ? 'GPT audit enabled' : 'GPT audit disabled')
  })
  $('s-sync-pill').addEventListener('click', function () {
    ST.sbEnabled = !ST.sbEnabled
    saveKeys()
    $('s-sync-pill').classList.toggle('on', ST.sbEnabled)
    $('s-sb-exp').style.display = ST.sbEnabled ? 'flex' : 'none'
    toast(ST.sbEnabled ? 'Supabase sync enabled' : 'Sync disabled')
  })
  $('s-save-sb').addEventListener('click', function () {
    var url = $('s-sb-url').value.trim(),
      anon = $('s-sb-anon').value.trim(),
      apiKey = $('s-sb-apikey').value.trim()
    if (!url || !anon) {
      toast('Enter Supabase URL and Anon Key at minimum')
      return
    }
    ST.sbUrl = url
    ST.sbAnon = anon
    ST.sbApiKey = apiKey
    saveKeys()
    var ksc = $('key-safety-card')
    if (ksc) ksc.innerHTML = keyStatusHTML()
    toast('Supabase credentials saved \u2713')
    // Auto-test connection
    testSupabaseConnection().then(function (ok) {
      toast(ok ? '\u2713 Supabase connected' : '\u2717 Supabase connection failed \u2014 check URL and key', 4000)
    })
    // Validate API key if provided
    if (apiKey && url) {
      _validateSupabaseApiKey(url, apiKey)
    } else {
      var statusEl = $('s-sb-apikey-status')
      if (statusEl) statusEl.style.display = 'none'
    }
  })
  $('s-pull').addEventListener('click', pullFromSupabase)
  // Supabase test connection button
  var sbTestBtn = $('s-sb-test')
  if (sbTestBtn) {
    sbTestBtn.addEventListener('click', function () {
      toast('Testing Supabase connection\u2026')
      testSupabaseConnection().then(function (ok) {
        toast(ok ? '\u2713 Supabase connected' : '\u2717 Connection failed', 4000)
      })
    })
  }
  var backendPill = $('s-backend-pill')
  if (backendPill) {
    backendPill.classList.toggle('on', ST.backendEnabled)
    backendPill.addEventListener('click', function () {
      ST.backendEnabled = !ST.backendEnabled
      saveKeys()
      backendPill.classList.toggle('on', ST.backendEnabled)
      toast(ST.backendEnabled ? 'Backend step enabled' : 'Backend step disabled')
    })
  }
  $('s-clear').addEventListener('click', function () {
    if (!confirm('Delete all apps locally?')) return
    ST.apps = []
    persist()
    renderGrid()
    toast('All apps cleared locally')
  })
  $('s-signout').addEventListener('click', function () {
    if (!confirm('Sign out and clear all keys?')) return
    var sb = getSupabase()
    if (sb) {
      sb.auth.signOut().then(function () {
        localStorage.clear()
        location.reload()
      })
    } else {
      localStorage.clear()
      location.reload()
    }
  })
}

function _testStitchKey(key) {
  fetch('https://stitch.googleapis.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  })
    .then(function (res) {
      if (res.ok) toast('\u2713 Stitch API key verified', 3000)
      else if (res.status === 401 || res.status === 403)
        toast('\u2717 Stitch API key invalid (HTTP ' + res.status + ')', 4000)
      else toast('\u2717 Stitch API error (HTTP ' + res.status + ')', 4000)
    })
    .catch(function () {
      toast('\u2717 Could not reach Stitch API', 4000)
    })
}

function _validateSupabaseApiKey(url, apiKey) {
  var statusEl = $('s-sb-apikey-status')
  if (!statusEl) return
  statusEl.style.display = 'block'
  statusEl.style.background = 'rgba(255,255,255,.06)'
  statusEl.style.color = 'rgba(255,255,255,.5)'
  statusEl.textContent = 'Validating API key\u2026'
  // Test the service_role key by hitting the auth admin endpoint
  fetch(url + '/auth/v1/settings', {
    headers: {
      apikey: apiKey,
      Authorization: 'Bearer ' + apiKey,
    },
  })
    .then(function (r) {
      if (r.ok) {
        statusEl.style.background = 'rgba(0,230,118,.08)'
        statusEl.style.color = 'rgba(0,230,118,.9)'
        statusEl.textContent = '\u2713 API key is valid'
        toast('\u2713 Supabase API key verified', 3000)
      } else if (r.status === 401 || r.status === 403) {
        statusEl.style.background = 'rgba(255,82,82,.08)'
        statusEl.style.color = 'rgba(255,82,82,.9)'
        statusEl.textContent = '\u2717 Invalid API key (HTTP ' + r.status + ')'
        toast('\u2717 Supabase API key invalid', 4000)
      } else {
        statusEl.style.background = 'rgba(255,214,0,.08)'
        statusEl.style.color = 'rgba(255,214,0,.9)'
        statusEl.textContent = '\u26A0 Unexpected response (HTTP ' + r.status + ')'
      }
    })
    .catch(function () {
      statusEl.style.background = 'rgba(255,82,82,.08)'
      statusEl.style.color = 'rgba(255,82,82,.9)'
      statusEl.textContent = '\u2717 Could not reach Supabase \u2014 check URL'
    })
}

function _testGroqKey(key) {
  fetch('https://api.groq.com/openai/v1/models', {
    headers: {
      Authorization: 'Bearer ' + key,
    },
  })
    .then(function (res) {
      if (res.ok) toast('\u2713 Groq API key verified', 3000)
      else if (res.status === 401 || res.status === 403)
        toast('\u2717 Groq API key invalid (HTTP ' + res.status + ')', 4000)
      else toast('\u2717 Groq API error (HTTP ' + res.status + ')', 4000)
    })
    .catch(function () {
      toast('\u2717 Could not reach Groq API', 4000)
    })
}

function _testGeminiKey(key) {
  fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key))
    .then(function (res) {
      if (res.ok) toast('\u2713 Gemini API key verified', 3000)
      else if (res.status === 400 || res.status === 401 || res.status === 403)
        toast('\u2717 Gemini API key invalid (HTTP ' + res.status + ')', 4000)
      else toast('\u2717 Gemini API error (HTTP ' + res.status + ')', 4000)
    })
    .catch(function () {
      toast('\u2717 Could not reach Gemini API', 4000)
    })
}

export function _syncStitchGate() {
  var btn = $('pt-stitch-btn')
  if (!btn) return
  var hasKey = !!ST.stitchKey
  btn.classList.toggle('pt-locked', !hasKey)
  btn.title = hasKey ? 'Stitch-Claude Chat Builder \u00B7 Flawless Pipeline' : 'Requires Stitch API key'
}

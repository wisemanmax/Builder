import { ST, saveKeys, keyStatusHTML } from '../lib/state.js'
import { $, toast, validateKey } from '../lib/utils.js'
import { persist } from '../lib/state.js'
import { testGitHub, pullFromGitHub } from '../lib/github.js'
import { pullFromSupabase } from '../lib/storage.js'
import { renderGrid } from '../components/app-icon.js'
import { renderProfilesSettings } from './profiles.js'
import { testSupabaseConnection } from '../lib/supabase-setup.js'
import { getSupabase } from '../lib/supabase.js'
import { CLAUDE_PROXY_URL } from '../config/constants.js'

export function openSettings() {
  // BYOK toggle state
  var byokPill = $('s-byok-pill')
  if (byokPill) byokPill.classList.toggle('on', ST.byokMode)
  var byokKeys = $('s-byok-keys')
  if (byokKeys) byokKeys.style.display = ST.byokMode ? 'block' : 'none'
  // Hide BYOK toggle if proxy is not configured
  var byokTog = $('s-byok-tog')
  if (byokTog) byokTog.parentElement.style.display = CLAUDE_PROXY_URL ? '' : 'none'
  // Load usage summary
  _loadUsageSummary()
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
  // BYOK toggle
  var byokTogBtn = $('s-byok-tog')
  if (byokTogBtn) {
    byokTogBtn.addEventListener('click', function () {
      ST.byokMode = !ST.byokMode
      saveKeys()
      $('s-byok-pill').classList.toggle('on', ST.byokMode)
      $('s-byok-keys').style.display = ST.byokMode ? 'block' : 'none'
      toast(ST.byokMode ? 'Using your own API keys' : 'Using built-in proxy')
    })
  }
  // Usage dashboard
  var usageBtn = $('s-usage-btn')
  if (usageBtn) {
    usageBtn.addEventListener('click', function () {
      _openUsageDashboard()
    })
  }
  var usageClose = $('usage-close')
  if (usageClose) {
    usageClose.addEventListener('click', function () {
      $('usage-overlay').style.display = 'none'
    })
  }
  var usageOverlay = $('usage-overlay')
  if (usageOverlay) {
    usageOverlay.addEventListener('click', function (e) {
      if (e.target.id === 'usage-overlay') usageOverlay.style.display = 'none'
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

function _loadUsageSummary() {
  var el = $('s-usage-summary')
  if (!el) return
  var sb = getSupabase()
  if (!sb || !ST.userId) {
    el.textContent = 'Sign in to view usage'
    return
  }
  var todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  sb.from('builder_usage')
    .select('tokens_in, tokens_out, cost_cents')
    .eq('user_id', ST.userId)
    .gte('created_at', todayStart.toISOString())
    .then(function (result) {
      if (result.error || !result.data) {
        el.textContent = 'Could not load usage'
        return
      }
      var totalTokens = 0
      var totalCost = 0
      result.data.forEach(function (r) {
        totalTokens += (r.tokens_in || 0) + (r.tokens_out || 0)
        totalCost += r.cost_cents || 0
      })
      el.textContent =
        'Today: ' +
        _fmtNum(totalTokens) +
        ' tokens, $' +
        (totalCost / 100).toFixed(2) +
        ' (' +
        result.data.length +
        ' calls)'
    })
}

function _openUsageDashboard() {
  var overlay = $('usage-overlay')
  var body = $('usage-body')
  if (!overlay || !body) return
  overlay.style.display = 'flex'
  body.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,.4)">Loading usage data...</div>'

  var sb = getSupabase()
  if (!sb || !ST.userId) {
    body.innerHTML =
      '<div style="text-align:center;padding:30px;color:rgba(255,255,255,.4)">Sign in to view usage</div>'
    return
  }

  sb.from('builder_usage')
    .select('*')
    .eq('user_id', ST.userId)
    .order('created_at', { ascending: false })
    .limit(100)
    .then(function (result) {
      if (result.error || !result.data) {
        body.innerHTML =
          '<div style="text-align:center;padding:30px;color:rgba(255,82,82,.7)">Failed to load usage</div>'
        return
      }
      var rows = result.data
      if (rows.length === 0) {
        body.innerHTML =
          '<div style="text-align:center;padding:30px;color:rgba(255,255,255,.4)">No usage data yet</div>'
        return
      }
      // Aggregate by day
      var days = {}
      var totalTokens = 0
      var totalCost = 0
      rows.forEach(function (r) {
        var day = (r.created_at || '').slice(0, 10)
        if (!days[day]) days[day] = { tokens: 0, cost: 0, calls: 0 }
        var t = (r.tokens_in || 0) + (r.tokens_out || 0)
        days[day].tokens += t
        days[day].cost += r.cost_cents || 0
        days[day].calls += 1
        totalTokens += t
        totalCost += r.cost_cents || 0
      })

      var html =
        '<div class="sscard" style="background:rgba(0,230,118,.06);border:1.5px solid rgba(0,230,118,.15);margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em">Total Usage</div>' +
        '<div style="font-size:18px;font-weight:700;margin-top:4px">' +
        _fmtNum(totalTokens) +
        ' tokens</div></div>' +
        '<div style="text-align:right"><div style="font-size:10px;color:rgba(255,255,255,.4)">Est. Cost</div>' +
        '<div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--mn)">$' +
        (totalCost / 100).toFixed(2) +
        '</div></div>' +
        '</div></div>'

      html += '<span class="ssec">Daily Breakdown</span>'
      var sortedDays = Object.keys(days).sort().reverse()
      for (var i = 0; i < sortedDays.length; i++) {
        var d = sortedDays[i]
        var dd = days[d]
        html +=
          '<div class="sscard" style="padding:10px 13px;margin-bottom:6px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div><span style="font-size:12px;font-weight:600">' +
          d +
          '</span>' +
          '<span style="font-size:10px;color:rgba(255,255,255,.35);margin-left:8px">' +
          dd.calls +
          ' calls</span></div>' +
          '<div style="text-align:right"><span style="font-size:12px;font-weight:600">' +
          _fmtNum(dd.tokens) +
          '</span>' +
          '<span style="font-size:10px;color:rgba(255,255,255,.35);margin-left:6px">$' +
          (dd.cost / 100).toFixed(2) +
          '</span></div>' +
          '</div></div>'
      }

      body.innerHTML = html
    })
}

function _fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

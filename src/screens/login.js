import { ST } from '../lib/state.js'
import { $, toast, showScreen, validateKey } from '../lib/utils.js'
import { saveKeys } from '../lib/state.js'
import { testGitHub } from '../lib/github.js'
import { renderGrid } from '../components/app-icon.js'
import { getSupabase } from '../lib/supabase.js'

// --- Auth login screen (Supabase) ---

export function initLogin() {
  var sb = getSupabase()
  if (!sb) return // No Supabase configured — auth screen won't work

  $('login-github').addEventListener('click', function () {
    _clearError()
    sb.auth
      .signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
        },
      })
      .then(function (result) {
        if (result.error) _showError(result.error.message)
      })
  })

  $('login-magic').addEventListener('click', function () {
    _clearError()
    var email = $('login-email').value.trim()
    if (!email || email.indexOf('@') < 0) {
      toast('Enter a valid email address')
      return
    }
    $('login-magic').disabled = true
    $('login-magic').textContent = 'Sending\u2026'
    sb.auth
      .signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      })
      .then(function (result) {
        $('login-magic').disabled = false
        $('login-magic').textContent = 'Send Magic Link'
        if (result.error) {
          _showError(result.error.message)
          return
        }
        $('login-options').style.display = 'none'
        $('login-check-email').style.display = 'block'
        $('login-sent-email').textContent = email
      })
  })

  $('login-email').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('login-magic').click()
  })

  $('login-back').addEventListener('click', function () {
    $('login-check-email').style.display = 'none'
    $('login-options').style.display = 'block'
    _clearError()
  })
}

function _showError(msg) {
  var el = $('login-error')
  if (!el) return
  el.textContent = msg
  el.style.display = 'block'
}

function _clearError() {
  var el = $('login-error')
  if (el) {
    el.textContent = ''
    el.style.display = 'none'
  }
}

// --- Legacy onboarding (API key setup) ---
// Kept for users who need to configure API keys after auth

export function initOnboarding() {
  $('ob-gpt').addEventListener('input', function () {
    var v = $('ob-gpt').value.trim()
    $('gpt-dot').className = 'gdot' + (v ? ' on' : '')
    $('gst-m').textContent = v ? 'GPT-4o Audit: Active' : 'GPT-4o Audit: Off'
    $('gst-s').textContent = v ? 'Code will be reviewed' : 'Add OpenAI key to enable bug scanning'
  })

  var ghTimer
  var _obSubmitted = false
  var ghValidate = function () {
    clearTimeout(ghTimer)
    var t = $('ob-gh-token').value.trim(),
      u = $('ob-gh-user').value.trim(),
      r = $('ob-gh-repo').value.trim()
    if (!t || !u || !r) {
      $('gh-dot').className = 'gh-dot'
      $('gh-st-m').textContent = 'GitHub: Not connected (optional)'
      $('gh-st-s').textContent = 'Without GitHub, apps save locally only'
      return
    }
    $('gh-dot').className = 'gh-dot'
    $('gh-st-m').textContent = 'Validating\u2026'
    $('gh-st-s').textContent = ''
    ghTimer = setTimeout(function () {
      var prevToken = ST.ghToken,
        prevUser = ST.ghUser,
        prevRepo = ST.ghRepo
      ST.ghToken = t
      ST.ghUser = u
      ST.ghRepo = r
      testGitHub().then(function (ok) {
        if (!_obSubmitted) {
          ST.ghToken = prevToken
          ST.ghUser = prevUser
          ST.ghRepo = prevRepo
        }
        $('gh-dot').className = 'gh-dot ' + (ok ? 'ok' : 'err')
        $('gh-st-m').textContent = ok ? '\u2713 Connected: ' + u + '/' + r : '\u2717 Connection failed'
        $('gh-st-s').textContent = ok
          ? 'Apps will push to github.com/' + u + '/' + r
          : 'Check token has "repo" + "workflow" scopes'
      })
    }, 900)
  }
  ;['ob-gh-token', 'ob-gh-user', 'ob-gh-repo'].forEach(function (id) {
    $(id).addEventListener('input', ghValidate)
  })

  var obSbOn = false
  $('ob-sb-tog').addEventListener('click', function () {
    obSbOn = !obSbOn
    $('ob-sb-pill').classList.toggle('on', obSbOn)
    $('ob-sb-exp').classList.toggle('open', obSbOn)
  })
  $('ob-submit').addEventListener('click', function () {
    clearTimeout(ghTimer)
    _obSubmitted = true
    var k = $('ob-anth').value.trim()
    if (!k) {
      toast('Anthropic API key is required!')
      return
    }
    var anthCheck = validateKey('anthropic', k)
    if (!anthCheck.valid) {
      toast('Anthropic key: ' + anthCheck.msg)
      return
    }
    var ghT = $('ob-gh-token').value.trim(),
      ghU = $('ob-gh-user').value.trim(),
      ghR = $('ob-gh-repo').value.trim()
    var hasGh = ghT && ghU && ghR
    if ((ghT || ghU || ghR) && !hasGh) {
      toast('Enter all three GitHub fields, or leave all blank')
      return
    }
    ST.key = k
    ST.gptKey = $('ob-gpt').value.trim()
    ST.ghToken = ghT
    ST.ghUser = ghU
    ST.ghRepo = ghR
    ST.sbUrl = $('ob-sb-url').value.trim()
    ST.sbAnon = $('ob-sb-anon').value.trim()
    ST.sbEnabled = obSbOn
    saveKeys()
    showScreen('home')
    renderGrid()
    toast(
      hasGh ? 'The Builder is ready \u2014 GitHub connected \u26A1' : 'The Builder is ready (local-only mode) \u26A1',
      3500
    )
  })
}
